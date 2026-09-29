import { and, count, eq, gte, inArray, or, sum } from "drizzle-orm";
import { z } from "zod";
import {
  CONTENT_AUDIT_WEEKDAY_FOCUS,
  CONTENT_PROPOSAL_RETENTION_DAYS,
  type ContentAuditFocus,
  type ContentProposalEntityType,
  IMG_AVATAR_DEFAULT,
} from "@/drizzle/constants";
import {
  contentProposal,
  contentProposalChange,
  dataBattleAction,
  gameAsset,
  userItem,
  userJutsu,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { agentAuditOutputSchema, visualCheckSchema } from "@/validators/contentReview";
import { type ContentEntity, entityKey, loadAllEntities } from "./entities";
import { isEpidemicConfigured } from "./epidemic";
import { expireStaleEvidence } from "./outdate";

/** Vercel caps function responses at 4.5 MB; stay well under it. */
const MAX_SNAPSHOT_BYTES = 3_800_000;

const MEDIA_KEYS = [
  "staticAssetPath",
  "staticAnimation",
  "appearAnimation",
  "disappearAnimation",
  "appearSfx",
  "disappearSfx",
];

type View = {
  types: ContentProposalEntityType[];
  fields: (entity: ContentEntity) => Record<string, unknown>;
  stats: boolean;
  assets: ("SFX" | "ANIMATION" | "STATIC")[];
};

const pick = (source: Record<string, unknown>, keys: string[]) =>
  Object.fromEntries(
    keys.filter((key) => key in source).map((key) => [key, source[key]]),
  );

const omit = (source: Record<string, unknown>, keys: string[]) =>
  Object.fromEntries(Object.entries(source).filter(([key]) => !keys.includes(key)));

const withoutMedia = (key: string) =>
  !MEDIA_KEYS.includes(key) && key !== "description" && key !== "timeTracker";

/** Keep only these keys on every effect, preserving list positions for `effects.N` paths. */
const effectsWith = (effects: unknown, keep: (key: string) => boolean) =>
  Array.isArray(effects)
    ? effects.map((effect) =>
        Object.fromEntries(
          Object.entries((effect ?? {}) as Record<string, unknown>).filter(([key]) =>
            keep(key),
          ),
        ),
      )
    : effects;

/** Text leaves of a quest's content; objects and list positions stay addressable. */
const textOnly = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(textOnly);
  if (node && typeof node === "object") {
    return Object.fromEntries(
      Object.entries(node).flatMap(([key, value]) => {
        if (typeof value === "string") {
          return /desc|text|dialog|title|name|message|story/i.test(key)
            ? [[key, value]]
            : [];
        }
        return value && typeof value === "object" ? [[key, textOnly(value)]] : [];
      }),
    );
  }
  return node;
};

const TEXT_FIELDS: Record<ContentProposalEntityType, string[]> = {
  JUTSU: ["name", "description", "battleDescription", "jutsuRank", "jutsuType"],
  ITEM: ["name", "description", "battleDescription", "rarity", "itemType"],
  BLOODLINE: ["name", "description", "rank"],
  QUEST: ["name", "description", "successDescription", "questType", "content"],
  BADGE: ["name", "description"],
  GAME_ASSET: ["name"],
  AI: ["username", "customTitle", "level"],
};

const VIEWS: Record<ContentAuditFocus, View> = {
  grammar: {
    types: ["JUTSU", "ITEM", "BLOODLINE", "QUEST", "BADGE", "AI"],
    fields: (entity) => {
      const fields = pick(entity.editable, TEXT_FIELDS[entity.type]);
      return "content" in fields
        ? { ...fields, content: textOnly(fields.content) }
        : fields;
    },
    stats: false,
    assets: [],
  },
  balance: {
    types: ["JUTSU", "ITEM", "BLOODLINE"],
    fields: (entity) => ({
      ...omit(entity.editable, ["description", "battleDescription", "image"]),
      effects: effectsWith(entity.editable.effects, withoutMedia),
    }),
    stats: true,
    assets: [],
  },
  sound: {
    types: ["JUTSU", "ITEM"],
    fields: (entity) => ({
      ...pick(entity.editable, [
        "name",
        "jutsuRank",
        "jutsuType",
        "rarity",
        "itemType",
      ]),
      effects: effectsWith(entity.editable.effects, (key) =>
        ["type", "appearSfx", "disappearSfx", "elements"].includes(key),
      ),
    }),
    stats: true,
    assets: ["SFX"],
  },
  // Targets decide where combat draws each effect, which the battlefield renders reproduce.
  animation: {
    types: ["JUTSU", "ITEM", "BLOODLINE"],
    fields: (entity) => ({
      ...pick(entity.editable, [
        "name",
        "jutsuRank",
        "jutsuType",
        "rarity",
        "itemType",
        "rank",
        "target",
      ]),
      effects: effectsWith(entity.editable.effects, (key) =>
        [
          "type",
          "target",
          "appearAnimation",
          "staticAnimation",
          "disappearAnimation",
          "staticAssetPath",
          "elements",
        ].includes(key),
      ),
    }),
    stats: true,
    assets: ["ANIMATION", "STATIC"],
  },
  visual: {
    types: ["JUTSU", "ITEM", "BLOODLINE", "BADGE", "AI"],
    fields: (entity) =>
      pick(entity.editable, [
        "name",
        "image",
        "avatar",
        "jutsuRank",
        "rarity",
        "itemType",
        "rank",
      ]),
    stats: true,
    assets: [],
  },
  consistency: {
    types: ["JUTSU", "ITEM", "BLOODLINE"],
    fields: (entity) => ({
      ...omit(entity.editable, ["image"]),
      effects: effectsWith(entity.editable.effects, withoutMedia),
    }),
    stats: false,
    assets: [],
  },
  new_content: {
    types: ["JUTSU", "ITEM", "QUEST", "AI"],
    fields: (entity) =>
      pick(entity.editable, [
        "name",
        "jutsuRank",
        "jutsuType",
        "requiredRank",
        "rarity",
        "itemType",
        "questType",
        "questRank",
        "requiredLevel",
        "villageId",
        "level",
        "rank",
        "primaryElement",
      ]),
    stats: false,
    assets: ["SFX", "ANIMATION"],
  },
};

export const resolveFocus = (focus: ContentAuditFocus | "rotate", now = new Date()) =>
  focus === "rotate"
    ? (CONTENT_AUDIT_WEEKDAY_FOCUS[now.getUTCDay()] as ContentAuditFocus)
    : focus;

/**
 * Everything the audit reads: visible content of the day's focus with versions and usage,
 * the asset library, the queue budget, recent decisions (so rejected ideas are not
 * repeated) and the JSON schema its answer must match.
 */
export const buildAuditSnapshot = async (
  client: DrizzleClient,
  requested: ContentAuditFocus | "rotate",
) => {
  const focus = resolveFocus(requested);
  const view = VIEWS[focus];
  await expireStaleEvidence(client);
  const [entityLists, stats, owners, assets, recent] = await Promise.all([
    Promise.all(view.types.map((type) => loadAllEntities(client, type))),
    view.stats ? usageStats(client) : Promise.resolve(new Map<string, Usage>()),
    focus === "balance"
      ? ownerCounts(client)
      : Promise.resolve(new Map<string, number>()),
    view.assets.length
      ? client
          .select({
            id: gameAsset.id,
            name: gameAsset.name,
            type: gameAsset.type,
            frames: gameAsset.frames,
            speed: gameAsset.speed,
            folder: gameAsset.folder,
          })
          .from(gameAsset)
          .where(and(inArray(gameAsset.type, view.assets), eq(gameAsset.hidden, false)))
      : Promise.resolve([]),
    recentSuggestions(client),
  ]);
  const visible = entityLists.flat().filter((entity) => !entity.hidden);
  const assetUse = countAssetUse(visible);
  const imageUse = new Map<string, number>();
  for (const entity of visible) {
    if (entity.image) imageUse.set(entity.image, (imageUse.get(entity.image) ?? 0) + 1);
  }
  const rows = visible.map((entity) => {
    const usage = stats.get(entityKey(entity.type, entity.id));
    return {
      type: entity.type,
      id: entity.id,
      v: entity.version,
      fields: view.fields(entity),
      ...(usage ? { casts30d: usage.casts, winRate30d: usage.winRate } : {}),
      ...(owners.has(entity.id) ? { owners: owners.get(entity.id) } : {}),
      ...(focus === "visual"
        ? {
            placeholderImage: !entity.image || entity.image === IMG_AVATAR_DEFAULT,
            imageSharedBy: entity.image ? (imageUse.get(entity.image) ?? 1) - 1 : 0,
          }
        : {}),
    };
  });
  rows.sort((a, b) => (b.casts30d ?? 0) - (a.casts30d ?? 0));
  const snapshot = {
    generatedAt: new Date().toISOString(),
    focus,
    capabilities: {
      epidemicSoundSearch: isEpidemicConfigured(),
      generation: !!process.env.REPLICATE_API_TOKEN,
    },
    examples: Object.fromEntries(
      view.types.flatMap((type) => {
        const sample = visible.find((entity) => entity.type === type);
        return sample
          ? [[type, { id: sample.id, v: sample.version, editable: sample.editable }]]
          : [];
      }),
    ),
    assets: assets.map((asset) => ({ ...asset, usedBy: assetUse.get(asset.id) ?? 0 })),
    ...recent,
    proposalSchema: auditJsonSchema(),
    visualCheckSchema: visualCheckJsonSchema(),
    entities: rows,
  };
  snapshot.entities = leadingRowsWithin(
    rows,
    MAX_SNAPSHOT_BYTES -
      Buffer.byteLength(JSON.stringify({ ...snapshot, entities: [] })),
  );
  return snapshot;
};

/**
 * The leading rows whose JSON fits in `budget` bytes of an array. Rows come most used first,
 * so a trim for size drops the content that matters least.
 */
export const leadingRowsWithin = <T>(rows: T[], budget: number) => {
  let left = budget;
  const kept: T[] = [];
  for (const row of rows) {
    const size = Buffer.byteLength(JSON.stringify(row)) + 1;
    if (size > left) break;
    left -= size;
    kept.push(row);
  }
  return kept;
};

type Usage = { casts: number; winRate: number | null };

/** Casts and win rate per jutsu, item and bloodline over DataBattleAction's 30 days. */
const usageStats = async (client: DrizzleClient) => {
  const rows = await client
    .select({
      type: dataBattleAction.type,
      contentId: dataBattleAction.contentId,
      battleWon: dataBattleAction.battleWon,
      n: sum(dataBattleAction.count).mapWith(Number),
    })
    .from(dataBattleAction)
    .where(inArray(dataBattleAction.type, ["jutsu", "item", "bloodline"]))
    .groupBy(
      dataBattleAction.type,
      dataBattleAction.contentId,
      dataBattleAction.battleWon,
    );
  const totals = new Map<string, { casts: number; wins: number; decided: number }>();
  const typeOf = { jutsu: "JUTSU", item: "ITEM", bloodline: "BLOODLINE" } as const;
  for (const row of rows) {
    const type = typeOf[row.type as keyof typeof typeOf];
    if (!type) continue;
    const key = entityKey(type, row.contentId);
    const total = totals.get(key) ?? { casts: 0, wins: 0, decided: 0 };
    total.casts += row.n;
    if (row.battleWon === 1) total.wins += row.n;
    if (row.battleWon === 0 || row.battleWon === 1) total.decided += row.n;
    totals.set(key, total);
  }
  return new Map(
    [...totals.entries()].map(([key, total]) => [
      key,
      {
        casts: total.casts,
        winRate:
          total.decided > 0
            ? Math.round((total.wins / total.decided) * 100) / 100
            : null,
      },
    ]),
  );
};

/** How many players hold each jutsu and item: the reach of a balance change. */
const ownerCounts = async (client: DrizzleClient) => {
  const [jutsus, items] = await Promise.all([
    client
      .select({ id: userJutsu.jutsuId, n: count() })
      .from(userJutsu)
      .groupBy(userJutsu.jutsuId),
    client
      .select({ id: userItem.itemId, n: count() })
      .from(userItem)
      .groupBy(userItem.itemId),
  ]);
  return new Map([...jutsus, ...items].map((row) => [row.id, row.n]));
};

const countAssetUse = (entities: ContentEntity[]) => {
  const used = new Map<string, number>();
  for (const entity of entities) {
    const effects = entity.editable.effects;
    if (!Array.isArray(effects)) continue;
    for (const effect of effects as Record<string, unknown>[]) {
      for (const key of MEDIA_KEYS) {
        const id = effect?.[key];
        if (typeof id === "string" && id) used.set(id, (used.get(id) ?? 0) + 1);
      }
    }
  }
  return used;
};

const recentSuggestions = async (client: DrizzleClient) => {
  const since = new Date(Date.now() - CONTENT_PROPOSAL_RETENTION_DAYS * 86_400_000);
  const rows = await client
    .select({
      id: contentProposal.id,
      title: contentProposal.title,
      category: contentProposal.category,
      status: contentProposal.status,
      rejectReason: contentProposal.rejectReason,
      reviewNote: contentProposal.reviewNote,
      outdatedReason: contentProposal.outdatedReason,
      entityType: contentProposalChange.entityType,
      entityId: contentProposalChange.entityId,
      after: contentProposalChange.after,
    })
    .from(contentProposal)
    .innerJoin(
      contentProposalChange,
      eq(contentProposalChange.proposalId, contentProposal.id),
    )
    // Open suggestions stay listed however old they are; decided ones for the retention window.
    .where(
      or(
        eq(contentProposal.status, "PENDING"),
        gte(contentProposal.statusChangedAt, since),
      ),
    );
  const shape = (status: string) =>
    rows
      .filter((row) => row.status === status)
      .map((row) => ({
        title: row.title,
        category: row.category,
        target: row.entityId
          ? `${row.entityType}:${row.entityId}`
          : `new ${row.entityType}`,
        fields: Object.keys(row.after),
        ...(row.rejectReason ? { reason: row.rejectReason, note: row.reviewNote } : {}),
        ...(row.outdatedReason ? { outdatedBecause: row.outdatedReason } : {}),
      }));
  return {
    openSuggestions: shape("PENDING"),
    recentlyRejected: shape("REJECTED"),
    recentlyOutdated: shape("OUTDATED"),
    recentlyApplied: shape("APPLIED"),
  };
};

/**
 * JSON schema for the audit's answer, in the strict structured-output subset Codex uses:
 * every property required, no extra properties, and no string formats or length limits
 * (the server validates those again on submit).
 */
export const auditJsonSchema = () => strict(z.toJSONSchema(agentAuditOutputSchema));

/** JSON schema for the audit's verdict on the battlefield renders of its suggestions. */
export const visualCheckJsonSchema = () => strict(z.toJSONSchema(visualCheckSchema));

const DROP_KEYWORDS = new Set([
  "$schema",
  "format",
  "pattern",
  "minLength",
  "maxLength",
]);

const strict = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(strict);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (!DROP_KEYWORDS.has(key)) out[key] = strict(value);
  }
  if (out.type === "object" && out.properties && typeof out.properties === "object") {
    out.required = Object.keys(out.properties);
    out.additionalProperties = false;
  }
  return out;
};
