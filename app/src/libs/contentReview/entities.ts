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
 * A content row as the review system sees it. `payload` is exactly what the entity's update
 * procedure receives from the manual editor; `editable` is the part suggestions may change,
 * which is also what the version is computed over.
 */
export type ContentEntity = {
  type: ContentProposalEntityType;
  id: string;
  name: string;
  image: string | null;
  hidden: boolean;
  payload: Record<string, unknown>;
  editable: Record<string, unknown>;
  version: string;
};

type Loaded = Omit<ContentEntity, "type" | "editable" | "version">;

type EntityConfig = {
  label: string;
  /** Content type used for image generation prompts. */
  contentType: ContentType;
  /** ActionLog `tableName` the entity's update procedure writes. */
  logTable: string;
  /** Top-level fields suggestions may change. */
  editableKeys: readonly string[];
  /** Fields the audit may never change: prices, rewards, loot and visibility. */
  agentProtected: readonly string[];
  validator: z.ZodType;
  detailHref: (id: string) => string;
  editHref: (id: string) => string;
  /** Rows by id, or every row of the type when `ids` is null. */
  load: (client: DrizzleClient, ids: string[] | null) => Promise<Loaded[]>;
};

const keysOf = (schema: { shape: Record<string, unknown> }) =>
  Object.keys(schema.shape);

const pick = (source: Record<string, unknown>, keys: readonly string[]) =>
  Object.fromEntries(
    keys.filter((key) => key in source).map((key) => [key, source[key]]),
  );

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

export const ENTITY_CONFIG: Record<ContentProposalEntityType, EntityConfig> = {
  JUTSU: {
    contentType: "jutsu",
    label: ENTITY_LABELS.JUTSU,
    logTable: "jutsu",
    editableKeys: keysOf(JutsuValidatorRawSchema),
    agentProtected: ["extraBaseCost", "hidden"],
    validator: JutsuValidator,
    detailHref: (id) => `/manual/jutsu/${id}`,
    editHref: (id) => `/manual/jutsu/edit/${id}`,
    load: async (client, ids) => {
      const rows = await client
        .select()
        .from(jutsu)
        .where(ids ? inArray(jutsu.id, ids) : undefined);
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        image: row.image,
        hidden: row.hidden,
        payload: { ...row },
      }));
    },
  },
  ITEM: {
    contentType: "item",
    label: ENTITY_LABELS.ITEM,
    logTable: "item",
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
    editHref: (id) => `/manual/item/edit/${id}`,
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
        hidden: row.hidden,
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
  },
  BLOODLINE: {
    contentType: "bloodline",
    label: ENTITY_LABELS.BLOODLINE,
    logTable: "bloodline",
    editableKeys: keysOf(BloodlineValidator),
    agentProtected: ["hidden"],
    validator: BloodlineValidator,
    detailHref: (id) => `/manual/bloodline/${id}`,
    editHref: (id) => `/manual/bloodline/edit/${id}`,
    load: async (client, ids) => {
      const rows = await client
        .select()
        .from(bloodline)
        .where(ids ? inArray(bloodline.id, ids) : undefined);
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        image: row.image,
        hidden: row.hidden,
        payload: { ...row },
      }));
    },
  },
  QUEST: {
    contentType: "quest",
    label: ENTITY_LABELS.QUEST,
    logTable: "quest",
    // Raid boss health moves during play; it is state, not content.
    editableKeys: keysOf(QuestValidatorRawSchema).filter(
      (key) => key !== "raidBossCurrentHealth",
    ),
    agentProtected: ["hidden", "questType", "tierLevel"],
    validator: QuestValidator,
    detailHref: (id) => `/manual/quest/edit/${id}`,
    editHref: (id) => `/manual/quest/edit/${id}`,
    load: async (client, ids) => {
      const rows = await client
        .select()
        .from(quest)
        .where(ids ? inArray(quest.id, ids) : undefined);
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        image: row.image,
        hidden: row.hidden,
        payload: { ...row },
      }));
    },
  },
  BADGE: {
    contentType: "badge",
    label: ENTITY_LABELS.BADGE,
    logTable: "badge",
    editableKeys: keysOf(BadgeValidator),
    agentProtected: [],
    validator: BadgeValidator,
    detailHref: (id) => `/manual/badge/edit/${id}`,
    editHref: (id) => `/manual/badge/edit/${id}`,
    load: async (client, ids) => {
      const rows = await client
        .select()
        .from(badge)
        .where(ids ? inArray(badge.id, ids) : undefined);
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        image: row.image,
        hidden: false,
        payload: { ...row },
      }));
    },
  },
  GAME_ASSET: {
    contentType: "asset",
    label: ENTITY_LABELS.GAME_ASSET,
    logTable: "gameAsset",
    editableKeys: keysOf(gameAssetValidator),
    agentProtected: ["hidden", "type", "licenseDetails"],
    validator: gameAssetValidator,
    detailHref: (id) => `/manual/asset/edit/${id}`,
    editHref: (id) => `/manual/asset/edit/${id}`,
    load: async (client, ids) => {
      const rows = await client
        .select()
        .from(gameAsset)
        .where(ids ? inArray(gameAsset.id, ids) : undefined);
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        image: row.image,
        hidden: row.hidden,
        payload: { ...row },
      }));
    },
  },
  AI: {
    contentType: "ai",
    label: ENTITY_LABELS.AI,
    logTable: "ai",
    editableKeys: AI_EDITABLE_KEYS,
    agentProtected: ["items"],
    validator: insertAiSchema,
    detailHref: (id) => `/manual/ai/edit/${id}`,
    editHref: (id) => `/manual/ai/edit/${id}`,
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
        hidden: false,
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
  },
};

export const entityLabel = (type: ContentProposalEntityType) =>
  ENTITY_CONFIG[type].label;

/** Load entities of mixed types, one query per type, keyed by `${type}:${id}`. */
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

export const entityKey = (type: ContentProposalEntityType, id: string) =>
  `${type}:${id}`;

/** Every entity of one type, for the audit snapshot. */
export const loadAllEntities = async (
  client: DrizzleClient,
  type: ContentProposalEntityType,
) => (await ENTITY_CONFIG[type].load(client, null)).map((row) => toEntity(type, row));

const toEntity = (type: ContentProposalEntityType, loaded: Loaded): ContentEntity => {
  const editable = pick(loaded.payload, ENTITY_CONFIG[type].editableKeys);
  return { ...loaded, type, editable, version: contentVersion(editable) };
};

/** Editable fields of an arbitrary payload, for suggestions that create content. */
export const editableOf = (
  type: ContentProposalEntityType,
  payload: Record<string, unknown>,
) => pick(payload, ENTITY_CONFIG[type].editableKeys);
