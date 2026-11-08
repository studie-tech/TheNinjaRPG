import type { z } from "zod";
import type { ContentProposalEntityType, ContentType } from "@/drizzle/constants";
import {
  listItemForLoad,
  listTitleForLoad,
  listUserDataForLoad,
  selectBadgeForLoad,
  selectBloodlineForLoad,
  selectContentNames,
  selectGameAssetForLoad,
  selectJutsuForLoad,
  selectQuestForLoad,
  selectTitleForFindNames,
} from "@/queries/contentReview";
import type { DrizzleClient } from "@/server/db";
import { insertAiSchema } from "@/validators/aiInput";
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
import { TitleValidator } from "@/validators/title";
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
  const payload = normalizeEditable(type, loaded.payload);
  const editable = pick(payload, ENTITY_CONFIG[type].editableKeys);
  // Animation assignments are edited separately but still invalidate AI proposals.
  // Empty bindings retain the editable-only version; clearing overrides restores it.
  const assignments = loaded.payload.spriteAnimationAssignments;
  const versioned =
    type === "AI" && Array.isArray(assignments) && assignments.length > 0
      ? {
          ...editable,
          spriteAnimationAssignments: assignments,
        }
      : editable;
  return { ...loaded, payload, type, editable, version: contentVersion(versioned) };
};

/**
 * Editable fields with their order-insensitive lists (item recipes, AI jutsus and drops)
 * sorted, so reordering a list is not a change.
 */
export const normalizeEditable = (
  entityType: ContentProposalEntityType,
  editable: Record<string, unknown>,
) => {
  const byFirstId = (list: unknown) =>
    Array.isArray(list)
      ? [...(list as { ids?: string[] }[])].sort((a, b) =>
          (a.ids?.[0] ?? "").localeCompare(b.ids?.[0] ?? ""),
        )
      : list;
  if (entityType === "ITEM" && "craftingRequirements" in editable) {
    return {
      ...editable,
      craftingRequirements: byFirstId(editable.craftingRequirements),
    };
  }
  if (entityType === "AI") {
    return {
      ...editable,
      ...("jutsus" in editable && Array.isArray(editable.jutsus)
        ? { jutsus: [...(editable.jutsus as string[])].sort() }
        : {}),
      ...("items" in editable ? { items: byFirstId(editable.items) } : {}),
    };
  }
  return editable;
};

/** Select the fields present in a content entity snapshot for the requested keys. */
export const pick = (source: Record<string, unknown>, keys: readonly string[]) =>
  Object.fromEntries(
    keys.filter((key) => key in source).map((key) => [key, source[key]]),
  );

const keysOf = (schema: { shape: Record<string, unknown> }) =>
  Object.keys(schema.shape);

/** AI fields shown by the manual AI editor (hooks/ai.ts), plus its effect list. */
const AI_EDITABLE_KEYS = [
  "username",
  "npcTitle",
  "avatar",
  "avatarFacing",
  "gender",
  "level",
  "regeneration",
  "rank",
  "bloodlineId",
  "offence",
  "defence",
  "ninjutsuMastery",
  "genjutsuMastery",
  "taijutsuMastery",
  "bukijutsuMastery",
  "bloodlineMastery",
  "sageMastery",
  "statsMultiplier",
  "poolsMultiplier",
  "strength",
  "intelligence",
  "willpower",
  "speed",
  "isSummon",
  "isEvent",
  "isWarCamp",
  "inArena",
  "inShrines",
  "primaryElement",
  "secondaryElement",
  "preferredDamageElement",
  "preferredGeneral1",
  "preferredGeneral2",
  "anbuId",
  "clanId",
  "jutsus",
  "items",
  "effects",
] as const;

/** Bind a content type to the review desk's name lookup and project only matching names. */
const findNamesOf =
  (entityType: Parameters<typeof selectContentNames>[1]): EntityConfig["findNames"] =>
  async (client, names) =>
    (await selectContentNames(client, entityType, names)).map((row) => row.name);

/**
 * How the review system loads, names, validates and links each content type, and which of
 * its fields suggestions may change.
 */
export const ENTITY_CONFIG: Record<ContentProposalEntityType, EntityConfig> = {
  JUTSU: {
    contentType: "jutsu",
    editableKeys: keysOf(JutsuValidatorRawSchema),
    validator: JutsuValidator,
    detailHref: (id) => `/manual/jutsu/${id}`,
    load: async (client, ids) => {
      const rows = await selectJutsuForLoad(client, ids);
      return rows.map(toLoaded);
    },
    findNames: findNamesOf("JUTSU"),
  },
  ITEM: {
    contentType: "item",
    editableKeys: keysOf(ItemValidatorRawSchema),
    validator: ItemValidator,
    detailHref: (id) => `/manual/item/${id}`,
    load: async (client, ids) => {
      const rows = await listItemForLoad(client, ids);
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
          craftingRequirements: craftingRequirements.map((req) => ({
            ids: [req.requirementItemId],
            number: req.quantity,
          })),
        },
      }));
    },
    findNames: findNamesOf("ITEM"),
  },
  BLOODLINE: {
    contentType: "bloodline",
    editableKeys: keysOf(BloodlineValidator),
    validator: BloodlineValidator,
    detailHref: (id) => `/manual/bloodline/${id}`,
    load: async (client, ids) => {
      const rows = await selectBloodlineForLoad(client, ids);
      return rows.map(toLoaded);
    },
    findNames: findNamesOf("BLOODLINE"),
  },
  QUEST: {
    contentType: "quest",
    // Raid boss health moves during play; it is state, not content.
    editableKeys: keysOf(QuestValidatorRawSchema).filter(
      (key) => key !== "raidBossCurrentHealth",
    ),
    validator: QuestValidator,
    detailHref: (id) => `/manual/quest/edit/${id}`,
    load: async (client, ids) => {
      const rows = await selectQuestForLoad(client, ids);
      return rows.map(toLoaded);
    },
    findNames: findNamesOf("QUEST"),
  },
  BADGE: {
    contentType: "badge",
    editableKeys: keysOf(BadgeValidator),
    validator: BadgeValidator,
    detailHref: (id) => `/manual/badge/edit/${id}`,
    load: async (client, ids) => {
      const rows = await selectBadgeForLoad(client, ids);
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        image: row.image,
        isHidden: false,
        payload: { ...row },
      }));
    },
    findNames: findNamesOf("BADGE"),
  },
  TITLE: {
    contentType: "title",
    editableKeys: keysOf(TitleValidator),
    validator: TitleValidator,
    detailHref: (id) => `/manual/title/edit/${id}`,
    load: async (client, ids) => {
      const rows = await listTitleForLoad(client, ids);
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        image: null,
        isHidden: row.archived,
        payload: { ...row },
      }));
    },
    findNames: async (client, names) =>
      (await selectTitleForFindNames(client, names)).map((row) => row.name),
  },
  GAME_ASSET: {
    contentType: "asset",
    editableKeys: keysOf(gameAssetValidator),
    validator: gameAssetValidator,
    detailHref: (id) => `/manual/asset/edit/${id}`,
    load: async (client, ids) => {
      const rows = await selectGameAssetForLoad(client, ids);
      return rows.map(toLoaded);
    },
    findNames: findNamesOf("GAME_ASSET"),
  },
  AI: {
    contentType: "ai",
    editableKeys: AI_EDITABLE_KEYS,
    validator: insertAiSchema,
    detailHref: (id) => `/manual/ai/edit/${id}`,
    load: async (client, ids) => {
      const rows = await listUserDataForLoad(client, ids);
      // Same projection as useAiEditForm, minus relations whose content was deleted.
      return rows.map(({ jutsus, items, spriteAnimationBindings, ...row }) => ({
        id: row.userId,
        name: row.username,
        image: row.avatar,
        isHidden: false,
        payload: {
          ...row,
          // Database row order must not change an otherwise identical review version.
          spriteAnimationAssignments: spriteAnimationBindings
            .map(({ actionKey, animationId }) => ({ actionKey, animationId }))
            .sort((a, b) => a.actionKey.localeCompare(b.actionKey)),
          jutsus: jutsus
            .filter((entry) => entry.jutsu)
            .map((entry) => entry.jutsuId)
            .sort(),
          items: items
            .filter((entry) => entry.item)
            .map((entry) => ({
              ids: [entry.itemId],
              number: entry.dropChancePerc ?? 0,
            })),
        },
      }));
    },
    // Usernames are unique across players and AI, so a new AI cannot take a player's either.
    findNames: findNamesOf("AI"),
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
  /** Content type used for image generation prompts. */
  contentType: ContentType;
  /** Top-level fields suggestions may change. */
  editableKeys: readonly string[];
  /** Input validator of the entity's update procedure. */
  validator: z.ZodType;
  /** Manual page the review desk links an entity to. */
  detailHref: (id: string) => string;
  /** Rows by id, or every row of the type when `ids` is null. */
  load: (client: DrizzleClient, ids: string[] | null) => Promise<Loaded[]>;
  /** The names among `names` that a row already has, compared the way the column collates. */
  findNames: (client: DrizzleClient, names: string[]) => Promise<string[]>;
};

/** The usual shape of a content row with a name, an image and a hidden flag. */
const toLoaded = <
  Row extends { id: string; name: string; image: string | null; hidden: boolean },
>(
  row: Row,
): Loaded => ({
  id: row.id,
  name: row.name,
  image: row.image,
  isHidden: row.hidden,
  payload: { ...row },
});

/** A loaded row, before its editable fields and version are derived. */
type Loaded = Omit<ContentEntity, "type" | "editable" | "version">;
