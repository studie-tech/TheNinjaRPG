import { and, eq, inArray } from "drizzle-orm";
import type { z } from "zod";
import type { ContentProposalEntityType, ContentType } from "@/drizzle/constants";
import {
  badge,
  bloodline,
  gameAsset,
  insertAiSchema,
  item,
  jutsu,
  quest,
  userData,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { gameAssetValidator } from "@/validators/asset";
import { BadgeValidator } from "@/validators/badge";
import {
  BloodlineValidator,
  ItemValidator,
  ItemValidatorRawSchema,
  JutsuValidator,
  JutsuValidatorRawSchema,
} from "@/validators/combat";
import { QuestValidator, QuestValidatorRawSchema } from "@/validators/objectives";
import { ENTITY_LABELS } from "./labels";
import { contentVersion } from "./version";

/**
 * Load entities of mixed types, one query per type, keyed by `entityKey`. Ids that match no
 * row are absent from the map.
 */
export const loadEntities = async (
  client: DrizzleClient,
  refs: { entityType: ContentProposalEntityType; entityId: string }[],
) => {
  const byType = new Map<ContentProposalEntityType, Set<string>>();
  for (const ref of refs) {
    const ids = byType.get(ref.entityType) ?? new Set<string>();
    ids.add(ref.entityId);
    byType.set(ref.entityType, ids);
  }
  const loaded = await Promise.all(
    [...byType.entries()].map(async ([type, ids]) => {
      const rows = await ENTITY_CONFIG[type].load(client, [...ids]);
      return rows.map((row) => toEntity(type, row));
    }),
  );
  return new Map(
    loaded.flat().map((entity) => [entityKey(entity.type, entity.id), entity]),
  );
};

/** Every entity of one type, for the audit snapshot. */
export const loadAllEntities = async (
  client: DrizzleClient,
  type: ContentProposalEntityType,
) => (await ENTITY_CONFIG[type].load(client, null)).map((row) => toEntity(type, row));

/** Key of one entity among entities of every type. */
export const entityKey = (type: ContentProposalEntityType, id: string) =>
  `${type}:${id}`;

/** Display name of a content type. */
export const entityLabel = (type: ContentProposalEntityType) =>
  ENTITY_CONFIG[type].label;

/** The editable fields of a payload, such as an editor form or a validated update. */
export const editableOf = (
  type: ContentProposalEntityType,
  payload: Record<string, unknown>,
) => pick(payload, ENTITY_CONFIG[type].editableKeys);

/** Trimmed name in drafted fields, or "" when there is none; AIs keep theirs in `username`. */
export const draftName = (fields: Record<string, unknown>) => {
  const name = fields.name ?? fields.username;
  return typeof name === "string" ? name.trim() : "";
};

/** Adds the editable fields and their version to a loaded row. */
const toEntity = (type: ContentProposalEntityType, loaded: Loaded): ContentEntity => {
  const editable = pick(loaded.payload, ENTITY_CONFIG[type].editableKeys);
  return { ...loaded, type, editable, version: contentVersion(editable) };
};

const pick = (source: Record<string, unknown>, keys: readonly string[]) =>
  Object.fromEntries(
    keys.filter((key) => key in source).map((key) => [key, source[key]]),
  );

const keysOf = (schema: { shape: Record<string, unknown> }) =>
  Object.keys(schema.shape);

/** AI fields shown by the manual AI editor (libs/ais.ts), plus its effect list. */
const AI_EDITABLE_KEYS = [
  "username",
  "customTitle",
  "avatar",
  "avatar3d",
  "avatarFacing",
  "gender",
  "level",
  "regeneration",
  "rank",
  "bloodlineId",
  "ninjutsuOffence",
  "ninjutsuDefence",
  "genjutsuOffence",
  "genjutsuDefence",
  "taijutsuOffence",
  "taijutsuDefence",
  "bukijutsuOffence",
  "bukijutsuDefence",
  "statsMultiplier",
  "poolsMultiplier",
  "strength",
  "intelligence",
  "willpower",
  "speed",
  "isSummon",
  "inArena",
  "inShrines",
  "primaryElement",
  "secondaryElement",
  "preferredStat",
  "preferredGeneral1",
  "preferredGeneral2",
  "anbuId",
  "clanId",
  "jutsus",
  "items",
  "effects",
] as const;

/**
 * How the review system loads, names, validates and links each content type, and which of
 * its fields suggestions and the audit may change.
 */
export const ENTITY_CONFIG: Record<ContentProposalEntityType, EntityConfig> = {
  JUTSU: {
    contentType: "jutsu",
    label: ENTITY_LABELS.JUTSU,
    editableKeys: keysOf(JutsuValidatorRawSchema),
    agentProtected: ["extraBaseCost", "hidden"],
    validator: JutsuValidator,
    detailHref: (id) => `/manual/jutsu/${id}`,
    load: async (client, ids) => {
      const rows = await client
        .select()
        .from(jutsu)
        .where(ids ? inArray(jutsu.id, ids) : undefined);
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        image: row.image,
        isHidden: row.hidden,
        payload: { ...row },
      }));
    },
    findNames: async (client, names) =>
      (
        await client
          .select({ name: jutsu.name })
          .from(jutsu)
          .where(inArray(jutsu.name, names))
      ).map((row) => row.name),
  },
  ITEM: {
    contentType: "item",
    label: ENTITY_LABELS.ITEM,
    editableKeys: keysOf(ItemValidatorRawSchema),
    agentProtected: [
      "cost",
      "repsCost",
      "seichiSilverCost",
      "inShop",
      "isEventItem",
      "expireFromStoreAt",
      "farmSellValue",
      "farmYieldItemId",
      "farmExtractSeedItemId",
      "farmExtractSeedCount",
      "craftingRequirements",
      "hidden",
    ],
    validator: ItemValidator,
    detailHref: (id) => `/manual/item/${id}`,
    load: async (client, ids) => {
      const rows = await client.query.item.findMany({
        where: ids ? inArray(item.id, ids) : undefined,
        with: { craftingRequirements: true },
      });
      // Same projection as useItemEditForm: item.update replaces the crafting recipe with
      // whatever the payload carries, so it must always travel with the row.
      return rows.map(({ craftingRequirements, ...row }) => ({
        id: row.id,
        name: row.name,
        image: row.image,
        isHidden: row.hidden,
        payload: {
          ...row,
          expireFromStoreAt: row.expireFromStoreAt
            ? row.expireFromStoreAt.slice(0, 10)
            : "",
          crystalTargetTypes: row.crystalTargetTypes || null,
          craftingRequirements: craftingRequirements
            .map((req) => ({ ids: [req.requirementItemId], number: req.quantity }))
            .sort((a, b) => (a.ids[0] ?? "").localeCompare(b.ids[0] ?? "")),
        },
      }));
    },
    findNames: async (client, names) =>
      (
        await client
          .select({ name: item.name })
          .from(item)
          .where(inArray(item.name, names))
      ).map((row) => row.name),
  },
  BLOODLINE: {
    contentType: "bloodline",
    label: ENTITY_LABELS.BLOODLINE,
    editableKeys: keysOf(BloodlineValidator),
    agentProtected: ["hidden"],
    validator: BloodlineValidator,
    detailHref: (id) => `/manual/bloodline/${id}`,
    load: async (client, ids) => {
      const rows = await client
        .select()
        .from(bloodline)
        .where(ids ? inArray(bloodline.id, ids) : undefined);
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        image: row.image,
        isHidden: row.hidden,
        payload: { ...row },
      }));
    },
    findNames: async (client, names) =>
      (
        await client
          .select({ name: bloodline.name })
          .from(bloodline)
          .where(inArray(bloodline.name, names))
      ).map((row) => row.name),
  },
  QUEST: {
    contentType: "quest",
    label: ENTITY_LABELS.QUEST,
    // Raid boss health moves during play; it is state, not content.
    editableKeys: keysOf(QuestValidatorRawSchema).filter(
      (key) => key !== "raidBossCurrentHealth",
    ),
    agentProtected: ["hidden", "questType", "tierLevel"],
    validator: QuestValidator,
    detailHref: (id) => `/manual/quest/edit/${id}`,
    load: async (client, ids) => {
      const rows = await client
        .select()
        .from(quest)
        .where(ids ? inArray(quest.id, ids) : undefined);
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        image: row.image,
        isHidden: row.hidden,
        payload: { ...row },
      }));
    },
    findNames: async (client, names) =>
      (
        await client
          .select({ name: quest.name })
          .from(quest)
          .where(inArray(quest.name, names))
      ).map((row) => row.name),
  },
  BADGE: {
    contentType: "badge",
    label: ENTITY_LABELS.BADGE,
    editableKeys: keysOf(BadgeValidator),
    agentProtected: [],
    validator: BadgeValidator,
    detailHref: (id) => `/manual/badge/edit/${id}`,
    load: async (client, ids) => {
      const rows = await client
        .select()
        .from(badge)
        .where(ids ? inArray(badge.id, ids) : undefined);
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        image: row.image,
        isHidden: false,
        payload: { ...row },
      }));
    },
    findNames: async (client, names) =>
      (
        await client
          .select({ name: badge.name })
          .from(badge)
          .where(inArray(badge.name, names))
      ).map((row) => row.name),
  },
  GAME_ASSET: {
    contentType: "asset",
    label: ENTITY_LABELS.GAME_ASSET,
    editableKeys: keysOf(gameAssetValidator),
    agentProtected: ["hidden", "type", "licenseDetails"],
    validator: gameAssetValidator,
    detailHref: (id) => `/manual/asset/edit/${id}`,
    load: async (client, ids) => {
      const rows = await client
        .select()
        .from(gameAsset)
        .where(ids ? inArray(gameAsset.id, ids) : undefined);
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        image: row.image,
        isHidden: row.hidden,
        payload: { ...row },
      }));
    },
    findNames: async (client, names) =>
      (
        await client
          .select({ name: gameAsset.name })
          .from(gameAsset)
          .where(inArray(gameAsset.name, names))
      ).map((row) => row.name),
  },
  AI: {
    contentType: "ai",
    label: ENTITY_LABELS.AI,
    editableKeys: AI_EDITABLE_KEYS,
    agentProtected: ["items"],
    validator: insertAiSchema,
    detailHref: (id) => `/manual/ai/edit/${id}`,
    load: async (client, ids) => {
      const rows = await client.query.userData.findMany({
        where: and(
          ids ? inArray(userData.userId, ids) : undefined,
          eq(userData.isAi, true),
        ),
        with: {
          jutsus: { with: { jutsu: { columns: { id: true } } } },
          items: { with: { item: { columns: { id: true } } } },
        },
      });
      // Same projection as useAiEditForm, minus relations whose content was deleted.
      return rows.map(({ jutsus, items, ...row }) => ({
        id: row.userId,
        name: row.username,
        image: row.avatar,
        isHidden: false,
        payload: {
          ...row,
          jutsus: jutsus
            .filter((entry) => entry.jutsu)
            .map((entry) => entry.jutsuId)
            .sort(),
          items: items
            .filter((entry) => entry.item)
            .map((entry) => ({
              ids: [entry.itemId],
              number: entry.dropChancePerc ?? 0,
            }))
            .sort((a, b) => (a.ids[0] ?? "").localeCompare(b.ids[0] ?? "")),
        },
      }));
    },
    // Usernames are unique across players and AI, so a new AI cannot take a player's either.
    findNames: async (client, names) =>
      (
        await client
          .select({ name: userData.username })
          .from(userData)
          .where(inArray(userData.username, names))
      ).map((row) => row.name),
  },
};

/**
 * A content row as the review system sees it. `payload` is exactly what the entity's update
 * procedure receives from the manual editor; `editable` is the part suggestions may change,
 * which is also what the version is computed over.
 */
export type ContentEntity = {
  type: ContentProposalEntityType;
  id: string;
  name: string;
  image: string | null;
  isHidden: boolean;
  payload: Record<string, unknown>;
  editable: Record<string, unknown>;
  version: string;
};

type EntityConfig = {
  label: string;
  /** Content type used for image generation prompts. */
  contentType: ContentType;
  /** Top-level fields suggestions may change. */
  editableKeys: readonly string[];
  /** Fields the audit may never change: prices, loot, recipes, visibility and structure. */
  agentProtected: readonly string[];
  /** Input validator of the entity's update procedure. */
  validator: z.ZodType;
  /** Manual page the review desk links an entity to. */
  detailHref: (id: string) => string;
  /** Rows by id, or every row of the type when `ids` is null. */
  load: (client: DrizzleClient, ids: string[] | null) => Promise<Loaded[]>;
  /** The names among `names` that a row already has, compared the way the column collates. */
  findNames: (client: DrizzleClient, names: string[]) => Promise<string[]>;
};

/** A loaded row, before its editable fields and version are derived. */
type Loaded = Omit<ContentEntity, "type" | "editable" | "version">;
