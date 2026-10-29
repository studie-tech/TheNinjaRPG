/**
 * Database access for item; authorization and transaction scopes stay in callers.
 */
import {
  and,
  asc,
  count,
  eq,
  exists,
  getTableColumns,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  notExists,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { nanoid } from "nanoid";
import type { z } from "zod";
import {
  IMG_AVATAR_DEFAULT,
  type VariantCostType,
  VILLAGE_SYNDICATE_ID,
} from "@/drizzle/constants";
import {
  actionLog,
  bloodlineRolls,
  craftingRequirement,
  huntingSession,
  type Item,
  item,
  itemLoadout,
  itemPurchaseCounter,
  itemVariant,
  petSpecies,
  quest,
  questHistory,
  sageMode,
  sageModeRolls,
  type UserItem,
  userCookingJob,
  userData,
  userItem,
  userItemImbuement,
  userItemVariant,
  userPet,
  userRaidBuff,
  userSkill,
  villageStructure,
} from "@/drizzle/schema";
import { bloodrightSwapRefund } from "@/libs/bloodright";
import { getJutsuSlotIncreaseLimit } from "@/libs/jutsuSlots";
import { collapseRewards } from "@/libs/quest";
import { cacheItemIds, isRestrictedCacheReward } from "@/libs/weightedCache";
import type { DrizzleClient } from "@/server/db";
import {
  completedQuestHistoryRelation,
  userQuestHistoryRelation,
} from "@/server/utils/achievementObjectives";
import {
  getNextUserSnapshotAt,
  hasNoHuntingBattle,
  userItemMergeQuantityCase,
} from "@/server/utils/concurrency";
import { getItemPurchasePeriodStart } from "@/utils/time";
import { MEAL_ITEM_DEFAULTS } from "@/validators/cooking";
import { DEFAULT_FURNITURE_DATA, FURNITURE_ITEM_DEFAULTS } from "@/validators/item";
import type { FurnitureVariantData } from "@/validators/itemFurniture";
import type { cacheConsumptionResponseSchema } from "@/validators/weightedCache";

/**
 * Thin quest-state fetch for tracker emits: only the relations getNewTrackers needs
 * (active + achievement userQuests, plus completedQuests for availability checks).
 * Avoids fetchUpdatedUser's fat row and its regen side-writes.
 */
export const fetchUserQuestState = async (client: DrizzleClient, userId: string) => {
  return await client.query.userData.findFirst({
    where: eq(userData.userId, userId),
    columns: { userId: true, questData: true },
    with: {
      userQuests: userQuestHistoryRelation,
      completedQuests: completedQuestHistoryRelation,
    },
  });
};

/** Load an item definition by ID; a missing definition yields undefined. */
export const fetchItem = async (client: DrizzleClient, id: string) => {
  return await client.query.item.findFirst({
    where: eq(item.id, id),
  });
};

/** Load an item with its required bloodline and crafting ingredient definitions. */
export const fetchItemWithCraftingRequirements = async (
  client: DrizzleClient,
  id: string,
) => {
  return await client.query.item.findFirst({
    where: eq(item.id, id),
    with: {
      craftingRequirements: {
        with: {
          requirementItem: true,
        },
      },
      requiredBloodline: true,
    },
  });
};

/** Load one positive-quantity inventory row belonging to the user, including its item definition. */
export const fetchUserItem = async (
  client: DrizzleClient,
  userId: string,
  userItemId: string,
) => {
  return await client.query.userItem.findFirst({
    where: and(
      eq(userItem.userId, userId),
      eq(userItem.id, userItemId),
      gt(userItem.quantity, 0),
    ),
    with: { item: true },
  });
};

/** Load an owned positive-quantity inventory row with its item variants in display order. */
export const fetchUserItemWithVariants = async (
  client: DrizzleClient,
  userId: string,
  userItemId: string,
) => {
  return await client.query.userItem.findFirst({
    where: and(
      eq(userItem.userId, userId),
      eq(userItem.id, userItemId),
      gt(userItem.quantity, 0),
    ),
    with: { item: { with: { variants: { orderBy: (v, { asc }) => [asc(v.order)] } } } },
  });
};

// Does the caller own at least one userItem whose itemId matches the variant's
// itemId? Shared by purchaseVariant and consumeVariantToken so both apply the
// exact same ownership filter. Returns an array; callers check `.length`.
//
// Ownership is only required at purchase/consume time. The unlock itself lives on
// userItemVariant keyed by (userId, variantId) and intentionally persists per-user
// even after every copy of the item is sold or consumed — "you keep what you paid
// for". This mirrors the jutsu Reskin model; re-acquiring the item later restores
// access to the already-unlocked variant without paying again.
/** Load at most one positive-quantity owned item matching a variant; callers check the returned array length. */
export const fetchVariantOwnership = async (
  client: DrizzleClient,
  userId: string,
  variantId: string,
) => {
  return await client
    .select({ id: userItem.id })
    .from(userItem)
    .innerJoin(itemVariant, eq(userItem.itemId, itemVariant.itemId))
    .where(
      and(
        eq(userItem.userId, userId),
        eq(itemVariant.id, variantId),
        gt(userItem.quantity, 0),
      ),
    )
    .limit(1);
};

/** Load saved item loadouts in stable createdAt/id order for one account. */
export const fetchItemLoadouts = async (client: DrizzleClient, userId: string) => {
  return await client.query.itemLoadout.findMany({
    where: eq(itemLoadout.userId, userId),
    // id is the deterministic tie-breaker so ties on createdAt (possible after a
    // batched backfill) keep a stable order across reads.
    orderBy: (table) => [asc(table.createdAt), asc(table.id)],
  });
};

/**
 * Item and quest acquisition share this history so a mode cannot be rolled twice.
 *
 * @param client - Drizzle client.
 * @param userId - Player whose `SageModeRolls` rows to load.
 */
export const fetchSageModeRolls = async (client: DrizzleClient, userId: string) => {
  return await client.query.sageModeRolls.findMany({
    where: eq(sageModeRolls.userId, userId),
    with: { sageMode: true },
  });
};

/**
 * Visible catalog rows for item-roll pooling. Hidden modes are staff-only and
 * are never granted by `rollsagemode`.
 *
 * @param client - Drizzle client.
 */
export const fetchSageModes = async (client: DrizzleClient) => {
  return await client.query.sageMode.findMany({ where: eq(sageMode.hidden, false) });
};

// Fetch candidate calendar periods upfront, before the item's period is known.
/** Build the daily, weekly and monthly purchase-counter lookup before the item period is known. */
export const fetchPurchaseCounters = (
  client: DrizzleClient,
  userId: string,
  itemId: string,
  now: Date,
) =>
  client.query.itemPurchaseCounter.findMany({
    where: and(
      eq(itemPurchaseCounter.userId, userId),
      eq(itemPurchaseCounter.itemId, itemId),
      inArray(
        itemPurchaseCounter.periodStart,
        (["DAILY", "WEEKLY", "MONTHLY"] as const)
          .map((period) => getItemPurchasePeriodStart(period, now))
          .filter((start) => start !== null),
      ),
    ),
  });

/** Load worn gear and its effect sources with the mutation's initial user snapshot. */
export const fetchUserEquipmentSnapshot = (client: DrizzleClient, userId: string) =>
  client.query.userData.findFirst({
    where: eq(userData.userId, userId),
    with: {
      titles: true,
      bloodline: { columns: { effects: true } },
      userSkills: {
        where: eq(userSkill.activated, true),
        with: { skill: { columns: { target: true, effects: true } } },
      },
      items: {
        where: and(ne(userItem.equipped, "NONE"), gt(userItem.quantity, 0)),
        with: { item: true, imbuements: { with: { item: true } } },
      },
    },
  });

/**
 * Validate current reward sources, including nested containers and dynamic item pools.
 * Batch each dependent layer and visit each ID once, so self-rewards and cycles terminate.
 * The candidate row replaces its saved version when an editor changes a self-rewarding cache.
 */
export const fetchCacheReferencedItems = async (
  client: DrizzleClient,
  source: Pick<Item, "id" | "name" | "bloodlineId" | "effects">,
) => {
  const cacheEffects = source.effects.flatMap((effect) =>
    effect.type === "noncombatconsumereward" && effect.weightedCache ? [effect] : [],
  );
  const hasActiveCache = cacheEffects.some(
    (effect) => effect.rewardMode === "weightedCache",
  );
  // Validate retained cache pools too, without activating their retained Standard grants.
  let effectGroups = [
    [
      ...(hasActiveCache ? source.effects : []),
      ...cacheEffects
        .filter((effect) => effect.rewardMode !== "weightedCache")
        .map((effect) => ({
          ...effect,
          rewardMode: "weightedCache" as const,
        })),
    ],
  ];
  const requested = new Set<string>();
  const found = new Map<string, typeof source>();
  let hasCheckedHunting = false;
  let hasCheckedGathering = false;
  while (effectGroups.length > 0) {
    const rewards = effectGroups.map((effects) => {
      const rewards = effects.filter(
        (effect) => effect.type === "noncombatconsumereward",
      );
      // Consumption merges sibling material flags and allowlists within each item.
      return {
        caches: rewards.filter((effect) => effect.rewardMode === "weightedCache"),
        standard: collapseRewards(
          rewards.filter((effect) => effect.rewardMode !== "weightedCache"),
        ),
      };
    });
    const ids = [
      ...new Set(
        rewards.flatMap(({ caches, standard }) => [
          ...caches.flatMap((effect) =>
            effect.weightedCache ? cacheItemIds(effect.weightedCache) : [],
          ),
          ...standard.reward_items.flatMap((reward) => reward.ids),
          ...(standard.reward_hunter_items ? standard.reward_hunter_items_ids : []),
          ...(standard.reward_gathering_items
            ? standard.reward_gathering_items_ids
            : []),
        ]),
      ),
    ].filter((id) => !requested.has(id) && !found.has(id));
    const hunting: boolean =
      !hasCheckedHunting &&
      rewards.some(
        ({ standard }) =>
          standard.reward_hunter_items && !standard.reward_hunter_items_ids.length,
      );
    const gathering: boolean =
      !hasCheckedGathering &&
      rewards.some(
        ({ standard }) =>
          standard.reward_gathering_items &&
          !standard.reward_gathering_items_ids.length,
      );
    if (ids.length === 0 && !hunting && !gathering) break;
    for (const id of ids) requested.add(id);
    hasCheckedHunting ||= hunting;
    hasCheckedGathering ||= gathering;
    const queryIds = ids.filter((id) => id !== source.id);
    const rows =
      queryIds.length > 0 || hunting || gathering
        ? await client.query.item.findMany({
            columns: { id: true, name: true, bloodlineId: true, effects: true },
            where: or(
              queryIds.length > 0 ? inArray(item.id, queryIds) : undefined,
              hunting ? eq(item.canBeHunted, true) : undefined,
              gathering ? eq(item.canBeGathered, true) : undefined,
            ),
          })
        : [];
    if (ids.includes(source.id)) rows.push(source);
    effectGroups = [];
    for (const row of rows) {
      if (found.has(row.id)) continue;
      const entry = row.id === source.id ? source : row;
      found.set(entry.id, entry);
      effectGroups.push(entry.effects);
    }
  }
  const items = [...found.values()];
  return {
    items,
    missing: [...requested].filter((id) => !found.has(id)),
    restricted: items.filter(isRestrictedCacheReward).map((entry) => entry.name),
  };
};

/** Inventory fields that determine whether stacks can be safely claimed and merged. */
export type UserItemMergeBucketRow = Pick<
  UserItem,
  | "id"
  | "createdAt"
  | "updatedAt"
  | "itemId"
  | "quantity"
  | "level"
  | "experience"
  | "equipped"
  | "storedAtHome"
  | "activeVariantId"
  | "durability"
  | "craftingFinishedAt"
  | "dropChancePerc"
>;

/** Build the `item` listing for `getAllNames`. */
export const listItemForGetAllNames = (client: Pick<DrizzleClient, "query">) =>
  client.query.item.findMany({
    columns: {
      id: true,
      name: true,
      image: true,
      canBeHunted: true,
      canBeGathered: true,
      bloodlineId: true,
      effects: true,
    },
    orderBy: (table, { asc }) => [asc(table.name)],
  });

/** Build the `item` listing for `getBloodlineItemNames`, selecting only `id` and `name`, using the configured predicates. */
export const listItemForGetBloodlineItemNames = (
  client: Pick<DrizzleClient, "query">,
  bloodlineId: string,
) =>
  client.query.item.findMany({
    columns: { id: true, name: true },
    where: (table, { eq }) => eq(table.bloodlineId, bloodlineId),
    orderBy: (table, { asc }) => [asc(table.name)],
  });

/** Build the `item` insert for `create`. */
export const insertItemForCreate = (
  client: Pick<DrizzleClient, "insert">,
  id: string,
  input: { type: import("@/drizzle/schema").ItemType },
) =>
  client.insert(item).values({
    id: id,
    name: `New Item - ${id}`,
    image: IMG_AVATAR_DEFAULT,
    description: "New item description",
    itemType: input.type,
    rarity: "COMMON",
    slot: "ITEM",
    target: "CHARACTER",
    effects: [],
    hidden: true,
    ...(input.type === "MEAL"
      ? { ...MEAL_ITEM_DEFAULTS, inShop: false, canBeTraded: true }
      : {}),
    ...(input.type === "FURNITURE"
      ? {
          ...FURNITURE_ITEM_DEFAULTS,
          furnitureData: { ...DEFAULT_FURNITURE_DATA },
          effects: [],
          inShop: false,
          cost: 0,
          repsCost: 0,
          seichiSilverCost: 0,
        }
      : {}),
  });

/** Build the `item` insert for `clone`. */
export const insertItemForClone = (
  client: Pick<DrizzleClient, "insert">,
  clonedItem: import("@/drizzle/schema").Item & {
    craftingRequirements: (import("@/drizzle/schema").CraftingRequirement & {
      requirementItem: import("@/drizzle/schema").Item;
    })[];
    requiredBloodline: null | import("@/drizzle/schema").Bloodline;
  },
) => client.insert(item).values(clonedItem);

/** Build the `craftingRequirement` insert for `clone`. */
export const insertCraftingRequirementForClone = (
  client: Pick<DrizzleClient, "insert">,
  itemData: {
    craftingRequirements: (import("@/drizzle/schema").CraftingRequirement & {
      requirementItem: import("@/drizzle/schema").Item;
    })[];
  },
  newItemId: string,
) =>
  client.insert(craftingRequirement).values(
    itemData.craftingRequirements.map((req) => ({
      id: nanoid(),
      craftItemId: newItemId,
      requirementItemId: req.requirementItemId,
      quantity: req.quantity,
    })),
  );

/** Build the `item` listing for `delete`, selecting only `id` and `name`, using predicates on `parentItemId`. */
export const listItemForDelete = (
  client: Pick<DrizzleClient, "query">,
  input: { id: string },
) =>
  client.query.item.findMany({
    columns: { id: true, name: true },
    where: eq(item.parentItemId, input.id),
  });

/** Build the `itemVariant` listing for `delete`, selecting only `id`, using predicates on `itemId`. */
export const listItemVariantForDelete = (
  client: Pick<DrizzleClient, "query">,
  input: { id: string },
) =>
  client.query.itemVariant.findMany({
    where: eq(itemVariant.itemId, input.id),
    columns: { id: true },
  });

/** Find surviving variants that require this item as their unlock token. */
export const listItemVariantRequiringItemForDelete = (
  client: Pick<DrizzleClient, "query">,
  input: { id: string },
) =>
  client.query.itemVariant.findMany({
    where: and(
      eq(itemVariant.requiredItemId, input.id),
      ne(itemVariant.itemId, input.id),
    ),
    columns: { name: true },
  });

/**
 * Build the `huntingSession` lookup for `delete`, selecting only `userId`, using
 * predicates on `content` and `contractId`.
 */
export const findHuntingSessionForDelete = (
  client: Pick<DrizzleClient, "query">,
  input: { id: string },
) =>
  client.query.huntingSession.findFirst({
    columns: { userId: true },
    where: sql`JSON_CONTAINS(${huntingSession.content}, JSON_OBJECT('id', ${huntingSession.contractId}, 'rewards', JSON_ARRAY(JSON_OBJECT('itemId', ${input.id}))), '$.contracts') = 1`,
  });

/** Build the `userItemVariant` deletion for `delete`, using predicates on `variantId`. */
export const deleteUserItemVariantForDelete = (
  client: Pick<DrizzleClient, "delete">,
  variants: Pick<import("@/drizzle/schema").DungeonRun, "id">[],
) =>
  client.delete(userItemVariant).where(
    inArray(
      userItemVariant.variantId,
      variants.map((v) => v.id),
    ),
  );

/** Build the `itemVariant` deletion for `delete`, using predicates on `itemId`. */
export const deleteItemVariantForDelete = (
  client: Pick<DrizzleClient, "delete">,
  input: { id: string },
) => client.delete(itemVariant).where(eq(itemVariant.itemId, input.id));

/** Build the `userItem` deletion for `delete`, using predicates on `itemId`. */
export const deleteUserItemForDelete = (
  client: Pick<DrizzleClient, "delete">,
  input: { id: string },
) => client.delete(userItem).where(eq(userItem.itemId, input.id));

/** Build the `userItemImbuement` deletion for `delete`, using predicates on `imbuementItemId`. */
export const deleteUserItemImbuementForDelete = (
  client: Pick<DrizzleClient, "delete">,
  input: { id: string },
) =>
  client
    .delete(userItemImbuement)
    .where(eq(userItemImbuement.imbuementItemId, input.id));

/** Build the `item` selection for `delete`, using predicates on `parentItemId`. */
export const selectItemForDelete = (
  client: Pick<DrizzleClient, "select">,
  input: { id: string },
) =>
  client
    .select({ id: item.id })
    .from(item)
    .where(eq(item.parentItemId, input.id))
    .as("evolutionChildren");

/** Build the `item` deletion for `delete`, using predicates on `id`. */
export const deleteItemForDelete = (
  client: Pick<DrizzleClient, "delete" | "select">,
  input: { id: string },
  evolutionChildGuard: ReturnType<typeof selectItemForDelete>,
) =>
  client.delete(item).where(
    and(
      eq(item.id, input.id),
      notExists(client.select({ one: sql`1` }).from(evolutionChildGuard)),
      notExists(
        client
          .select({ one: sql`1` })
          .from(itemVariant)
          .where(
            and(
              eq(itemVariant.requiredItemId, input.id),
              ne(itemVariant.itemId, input.id),
            ),
          ),
      ),
    ),
  );

/** Build the `actionLog` insert for `delete`. */
export const insertActionLogForDelete = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  entry: { name: string; id: string; image: string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "item",
    changes: [`Deleted: ${entry.name}`],
    relatedId: entry.id,
    relatedMsg: `Delete: ${entry.name}`,
    relatedImage: entry.image,
  });

/** Build the `item` lookup for `update`, selecting only `name` and `id`, using predicates on `name`. */
export const findItemForUpdate = (
  client: Pick<DrizzleClient, "query">,
  input: { data: { name: string } },
) =>
  client.query.item.findFirst({
    columns: { name: true, id: true },
    where: eq(item.name, input.data.name),
  });

/** Build the `item` listing for `update`, selecting only `id`, using predicates on `parentItemId`. */
export const listItemForUpdate = (
  client: Pick<DrizzleClient, "query">,
  input: { data: { parentItemId: string } },
) =>
  client.query.item.findMany({
    columns: { id: true },
    where: eq(item.parentItemId, input.data.parentItemId),
  });

/** Build the `item` listing for `update`, selecting only `id` and `parentItemId`, using predicates on `parentItemId`. */
export const listItemForUpdate2 = (client: Pick<DrizzleClient, "query">) =>
  client.query.item.findMany({
    columns: { id: true, parentItemId: true },
    where: isNotNull(item.parentItemId),
  });

/** Build the `item` selection for `update`, using predicates on `id`. */
export const selectItemForUpdate = (
  client: Pick<DrizzleClient, "select">,
  input: { data: { parentItemId: string } },
) =>
  client
    .select({ id: item.id })
    .from(item)
    .where(eq(item.id, input.data.parentItemId))
    .as("parentItemForEvo");

/** Build the `item` selection for `update`, using predicates on `parentItemId` and `id`. */
export const selectItemForUpdate2 = (
  client: Pick<DrizzleClient, "select">,
  input: { data: { parentItemId: string }; id: string },
) =>
  client
    .select({ cnt: count().as("cnt") })
    .from(item)
    .where(and(eq(item.parentItemId, input.data.parentItemId), ne(item.id, input.id)))
    .as("evoSiblingCount");

/** Build the `parentItemForEvo` selection for `evoForUpdate`. */
export const selectParentItemForEvoForUpdate = (
  client: Pick<DrizzleClient, "select">,
  parentItemForEvo: ReturnType<typeof selectItemForUpdate>,
) => client.select({ one: sql`1` }).from(parentItemForEvo);

/** Build the `evoSiblingCount` selection for `update`. */
export const selectEvoSiblingCountForUpdate = (
  client: Pick<DrizzleClient, "select">,
  evoSiblingCount: ReturnType<typeof selectItemForUpdate2>,
) => client.select({ cnt: evoSiblingCount.cnt }).from(evoSiblingCount);

/** Build the `item` update for `update`, setting `updatedAt`, using predicates on `id`. */
export const updateItemForUpdate = (
  client: Pick<DrizzleClient, "update">,
  input: { data: import("@/validators/combat").ZodItemType; id: string },
  evolutionUpdateGuards: SQL<unknown>[],
) =>
  client
    .update(item)
    .set({ ...input.data, updatedAt: new Date() })
    .where(and(eq(item.id, input.id), ...evolutionUpdateGuards));

/** Build the `craftingRequirement` deletion for `update`, using predicates on `craftItemId`. */
export const deleteCraftingRequirementForUpdate = (
  client: Pick<DrizzleClient, "delete">,
  input: { id: string },
) =>
  client
    .delete(craftingRequirement)
    .where(eq(craftingRequirement.craftItemId, input.id));

/** Build the `craftingRequirement` insert for `update`. */
export const insertCraftingRequirementForUpdate = (
  client: Pick<DrizzleClient, "insert">,
  newRequirements: { ids: string[]; number: number }[],
  input: { id: string },
) =>
  client.insert(craftingRequirement).values(
    newRequirements.flatMap((req) =>
      req.ids?.map((id) => ({
        id: nanoid(),
        craftItemId: input.id,
        requirementItemId: id,
        quantity: req.number,
      })),
    ),
  );

/** Build the `actionLog` insert for `update`. */
export const insertActionLogForUpdate = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  diff: string[],
  entry: { id: string; name: string; image: string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "item",
    changes: diff,
    relatedId: entry.id,
    relatedMsg: `Update: ${entry.name}`,
    relatedImage: entry.image,
  });

/** Build the `userItem` update for `update`, setting `equipped`, using predicates on `itemId`. */
export const updateUserItemForUpdate = (
  client: Pick<DrizzleClient, "update">,
  entry: { id: string },
) =>
  client
    .update(userItem)
    .set({ equipped: "NONE" })
    .where(eq(userItem.itemId, entry.id));

/** Build the `item` listing for `getEvolutions`, using predicates on `parentItemId`. */
export const listItemForGetEvolutions = (
  client: Pick<DrizzleClient, "query">,
  input: { itemId: string },
) =>
  client.query.item.findMany({
    where: eq(item.parentItemId, input.itemId),
    orderBy: (table, { asc: orderAsc }) => [orderAsc(table.requiredLevel)],
  });

/** Build the `userItem` update for `evolveItem`, including predicates on `id`, `userId`, `itemId`. */
export const updateUserItemForEvolveItem = (
  client: Pick<DrizzleClient, "update">,
  input: { evolutionItemId: string; userItemId: string },
  evolutionItem: { maxDurability: number },
  canKeepEquipped: false | true,
  ctx: { userId: string },
  parentItemId: string,
  userItemObj: { level: number },
) =>
  client
    .update(userItem)
    .set({
      itemId: input.evolutionItemId,
      level: 1,
      experience: 0,
      activeVariantId: null,
      durability: sql`LEAST(${userItem.durability}, ${evolutionItem.maxDurability})`,
      updatedAt: new Date(),
      ...(canKeepEquipped ? {} : { equipped: "NONE" as const }),
    })
    .where(
      and(
        eq(userItem.id, input.userItemId),
        eq(userItem.userId, ctx.userId),
        eq(userItem.itemId, parentItemId),
        eq(userItem.level, userItemObj.level),
        eq(userItem.quantity, 1),
        eq(userItem.isInAuction, false),
        or(
          isNull(userItem.craftingFinishedAt),
          lte(userItem.craftingFinishedAt, new Date()),
        ),
      ),
    );

/** Build the `userItem` lookup for `evolveItem`, selecting only `id`, using predicates on `id`, `userId`, `itemId`. */
export const findUserItemForEvolveItem = (
  client: Pick<DrizzleClient, "query">,
  input: { userItemId: string; evolutionItemId: string },
  ctx: { userId: string },
) =>
  client.query.userItem.findFirst({
    where: and(
      eq(userItem.id, input.userItemId),
      eq(userItem.userId, ctx.userId),
      eq(userItem.itemId, input.evolutionItemId),
    ),
    columns: { id: true },
  });

/** Build the `userItemImbuement` deletion for `evolveItem`, using predicates on `id`. */
export const deleteUserItemImbuementForEvolveItem = (
  client: Pick<DrizzleClient, "delete">,
  imbuementsToRemove: (import("@/drizzle/schema").UserItemImbuement & {
    item: import("@/drizzle/schema").Item;
  })[],
) =>
  client.delete(userItemImbuement).where(
    inArray(
      userItemImbuement.id,
      imbuementsToRemove.map((imb) => imb.id),
    ),
  );

/** Build the `userItem` insert for `evolveItem`. */
export const insertUserItemForEvolveItem = (
  client: Pick<DrizzleClient, "insert">,
  imbuementsToRemove: (import("@/drizzle/schema").UserItemImbuement & {
    item: import("@/drizzle/schema").Item;
  })[],
  ctx: { userId: string },
) =>
  client.insert(userItem).values(
    imbuementsToRemove.map((imb) => ({
      id: nanoid(),
      userId: ctx.userId,
      itemId: imb.imbuementItemId,
      quantity: 1,
      equipped: "NONE" as const,
      storedAtHome: false,
      isInAuction: false,
      craftingFinishedAt: null,
    })),
  );

/** Build the `itemLoadout` update for `evolveItem`, setting `itemData`, using predicates on `id` and `userId`. */
export const updateItemLoadoutForEvolveItem = (
  client: Pick<DrizzleClient, "update">,
  itemData: {
    userItemId?: undefined | string;
    itemId: string;
    slot: import("@/drizzle/schema").ItemSlot;
  }[],
  loadout: { id: string },
  ctx: { userId: string },
) =>
  client
    .update(itemLoadout)
    .set({ itemData })
    .where(and(eq(itemLoadout.id, loadout.id), eq(itemLoadout.userId, ctx.userId)));

/** Build the `actionLog` insert for `evolveItem`. */
export const insertActionLogForEvolveItem = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  userItemObj: { item: { name: string } },
  evolutionItem: { name: string; image: string },
  input: { evolutionItemId: string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "userItem",
    changes: [`Evolved ${userItemObj.item.name} into ${evolutionItem.name}`],
    relatedId: input.evolutionItemId,
    relatedMsg: "ItemEvolution",
    relatedImage: evolutionItem.image,
  });

/** Build the `item` listing for `getAll`, using the configured predicates. */
export const listItemForGetAll = (
  client: Pick<DrizzleClient, "query">,
  skip: number,
  input: { limit: number },
  baseFilters: import("@/utils/typeutils").QueryCondition[],
) =>
  client.query.item.findMany({
    offset: skip,
    limit: input.limit,
    where: and(...baseFilters),
    orderBy: (table, { asc }) => [asc(table.cost), asc(table.repsCost), asc(table.id)],
  });

/** Build the `userItem` selection for `getUserItemCounts`, using predicates on `userId` and `quantity`. */
export const selectUserItemForGetUserItemCounts = (
  client: Pick<DrizzleClient, "select">,
  ctx: { userId: string },
) =>
  client
    .select({
      count: count(userItem.id),
      itemId: userItem.itemId,
      quantity: sql<number>`sum(${userItem.quantity})`,
    })
    .from(userItem)
    .where(and(eq(userItem.userId, ctx.userId), gt(userItem.quantity, 0)))
    .groupBy(userItem.itemId);

/** Build the `userItem` lookup for `adjustUserItem`, using predicates on `id`, `userId`, `quantity`. */
export const findUserItemForAdjustUserItem = (
  client: Pick<DrizzleClient, "query">,
  input: { userItemId: string; userId: string },
) =>
  client.query.userItem.findFirst({
    where: and(
      eq(userItem.id, input.userItemId),
      eq(userItem.userId, input.userId),
      gt(userItem.quantity, 0),
    ),
    with: { item: true },
  });

/**
 * Build the `userItem` update for `adjustUserItem`, setting `level` and `updatedAt`,
 * including predicates on `id`, `userId`, `level`.
 */
export const updateUserItemForAdjustUserItem = (
  client: Pick<DrizzleClient, "update">,
  input: { level: number; userItemId: string; userId: string },
  owned: { level: number; experience: number },
) =>
  client
    .update(userItem)
    .set({
      level: input.level,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(userItem.id, input.userItemId),
        eq(userItem.userId, input.userId),
        eq(userItem.level, owned.level),
        eq(userItem.experience, owned.experience),
        gt(userItem.quantity, 0),
      ),
    );

/** Build the `actionLog` insert for `adjustUserItem`. */
export const insertActionLogForAdjustUserItem = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  owned: { item: { name: string; image: string }; level: number },
  input: { level: number; userId: string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "user",
    changes: [`Item ${owned.item.name} lvl ${owned.level} -> ${input.level}`],
    relatedId: input.userId,
    relatedMsg: `Update: ${owned.item.name}`,
    relatedImage: owned.item.image,
  });

/** Build the `itemVariant` listing for `getItemVariants`, using predicates on `itemId`. */
export const listItemVariantForGetItemVariants = (
  client: Pick<DrizzleClient, "query">,
  input: { itemId: string },
) =>
  client.query.itemVariant.findMany({
    where: eq(itemVariant.itemId, input.itemId),
    orderBy: asc(itemVariant.order),
  });

/** Build the `userItemVariant` selection for `getUserUnlockedVariants`, using predicates on `userId` and `itemId`. */
export const selectUserItemVariantForGetUserUnlockedVariants = (
  client: Pick<DrizzleClient, "select">,
  ctx: { userId: string },
  input: { itemId: string },
) =>
  client
    .select({
      id: userItemVariant.id,
      userId: userItemVariant.userId,
      variantId: userItemVariant.variantId,
      createdAt: userItemVariant.createdAt,
    })
    .from(userItemVariant)
    .innerJoin(itemVariant, eq(userItemVariant.variantId, itemVariant.id))
    .where(
      and(eq(userItemVariant.userId, ctx.userId), eq(itemVariant.itemId, input.itemId)),
    );

/** Build the `itemVariant` listing for `upsertItemVariant`, using predicates on `itemId`. */
export const listItemVariantForUpsertItemVariant = (
  client: Pick<DrizzleClient, "query">,
  input: { itemId: string },
) =>
  client.query.itemVariant.findMany({
    where: eq(itemVariant.itemId, input.itemId),
  });

/** Build the `item` lookup for `upsertItemVariant`, using predicates on `id`. */
export const findItemForUpsertItemVariant = (
  client: Pick<DrizzleClient, "query">,
  input: { itemId: string },
) =>
  client.query.item.findFirst({
    where: eq(item.id, input.itemId),
    columns: { id: true, name: true, itemType: true, effects: true },
  });

/** Update a variant only while its parent and optional required unlock item exist. */
export const updateItemVariantForUpsertItemVariant = (
  client: Pick<DrizzleClient, "update">,
  input: {
    variant: {
      name: string;
      image: string;
      requiredItemId: string | null;
      costType: VariantCostType;
      cost: number;
      order: number;
      furnitureData: null | FurnitureVariantData;
      id: string;
    };
    itemId: string;
  },
  safeDescription: null | string,
  safeBattleDescription: null | string,
) =>
  client
    .update(itemVariant)
    .set({
      name: input.variant.name,
      image: input.variant.image,
      requiredItemId: input.variant.requiredItemId,
      costType: input.variant.costType,
      cost: input.variant.cost,
      order: input.variant.order,
      description: safeDescription,
      battleDescription: safeBattleDescription,
      furnitureData: input.variant.furnitureData,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(itemVariant.id, input.variant.id),
        eq(itemVariant.itemId, input.itemId),
        exists(sql`(SELECT 1 FROM ${item} WHERE ${eq(item.id, input.itemId)})`),
        input.variant.requiredItemId
          ? exists(
              sql`(SELECT 1 FROM ${item} WHERE ${eq(item.id, input.variant.requiredItemId)})`,
            )
          : undefined,
      ),
    );

/** Insert with live item references; duplicate keys leave the saved variant unchanged. */
export const insertItemVariantForUpsertItemVariant = (
  client: Pick<DrizzleClient, "execute">,
  newVariantId: string,
  input: {
    itemId: string;
    variant: {
      name: string;
      image: string;
      requiredItemId: string | null;
      costType: VariantCostType;
      cost: number;
      order: number;
      furnitureData: null | FurnitureVariantData;
    };
  },
  safeDescription: null | string,
  safeBattleDescription: null | string,
) => {
  const values = {
    id: newVariantId,
    itemId: input.itemId,
    name: input.variant.name,
    image: input.variant.image,
    requiredItemId: input.variant.requiredItemId,
    costType: input.variant.costType,
    cost: input.variant.cost,
    order: input.variant.order,
    description: safeDescription,
    battleDescription: safeBattleDescription,
    furnitureData: input.variant.furnitureData,
  };
  const columns = getTableColumns(itemVariant);
  const keys = Object.keys(values) as (keyof typeof values)[];
  // INSERT SELECT keeps both item references valid at the moment the variant is saved.
  return client.execute(sql`
    INSERT INTO ${itemVariant} (${sql.join(
      keys.map((key) => sql.identifier(columns[key].name)),
      sql`, `,
    )})
    SELECT ${sql.join(
      keys.map((key) => sql.param(values[key], columns[key])),
      sql`, `,
    )}
    WHERE EXISTS (SELECT 1 FROM ${item} WHERE ${eq(item.id, input.itemId)})
      AND ${input.variant.requiredItemId ? exists(sql`(SELECT 1 FROM ${item} WHERE ${eq(item.id, input.variant.requiredItemId)})`) : sql`TRUE`}
    ON DUPLICATE KEY UPDATE id = id
  `);
};

/** Build the `itemVariant` selection for `upsertItemVariant`, using predicates on `itemId`. */
export const selectItemVariantForUpsertItemVariant = (
  client: Pick<DrizzleClient, "select">,
  input: { itemId: string },
) =>
  client
    .select({ n: count() })
    .from(itemVariant)
    .where(eq(itemVariant.itemId, input.itemId));

/** Build deletion of an item variant by ID. */
export const deleteItemVariantById = (
  client: Pick<DrizzleClient, "delete">,
  variantId: string,
) => client.delete(itemVariant).where(eq(itemVariant.id, variantId));

/** Build the `itemVariant` lookup for `deleteItemVariant`, using predicates on `id`. */
export const findItemVariantForDeleteItemVariant = (
  client: Pick<DrizzleClient, "query">,
  input: { variantId: string },
) =>
  client.query.itemVariant.findFirst({
    where: eq(itemVariant.id, input.variantId),
    with: { item: { columns: { id: true, name: true } } },
  });

/** Build the `userItemVariant` deletion for `deleteItemVariant`, using predicates on `variantId`. */
export const deleteUserItemVariantForDeleteItemVariant = (
  client: Pick<DrizzleClient, "delete">,
  input: { variantId: string },
) =>
  client.delete(userItemVariant).where(eq(userItemVariant.variantId, input.variantId));

/** Build the `userItem` update for `deleteItemVariant`, setting `activeVariantId`, using predicates on `activeVariantId`. */
export const updateUserItemForDeleteItemVariant = (
  client: Pick<DrizzleClient, "update">,
  input: { variantId: string },
) =>
  client
    .update(userItem)
    .set({ activeVariantId: null })
    .where(eq(userItem.activeVariantId, input.variantId));

/** Build the `itemVariant` lookup for `purchaseVariant`, using predicates on `id`. */
export const findItemVariantForPurchaseVariant = (
  client: Pick<DrizzleClient, "query">,
  input: { variantId: string },
) =>
  client.query.itemVariant.findFirst({
    where: eq(itemVariant.id, input.variantId),
  });

/** Build the `userItemVariant` lookup for `purchaseVariant`, using predicates on `userId` and `variantId`. */
export const findUserItemVariantForPurchaseVariant = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
  input: { variantId: string },
) =>
  client.query.userItemVariant.findFirst({
    where: and(
      eq(userItemVariant.userId, ctx.userId),
      eq(userItemVariant.variantId, input.variantId),
    ),
  });

/** Build the `userData` update for `purchaseVariant`, using predicates on `userId`. */
export const updateUserDataForPurchaseVariant = (
  client: Pick<DrizzleClient, "update">,
  currency: {
    decrementSet:
      | { money: SQL<unknown> }
      | { reputationPoints: SQL<unknown> }
      | { seichiSilver: SQL<unknown> }
      | { villagePrestige: SQL<unknown> };
    where: SQL<unknown>;
  },
  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set(currency.decrementSet)
    .where(and(eq(userData.userId, ctx.userId), currency.where));

/** Build the `userData` update for `refundCurrency`, using predicates on `userId`. */
export const updateUserDataForRefundCurrency = (
  client: Pick<DrizzleClient, "update">,
  currency: {
    incrementSet:
      | { money: SQL<unknown> }
      | { reputationPoints: SQL<unknown> }
      | { seichiSilver: SQL<unknown> }
      | { villagePrestige: SQL<unknown> };
  },
  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set(currency.incrementSet)
    .where(eq(userData.userId, ctx.userId));

/** Build the `userItemVariant` insert for `purchaseVariant`, updating duplicate keys. */
export const insertUserItemVariantForPurchaseVariant = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  input: { variantId: string },
) =>
  client
    .insert(userItemVariant)
    .values({ id: nanoid(), userId: ctx.userId, variantId: input.variantId })
    .onDuplicateKeyUpdate({ set: { id: sql`id` } });

/**
 * Build the `userItem` update for `selectVariant`, setting `activeVariantId`,
 * including predicates on `id`, `userId`, `quantity`.
 */
export const updateUserItemForSelectVariant = (
  client: Pick<DrizzleClient, "update" | "select">,
  input: { variantId: null | string; userItemId: string },
  ctx: { userId: string },
) =>
  client
    .update(userItem)
    .set({ activeVariantId: input.variantId })
    .where(
      and(
        eq(userItem.id, input.userItemId),
        eq(userItem.userId, ctx.userId),
        gt(userItem.quantity, 0),
        ...(input.variantId
          ? [
              exists(
                client
                  .select({ id: userItemVariant.id })
                  .from(userItemVariant)
                  .where(
                    and(
                      eq(userItemVariant.userId, ctx.userId),
                      eq(userItemVariant.variantId, input.variantId),
                    ),
                  ),
              ),
            ]
          : []),
      ),
    );

/** Build the `userItem` listing for `mergeAllStacks`, including predicates on `userId`, `quantity`, `storedAtHome`. */
export const listUserItemForMergeAllStacks = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
  storedAtHome: false | true,
) =>
  client.query.userItem.findMany({
    where: and(
      eq(userItem.userId, ctx.userId),
      gt(userItem.quantity, 0),
      eq(userItem.storedAtHome, storedAtHome),
      eq(userItem.isInAuction, false),
      or(
        isNull(userItem.craftingFinishedAt),
        lte(userItem.craftingFinishedAt, new Date()),
      ),
    ),
    with: { imbuements: true, item: true },
  });

/** Build the `villageStructure` selection for `sellUserItem`, using predicates on `villageId` and `userId`. */
export const selectVillageStructureForSellUserItem = (
  client: Pick<DrizzleClient, "select">,
  ctx: { userId: string },
) =>
  client
    .select()
    .from(villageStructure)
    .where(
      eq(
        villageStructure.villageId,
        sql`COALESCE((SELECT ${userData.villageId} FROM ${userData} WHERE ${userData.userId} = ${ctx.userId}), ${VILLAGE_SYNDICATE_ID})`,
      ),
    );

/** Build the `userItem` deletion for `sellUserItem`, including predicates on `id`, `userId`, `quantity`. */
export const deleteUserItemForSellUserItem = (
  client: Pick<DrizzleClient, "delete">,
  input: { userItemId: string },
  ctx: { userId: string },
  useritem: { quantity: number },
) =>
  client
    .delete(userItem)
    .where(
      and(
        eq(userItem.id, input.userItemId),
        eq(userItem.userId, ctx.userId),
        eq(userItem.quantity, useritem.quantity),
        gt(userItem.quantity, 0),
        eq(userItem.isInAuction, false),
        hasNoHuntingBattle(ctx.userId),
      ),
    );

/** Build the `userItemImbuement` deletion for `sellUserItem`, using predicates on `userItemId`. */
export const deleteUserItemImbuementForSellUserItem = (
  client: Pick<DrizzleClient, "delete">,
  input: { userItemId: string },
) =>
  client
    .delete(userItemImbuement)
    .where(eq(userItemImbuement.userItemId, input.userItemId));

/** Build the `actionLog` insert for `sellUserItem`. */
export const insertActionLogForSellUserItem = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  useritem: { item: { name: string; image: string } },
  cost: number,
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "user",
    changes: [`Sold item: ${useritem.item.name} for ${cost} ryo`],
    relatedId: ctx.userId,
    relatedMsg: `Sold item: ${useritem.item.name}`,
    relatedImage: useritem.item.image,
  });

/** Build the `itemLoadout` update for `toggleEquip`, setting `itemData`, using predicates on `id`. */
export const updateItemLoadoutForToggleEquip = (
  client: Pick<DrizzleClient, "update">,
  newItemData: {
    userItemId: string;
    itemId: string;
    slot: import("@/drizzle/schema").ItemSlot;
  }[],
  currentLoadout: { id: string },
) =>
  client
    .update(itemLoadout)
    .set({ itemData: newItemData })
    .where(eq(itemLoadout.id, currentLoadout.id));

/** Build the `itemLoadout` update for `unequipAllItems`, setting `itemData`, using predicates on `id` and `userId`. */
export const updateItemLoadoutForUnequipAllItems = (
  client: Pick<DrizzleClient, "update">,
  currentLoadout: { id: string },
  ctx: { userId: string },
) =>
  client
    .update(itemLoadout)
    .set({ itemData: [] })
    .where(
      and(eq(itemLoadout.id, currentLoadout.id), eq(itemLoadout.userId, ctx.userId)),
    );

/**
 * Build the `userItem` update for `unequipAllItems`, setting `equipped` and
 * `updatedAt`, including predicates on `id`, `userId`, `isInAuction`.
 */
export const updateUserItemForUnequipAllItems = (
  client: Pick<DrizzleClient, "update">,
  ui: { id: string },
  ctx: { userId: string },
) =>
  client
    .update(userItem)
    .set({
      equipped: "NONE",
      updatedAt: sql`GREATEST(NOW(3), TIMESTAMPADD(MICROSECOND, 1000, ${userItem.updatedAt}))`,
    })
    .where(
      and(
        eq(userItem.id, ui.id),
        eq(userItem.userId, ctx.userId),
        eq(userItem.isInAuction, false),
        gt(userItem.quantity, 0),
        hasNoHuntingBattle(ctx.userId),
      ),
    );

/** Build the `userPet` listing for `consume`, selecting only `id`, using predicates on `userId`. */
export const listUserPetForConsume = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.userPet.findMany({
    where: eq(userPet.userId, ctx.userId),
    columns: { id: true },
  });

/** Build the `bloodlineRolls` update for `consume`, setting `used` and `updatedAt`, using predicates on `id`. */
export const updateBloodlineRollsForConsume = (
  client: Pick<DrizzleClient, "update">,
  previousRoll: { id: string },
) =>
  client
    .update(bloodlineRolls)
    .set({ used: sql`${bloodlineRolls.used} + 1`, updatedAt: new Date() })
    .where(eq(bloodlineRolls.id, previousRoll.id));

/** Build the `bloodlineRolls` insert for `consume`. */
export const insertBloodlineRollsForConsume = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  success: false | true,
  randomBloodline: { id: string },
  effect: { rank: import("@/drizzle/schema").BloodlineRank },
) =>
  client.insert(bloodlineRolls).values({
    id: nanoid(),
    userId: ctx.userId,
    type: "ITEM",
    bloodlineId: success ? randomBloodline.id : null,
    goal: effect.rank,
    used: 1,
    pityRolls: 0,
  });

/** Build the `sageModeRolls` insert for `consume`. */
export const insertSageModeRollsForConsume = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  randomSageMode: { id: string },
) =>
  client.insert(sageModeRolls).values({
    id: nanoid(),
    userId: ctx.userId,
    type: "ITEM",
    sageModeId: randomSageMode.id,
  });

/** Build the `userSkill` insert for `consume`. */
export const insertUserSkillForConsume = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  parsedEffect: { skillId: string },
) =>
  client.insert(userSkill).values({
    id: nanoid(),
    userId: ctx.userId,
    skillId: parsedEffect.skillId,
    activated: false,
  });

/** Execute the database statement for `claim`, using predicates on `userId`, `id`, `updatedAt`. */
export const executeUserPetForClaim = (
  client: Pick<DrizzleClient, "execute" | "select">,
  user: {
    updatedAt: Date;
    activePetId: null | string;
    rank: import("@/drizzle/schema").UserRank;
    petAcquisitions: number;
    petSlots: number;
    federalStatus: import("@/drizzle/schema").FederalStatus;
    staffAccount: false | true;
    userId: string;
  },
  updates: {
    curHealth: number;
    curChakra: number;
    curStamina: number;
    marriageSlots: number;
    extraReskinSlots: number;
  },
  jutsuSlotIncrease: number,
  grantedSageModeId: null | string,
  petReward: null | import("@/drizzle/schema").UserPetInsert,
  useritem: { quantity: number; itemId: string; item: { updatedAt: Date } },
  ctx: { userId: string },
  input: { userItemId: string },
  grantedQuest: undefined | import("@/drizzle/schema").Quest,
  petCapacity: number,
  rewardSpeciesUpdatedAt: undefined | Date,
) =>
  client.execute(sql`
          UPDATE ${userData}
          INNER JOIN ${userItem} ON ${userItem.userId} = ${userData.userId}
          SET ${userData.updatedAt} = ${getNextUserSnapshotAt(user.updatedAt)},
              ${userData.curHealth} = ${updates.curHealth},
              ${userData.curChakra} = ${updates.curChakra},
              ${userData.curStamina} = ${updates.curStamina},
              ${userData.marriageSlots} = ${updates.marriageSlots},
              ${userData.extraReskinSlots} = ${updates.extraReskinSlots},
              ${jutsuSlotIncrease > 0 ? sql`${userData.extraJutsuSlots} = ${userData.extraJutsuSlots} + ${jutsuSlotIncrease},` : sql``}
              ${userData.sageModeId} = COALESCE(${userData.sageModeId}, ${grantedSageModeId}),
              ${petReward ? sql`${userData.petAcquisitions} = ${userData.petAcquisitions} + 1,` : sql``}
              ${petReward && !user.activePetId ? sql`${userData.activePetId} = ${petReward.id}, ${userData.petExperience} = 0,` : sql``}
              ${userItem.quantity} = ${useritem.quantity - 1}
          WHERE ${userData.userId} = ${ctx.userId}
            AND ${userData.updatedAt} = ${user.updatedAt}
            AND ${userData.status} = 'AWAKE'
            AND ${userData.battleId} IS NULL
            AND ${userItem.id} = ${input.userItemId}
            AND ${userItem.quantity} = ${useritem.quantity}
            AND ${userItem.itemId} = ${useritem.itemId}
            AND ${userItem.quantity} > 0
            AND ${userItem.isInAuction} = FALSE
            ${jutsuSlotIncrease > 0 ? sql`AND ${lte(userData.extraJutsuSlots, getJutsuSlotIncreaseLimit(jutsuSlotIncrease))}` : sql``}
            ${
              grantedQuest
                ? sql`AND NOT EXISTS (
              SELECT 1 FROM ${questHistory}
              WHERE ${questHistory.userId} = ${ctx.userId}
                AND ${questHistory.questId} = ${grantedQuest.id}
                AND ${questHistory.completed} = 0 AND ${questHistory.endAt} IS NULL
            ) AND EXISTS (
              SELECT 1 FROM ${quest} WHERE ${quest.id} = ${grantedQuest.id}
                AND ${quest.questType} = 'special' AND ${quest.updatedAt} = ${grantedQuest.updatedAt}
            ) AND EXISTS (
              SELECT 1 FROM ${item} WHERE ${item.id} = ${useritem.itemId}
                AND ${item.updatedAt} = ${useritem.item.updatedAt}
            )`
                : sql``
            }
            ${
              petReward
                ? sql`AND ${and(
                    eq(userData.isAi, false),
                    eq(userData.isBanned, false),
                    eq(userData.rank, user.rank),
                    eq(userData.petAcquisitions, user.petAcquisitions),
                    eq(userData.petSlots, user.petSlots),
                    eq(userData.federalStatus, user.federalStatus),
                    eq(userData.staffAccount, user.staffAccount),
                    user.activePetId
                      ? eq(userData.activePetId, user.activePetId)
                      : isNull(userData.activePetId),
                    lt(
                      client
                        .select({ count: count() })
                        .from(userPet)
                        .where(eq(userPet.userId, user.userId)),
                      petCapacity,
                    ),
                    exists(
                      client
                        .select({ id: petSpecies.id })
                        .from(petSpecies)
                        .where(
                          and(
                            eq(petSpecies.id, petReward.speciesId),
                            rewardSpeciesUpdatedAt
                              ? eq(petSpecies.updatedAt, rewardSpeciesUpdatedAt)
                              : undefined,
                          ),
                        ),
                    ),
                  )}`
                : sql``
            }
        `);

/** Build the `userData` update for `commitConsumption`, setting `bloodlineId`, using predicates on `userId`. */
export const updateUserDataForCommitConsumption = (
  client: Pick<DrizzleClient, "update">,
  changedBloodlineId: null | string,
  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set({
      ...bloodrightSwapRefund(changedBloodlineId),
      bloodlineId: changedBloodlineId,
    })
    .where(eq(userData.userId, ctx.userId));

/** Build deletion of an empty inventory row guarded by its owner and zero quantity. */
export const deleteEmptyUserItem = (
  client: Pick<DrizzleClient, "delete">,
  userItemId: string,
  userId: string,
) =>
  client
    .delete(userItem)
    .where(
      and(
        eq(userItem.id, userItemId),
        eq(userItem.userId, userId),
        eq(userItem.quantity, 0),
      ),
    );

/** Build a durability rollback guarded by the item owner and expected durability. */
export const restoreUserItemDurability = (
  client: Pick<DrizzleClient, "update">,
  durability: number,
  userItemId: string,
  userId: string,
  expectedDurability: number,
) =>
  client
    .update(userItem)
    .set({ durability: durability })
    .where(
      and(
        eq(userItem.id, userItemId),
        eq(userItem.userId, userId),
        eq(userItem.durability, expectedDurability),
      ),
    );

/** Build the `userData` update for `buy`, including predicates on `userId`, `updatedAt`, `money`. */
export const updateUserDataForBuy = (
  client: Pick<DrizzleClient, "update">,
  ryoCost: number,
  repsCost: number,
  seichiSilverCost: number,
  user: { updatedAt: Date },
  questDataUpdate: {
    questData?: undefined | import("@/validators/objectives").QuestTrackerType[];
  },
  uid: string,
) =>
  client
    .update(userData)
    .set({
      money: sql`${userData.money} - ${ryoCost}`,
      reputationPoints: sql`${userData.reputationPoints} - ${repsCost}`,
      seichiSilver: sql`${userData.seichiSilver} - ${seichiSilverCost}`,
      updatedAt: getNextUserSnapshotAt(user.updatedAt),
      ...questDataUpdate,
    })
    .where(
      and(
        eq(userData.userId, uid),
        eq(userData.updatedAt, user.updatedAt),
        gte(userData.money, ryoCost),
        gte(userData.reputationPoints, repsCost),
        gte(userData.seichiSilver, seichiSilverCost),
      ),
    );

/** Build the `itemPurchaseCounter` insert for `buy`, updating duplicate keys. */
export const insertItemPurchaseCounterForBuy = (
  client: Pick<DrizzleClient, "insert">,
  uid: string,
  iid: string,
  allowance: { period: "NONE" | "DAILY" | "WEEKLY" | "MONTHLY"; periodStart: Date },
) =>
  client
    .insert(itemPurchaseCounter)
    .values({
      userId: uid,
      itemId: iid,
      period: allowance.period,
      periodStart: allowance.periodStart,
      quantity: 0,
    })
    .onDuplicateKeyUpdate({
      set: { quantity: sql`${itemPurchaseCounter.quantity}` },
    });

/**
 * Build the `itemPurchaseCounter` update for `buy`, setting `quantity`, including
 * predicates on `userId`, `itemId`, `period`.
 */
export const updateItemPurchaseCounterForBuy = (
  client: Pick<DrizzleClient, "update">,
  input: { stack: number },
  uid: string,
  iid: string,
  allowance: {
    period: "NONE" | "DAILY" | "WEEKLY" | "MONTHLY";
    periodStart: Date;
    limit: number;
  },
) =>
  client
    .update(itemPurchaseCounter)
    .set({
      quantity: sql`${itemPurchaseCounter.quantity} + ${input.stack}`,
    })
    .where(
      and(
        eq(itemPurchaseCounter.userId, uid),
        eq(itemPurchaseCounter.itemId, iid),
        eq(itemPurchaseCounter.period, allowance.period),
        eq(itemPurchaseCounter.periodStart, allowance.periodStart),
        lte(itemPurchaseCounter.quantity, allowance.limit - input.stack),
      ),
    );

/**
 * Build the `userItem` update for `autoEquipOptimal`, setting `equipped`, including
 * predicates on `id`, `userId`, `equipped`.
 */
export const updateUserItemForAutoEquipOptimal = (
  client: Pick<DrizzleClient, "update" | "select">,
  assignment: { slot: import("@/drizzle/schema").ItemSlot; userItemId: string },
  user: { userId: string },
  now: Date,
) =>
  client
    .update(userItem)
    .set({ equipped: assignment.slot })
    .where(
      and(
        eq(userItem.id, assignment.userItemId),
        eq(userItem.userId, user.userId),
        eq(userItem.equipped, "NONE"),
        eq(userItem.storedAtHome, false),
        eq(userItem.isInAuction, false),
        gt(userItem.quantity, 0),
        or(isNull(userItem.craftingFinishedAt), lte(userItem.craftingFinishedAt, now)),
        notExists(
          client
            .select({ one: sql`1` })
            .from(userItemImbuement)
            .where(
              and(
                eq(userItemImbuement.userItemId, assignment.userItemId),
                gt(userItemImbuement.craftingFinishedAt, now),
              ),
            ),
        ),
      ),
    );

/** Build the `itemLoadout` insert for `insertMissing`, updating duplicate keys. */
export const insertItemLoadoutForInsertMissing = (
  client: Pick<DrizzleClient, "insert">,
  rows: import("@/drizzle/schema").ItemLoadout[],
) =>
  client
    .insert(itemLoadout)
    .values(rows)
    .onDuplicateKeyUpdate({ set: { id: sql`id` } });

/**
 * Build the `userData` update for `writeDefaultPointer`, setting `itemLoadout`, using
 * predicates on `userId` and `itemLoadout`.
 */
export const updateUserDataForWriteDefaultPointer = (
  client: Pick<DrizzleClient, "update">,
  id: string,
  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set({ itemLoadout: id })
    .where(and(eq(userData.userId, ctx.userId), isNull(userData.itemLoadout)));

/** Build the `itemLoadout` update for `renameLoadout`, setting `name`, using predicates on `id` and `userId`. */
export const updateItemLoadoutForRenameLoadout = (
  client: Pick<DrizzleClient, "update">,
  name: string,
  input: { id: string },
  ctx: { userId: string },
) =>
  client
    .update(itemLoadout)
    .set({ name })
    .where(and(eq(itemLoadout.id, input.id), eq(itemLoadout.userId, ctx.userId)));

/** Build the `itemLoadout` lookup for `renameLoadout`, selecting only `id`, using predicates on `id` and `userId`. */
export const findItemLoadoutForRenameLoadout = (
  client: Pick<DrizzleClient, "query">,
  input: { id: string },
  ctx: { userId: string },
) =>
  client.query.itemLoadout.findFirst({
    columns: { id: true },
    where: and(eq(itemLoadout.id, input.id), eq(itemLoadout.userId, ctx.userId)),
  });

/** Build the `petSpecies` listing for `fetchRewardPetSpecies`, using predicates on `id`. */
export const listPetSpeciesForFetchRewardPetSpecies = (
  client: Pick<DrizzleClient, "query">,
  ids: string[],
) => client.query.petSpecies.findMany({ where: inArray(petSpecies.id, ids) });

/**
 * Build the `userItem` update for `selectItemLoadout`, setting `equipped` and
 * `updatedAt`, using predicates on `userId` and `quantity`.
 */
export const updateUserItemForSelectItemLoadout = (
  client: Pick<DrizzleClient, "update">,
  equipped: import("@/drizzle/schema").ItemSlot,
  user: { userId: string },
) =>
  client
    .update(userItem)
    .set({
      equipped,
      // Even an unchanged loadout must acknowledge the hunting guard.
      updatedAt: sql`GREATEST(NOW(3), TIMESTAMPADD(MICROSECOND, 1000, ${userItem.updatedAt}))`,
    })
    .where(
      and(
        eq(userItem.userId, user.userId),
        gt(userItem.quantity, 0),
        hasNoHuntingBattle(user.userId),
      ),
    );

/** Build the `userData` update for `selectItemLoadout`, setting `itemLoadout`, using predicates on `userId`. */
export const updateUserDataForSelectItemLoadout = (
  client: Pick<DrizzleClient, "update">,
  loadout: { id: string },
  user: { userId: string },
) =>
  client
    .update(userData)
    .set({ itemLoadout: loadout.id })
    .where(eq(userData.userId, user.userId));

/** Build the `userItem` selection for `selectItemLoadout`, using predicates on `userId` and `id`. */
export const selectUserItemForSelectItemLoadout = (
  client: Pick<DrizzleClient, "select">,
  user: { userId: string },
  assignmentIds: string[],
) =>
  client
    .select({
      id: userItem.id,
      equipped: userItem.equipped,
      quantity: userItem.quantity,
      durability: userItem.durability,
      level: userItem.level,
      experience: userItem.experience,
    })
    .from(userItem)
    .where(and(eq(userItem.userId, user.userId), inArray(userItem.id, assignmentIds)));

/** Build the `userItem` selection for `getItemRelations`, using predicates on `itemId`, `equipped`, `isAi`. */
export const selectUserItemForGetItemRelations = (
  client: Pick<DrizzleClient, "select">,
  itemId: string,
) =>
  client
    .select({ id: userData.userId, name: userData.username })
    .from(userItem)
    .innerJoin(userData, eq(userItem.userId, userData.userId))
    .where(
      and(
        eq(userItem.itemId, itemId),
        ne(userItem.equipped, "NONE"),
        eq(userData.isAi, true),
      ),
    );

/** Build the `quest` listing for `getItemRelations`, selecting only `id` and `name`, using predicates on `content`. */
export const listQuestForGetItemRelations = (
  client: Pick<DrizzleClient, "query">,
  itemId: string,
) =>
  client.query.quest.findMany({
    columns: { id: true, name: true },
    where: sql`(
        JSON_SEARCH(${quest.content}, 'one', ${itemId}, NULL, '$.reward.reward_items[*].ids[*]') IS NOT NULL
        OR JSON_SEARCH(${quest.content}, 'one', ${itemId}, NULL, '$.reward.reward_hunter_items_ids[*]') IS NOT NULL
        OR JSON_SEARCH(${quest.content}, 'one', ${itemId}, NULL, '$.reward.reward_gathering_items_ids[*]') IS NOT NULL
        OR JSON_SEARCH(${quest.content}, 'one', ${itemId}, NULL, '$.objectives[*].collectItemIds[*]') IS NOT NULL
        OR JSON_SEARCH(${quest.content}, 'one', ${itemId}, NULL, '$.objectives[*].deliverItemIds[*]') IS NOT NULL
        OR JSON_SEARCH(${quest.content}, 'one', ${itemId}, NULL, '$.objectives[*].reward_items[*].ids[*]') IS NOT NULL
        OR JSON_SEARCH(${quest.content}, 'one', ${itemId}, NULL, '$.objectives[*].reward_hunter_items_ids[*]') IS NOT NULL
        OR JSON_SEARCH(${quest.content}, 'one', ${itemId}, NULL, '$.objectives[*].reward_gathering_items_ids[*]') IS NOT NULL
      )`,
  });

/** Build the `userItem` listing for `fetchUserItems`, using predicates on `userId`. */
export const listUserItemForFetchUserItems = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
) =>
  client.query.userItem.findMany({
    where: eq(userItem.userId, userId),
    with: {
      item: true,
      imbuements: { with: { item: true } },
    },
  });

/** Build the `userItem` listing for `fetchUserItemsWithVariants`, using predicates on `userId`. */
export const listUserItemForFetchUserItemsWithVariants = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
) =>
  client.query.userItem.findMany({
    where: eq(userItem.userId, userId),
    with: {
      item: { with: { variants: { orderBy: (v, { asc }) => [asc(v.order)] } } },
      imbuements: { with: { item: true } },
    },
  });

/**
 * Build the `userItem` update for `toggleEquipItem`, setting `equipped` and
 * `updatedAt`, using predicates on `id`, `userId`, `quantity`.
 */
export const updateUserItemForToggleEquipItem = (
  client: Pick<DrizzleClient, "update">,
  useritem: { id: string; equipped: import("@/drizzle/schema").ItemSlot },
  changedIds: string[],
  user: { userId: string },
) =>
  client
    .update(userItem)
    .set({
      equipped: sql`CASE WHEN ${userItem.id} = ${useritem.id} THEN ${useritem.equipped} ELSE 'NONE' END`,
      updatedAt: sql`GREATEST(NOW(3), TIMESTAMPADD(MICROSECOND, 1000, ${userItem.updatedAt}))`,
    })
    .where(
      and(
        inArray(userItem.id, changedIds),
        eq(userItem.userId, user.userId),
        gt(userItem.quantity, 0),
        hasNoHuntingBattle(user.userId),
      ),
    );

/** Build the `userItem` lookup for `splitItemStack`, using predicates on `id`, `userId`, `quantity`. */
export const findUserItemForSplitItemStack = (
  client: Pick<DrizzleClient, "query">,
  userItemId: string,
  userId: string,
) =>
  client.query.userItem.findFirst({
    where: and(
      eq(userItem.id, userItemId),
      eq(userItem.userId, userId),
      gt(userItem.quantity, 0),
    ),
    with: { item: true, imbuements: true },
  });

/**
 * Build the `userItem` update for `splitItemStack`, setting `quantity`, including
 * predicates on `id`, `userId`, `quantity`.
 */
export const updateUserItemForSplitItemStack = (
  client: Pick<DrizzleClient, "update">,
  quantityToKeep: number,
  userItemId: string,
  userId: string,
  currentUserItem: { quantity: number; equipped: "NONE"; storedAtHome: false | true },
) =>
  client
    .update(userItem)
    .set({ quantity: quantityToKeep })
    .where(
      and(
        eq(userItem.id, userItemId),
        eq(userItem.userId, userId),
        eq(userItem.quantity, currentUserItem.quantity),
        gt(userItem.quantity, 0),
        eq(userItem.isInAuction, false),
        eq(userItem.equipped, currentUserItem.equipped),
        eq(userItem.storedAtHome, currentUserItem.storedAtHome),
      ),
    );

/** Build the `userItem` insert for `splitItemStack`. */
export const insertUserItemForSplitItemStack = (
  client: Pick<DrizzleClient, "insert">,
  newUserItemId: string,
  currentUserItem: {
    userId: string;
    itemId: string;
    level: number;
    experience: number;
    durability: number;
    storedAtHome: false | true;
    activeVariantId: null | string;
    craftingFinishedAt: null | Date;
    dropChancePerc: number;
  },
  quantityToSplit: number,
) =>
  client.insert(userItem).values({
    id: newUserItemId,
    userId: currentUserItem.userId,
    itemId: currentUserItem.itemId,
    quantity: quantityToSplit,
    // A stack shares one ownership progression; both halves keep it.
    level: currentUserItem.level,
    experience: currentUserItem.experience,
    durability: currentUserItem.durability,
    equipped: "NONE",
    storedAtHome: currentUserItem.storedAtHome,
    isInAuction: false,
    // Carry the selected cosmetic onto the split-off stack so splitting does
    // not silently drop the active variant.
    activeVariantId: currentUserItem.activeVariantId,
    craftingFinishedAt: currentUserItem.craftingFinishedAt,
    dropChancePerc: currentUserItem.dropChancePerc,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

/** Build the `userItem` lookup for `splitItemStack`, selecting only `id`, using predicates on `id`. */
export const findUserItemForSplitItemStack2 = (
  client: Pick<DrizzleClient, "query">,
  newUserItemId: string,
) =>
  client.query.userItem.findFirst({
    where: eq(userItem.id, newUserItemId),
    columns: { id: true },
  });

/** Build the `userItem` update for `splitItemStack`, setting `quantity`, using predicates on `id`, `userId`, `quantity`. */
export const updateUserItemForSplitItemStack2 = (
  client: Pick<DrizzleClient, "update">,
  currentUserItem: { quantity: number },
  userItemId: string,
  userId: string,
  quantityToKeep: number,
) =>
  client
    .update(userItem)
    .set({ quantity: currentUserItem.quantity })
    .where(
      and(
        eq(userItem.id, userItemId),
        eq(userItem.userId, userId),
        eq(userItem.quantity, quantityToKeep),
      ),
    );

/**
 * Build the `userItem` update for `tryRepairUserItemDurability`, setting `durability`,
 * including predicates on `id`, `userId`, `storedAtHome`.
 */
export const updateUserItemForTryRepairUserItemDurability = (
  client: Pick<DrizzleClient, "update">,
  newDurability: number,
  target: {
    id: string;
    quantity: number;
    equipped: import("@/drizzle/schema").ItemSlot;
    level: number;
    experience: number;
    durability: number;
  },
  userId: string,
) =>
  client
    .update(userItem)
    .set({ durability: newDurability })
    .where(
      and(
        eq(userItem.id, target.id),
        eq(userItem.userId, userId),
        eq(userItem.storedAtHome, false),
        eq(userItem.isInAuction, false),
        eq(userItem.quantity, target.quantity),
        eq(userItem.equipped, target.equipped),
        eq(userItem.level, target.level),
        eq(userItem.experience, target.experience),
        eq(userItem.durability, target.durability),
        hasNoHuntingBattle(userId),
      ),
    );

/** Build the `userData` selection for `executeMergeStacksForItemBucket`, using predicates on `userId` and `status`. */
export const selectUserDataForExecuteMergeStacksForItemBucket = (
  client: Pick<DrizzleClient, "select">,
  userId: string,
) =>
  client
    .select({ one: sql`1` })
    .from(userData)
    .where(and(eq(userData.userId, userId), eq(userData.status, "AWAKE")));

/**
 * Build the `userItem` update for `restoreOriginalQuantities`, setting `quantity`,
 * including predicates on `userId`, `updatedAt`, `id`.
 */
export const updateUserItemForRestoreOriginalQuantities = (
  client: Pick<DrizzleClient, "update">,
  sortedItems: UserItemMergeBucketRow[],
  userId: string,
  claimedAt: Date,
  publishTargets: Pick<
    import("@/drizzle/schema").CraftingRequirement,
    "id" | "quantity"
  >[],
) =>
  client
    .update(userItem)
    .set({
      quantity: userItemMergeQuantityCase(
        sortedItems.map((item) => ({ id: item.id, quantity: item.quantity })),
      ),
    })
    .where(
      and(
        eq(userItem.userId, userId),
        eq(userItem.updatedAt, claimedAt),
        or(
          ...sortedItems.map((item, index) =>
            and(
              eq(userItem.id, item.id),
              or(
                eq(userItem.quantity, -item.quantity),
                eq(userItem.quantity, publishTargets[index]?.quantity ?? 0),
              ),
            ),
          ),
        ),
      ),
    );

/**
 * Build the `userItem` update for `executeMergeStacksForItemBucket`, setting
 * `quantity` and `updatedAt`, using predicates on `quantity`.
 */
export const updateUserItemForExecuteMergeStacksForItemBucket = (
  client: Pick<DrizzleClient, "update">,
  sortedItems: UserItemMergeBucketRow[],
  claimedAt: Date,
  awakeOwner: SQL<unknown>,

  userId: string,
) =>
  client
    .update(userItem)
    .set({
      quantity: userItemMergeQuantityCase(
        sortedItems.map((item) => ({ id: item.id, quantity: -item.quantity })),
      ),
      updatedAt: claimedAt,
    })
    .where(
      and(
        awakeOwner,
        or(
          ...sortedItems.map((item) => mergeStackRowGuard(userId, item, item.quantity)),
        ),
      ),
    );

/** Build the `userItem` update for `executeMergeStacksForItemBucket`, setting `quantity`, using predicates on `quantity`. */
export const updateUserItemForExecuteMergeStacksForItemBucket2 = (
  client: Pick<DrizzleClient, "update">,
  publishTargets: Pick<
    import("@/drizzle/schema").CraftingRequirement,
    "id" | "quantity"
  >[],
  awakeOwner: SQL<unknown>,
  sortedItems: UserItemMergeBucketRow[],

  userId: string,
) =>
  client
    .update(userItem)
    .set({ quantity: userItemMergeQuantityCase(publishTargets) })
    .where(
      and(
        awakeOwner,
        or(
          ...sortedItems.map((item) =>
            mergeStackRowGuard(userId, item, -item.quantity),
          ),
        ),
      ),
    );

/**
 * Build the `userItem` deletion for `executeMergeStacksForItemBucket`, including
 * predicates on `userId`, `id`, `quantity`.
 */
export const deleteUserItemForExecuteMergeStacksForItemBucket = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
  itemsToDelete: UserItemMergeBucketRow[],
  claimedAt: Date,
) =>
  client.delete(userItem).where(
    and(
      eq(userItem.userId, userId),
      inArray(
        userItem.id,
        itemsToDelete.map((item) => item.id),
      ),
      eq(userItem.quantity, 0),
      eq(userItem.updatedAt, claimedAt),
    ),
  );

/** Build the `userItem` listing for `executeMergeStacksForItem`, including predicates on `userId`, `itemId`, `quantity`. */
export const listUserItemForExecuteMergeStacksForItem = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
  itemId: string,
) =>
  client.query.userItem.findMany({
    where: and(
      eq(userItem.userId, userId),
      eq(userItem.itemId, itemId),
      gt(userItem.quantity, 0),
      eq(userItem.storedAtHome, false),
      eq(userItem.isInAuction, false),
    ),
    with: { imbuements: true },
  });

/** Build insertion of caller-prepared inventory rows. */
export const insertUserItems = (
  client: Pick<DrizzleClient, "insert">,
  craftingItemValues: (typeof userItem.$inferInsert)[],
) => client.insert(userItem).values(craftingItemValues);

/** Build the `item` listing, using predicates on `id`. */
export const listItemsByIds = (
  client: Pick<DrizzleClient, "query">,
  itemIds: string[],
) => client.query.item.findMany({ where: inArray(item.id, itemIds) });

/** Build the `userItem` deletion, using predicates on `id` and `quantity`. */
export const deleteUserItemsWithPositiveQuantity = (
  client: Pick<DrizzleClient, "delete">,
  deleteItems: string[],
) =>
  client
    .delete(userItem)
    .where(and(inArray(userItem.id, deleteItems), gt(userItem.quantity, 0)));

/** Build the `actionLog` insert for `commitCacheConsumption`. */
export const insertActionLogForCommitCacheConsumption = (
  client: Pick<DrizzleClient, "insert">,
  receiptId: string,
  userId: string,
  itemId: string,
  relatedMsg: string,
) =>
  client.insert(actionLog).ignore().values({
    id: receiptId,
    userId,
    tableName: "userItem",
    relatedId: itemId,
    relatedMsg,
    changes: [],
  });

/** Build the `actionLog` deletion for `commitCacheConsumption`, using predicates on `id`. */
export const deleteActionLogForCommitCacheConsumption = (
  client: Pick<DrizzleClient, "delete">,
  receiptId: string,
) => client.delete(actionLog).where(eq(actionLog.id, receiptId));

/** Build the `actionLog` update for `commitCacheConsumption`, setting `changes`, using predicates on `id`. */
export const updateActionLogForCommitCacheConsumption = (
  client: Pick<DrizzleClient, "update">,
  userItemId: string,
  response: z.infer<typeof cacheConsumptionResponseSchema>,
  selections: unknown,
  receiptId: string,
) =>
  client
    .update(actionLog)
    // ActionLog readers expect string arrays; the receipt retains its structured payload as JSON.
    .set({ changes: [JSON.stringify({ userItemId, response, selections })] })
    .where(eq(actionLog.id, receiptId));

/** Execute the database statement for `settleCookingExperience`. */
export const executeRowsForSettleCookingExperience = (
  client: Pick<DrizzleClient, "execute">,
  job: { experience: number; id: string },
  userId: string,
  now: Date,
) =>
  client.execute(sql`
          UPDATE ${userData}
          INNER JOIN ${userCookingJob} ON ${userCookingJob.userId} = ${userData.userId}
          SET ${userData.cookingExperience} = ${userData.cookingExperience} + ${job.experience},
              ${userData.updatedAt} = GREATEST(NOW(3), TIMESTAMPADD(MICROSECOND, 1000, ${userData.updatedAt})),
              ${userCookingJob.experience} = 0
          WHERE ${userData.userId} = ${userId}
            AND ${userCookingJob.id} = ${job.id}
            AND ${userCookingJob.userId} = ${userId}
            AND ${userCookingJob.finishesAt} <= ${now}
            AND ${userCookingJob.experience} = ${job.experience}
            AND ${userCookingJob.experience} > 0
        `);

/**
 * Build the `userCookingJob` deletion for `settleCookingExperience`, using predicates
 * on `userId`, `finishesAt`, `experience`.
 */
export const deleteUserCookingJobForSettleCookingExperience = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
  now: Date,
) =>
  client
    .delete(userCookingJob)
    .where(
      and(
        eq(userCookingJob.userId, userId),
        lte(userCookingJob.finishesAt, now),
        eq(userCookingJob.experience, 0),
      ),
    );

/** Build the `userRaidBuff` insert for `consumeMeal`, updating duplicate keys. */
export const insertUserRaidBuffForConsumeMeal = (
  client: Pick<DrizzleClient, "insert">,
  id: string,
  user: { userId: string },
  now: Date,
) =>
  client
    .insert(userRaidBuff)
    .values({
      id,
      userId: user.userId,
      itemId: null,
      questId: null,
      effects: [],
      expiresAt: now,
      createdAt: now,
    })
    .onDuplicateKeyUpdate({ set: { id: sql`id` } });

/** Execute the database statement for `consumeMeal`. */
export const executeConsumedForConsumeMeal = (
  client: Pick<DrizzleClient, "execute">,
  user: { updatedAt: Date; userId: string },
  now: Date,
  expectedQuantity: number,
  owned: {
    itemId: string;
    item: { effects: import("@/validators/combat").ZodAllTags[] };
    id: string;
  },
  expiresAt: Date,
  createdAt: Date,
  id: string,
) =>
  client.execute(sql`
      UPDATE ${userData}
      INNER JOIN ${userItem} ON ${userItem.userId} = ${userData.userId}
      INNER JOIN ${userRaidBuff} ON ${userRaidBuff.userId} = ${userData.userId}
      SET ${userData.updatedAt} = ${getNextUserSnapshotAt(user.updatedAt, now)},
          ${userItem.quantity} = ${expectedQuantity - 1},
          ${userRaidBuff.itemId} = ${owned.itemId},
          ${userRaidBuff.questId} = NULL,
          ${userRaidBuff.effects} = ${JSON.stringify(owned.item.effects)},
          ${userRaidBuff.expiresAt} = ${expiresAt},
          ${userRaidBuff.createdAt} = ${createdAt}
      WHERE ${userData.userId} = ${user.userId}
        AND ${userData.updatedAt} = ${user.updatedAt}
        AND ${userData.status} = 'AWAKE'
        AND ${userData.battleId} IS NULL
        AND ${userItem.id} = ${owned.id}
        AND ${userItem.userId} = ${user.userId}
        AND ${userItem.itemId} = ${owned.itemId}
        AND ${userItem.quantity} = ${expectedQuantity}
        AND ${userItem.quantity} > 0
        AND ${userItem.storedAtHome} = FALSE
        AND ${userItem.isInAuction} = FALSE
        AND ${userItem.equipped} = 'NONE'
        AND (${userItem.craftingFinishedAt} IS NULL OR ${userItem.craftingFinishedAt} <= ${now})
        AND ${userRaidBuff.id} = ${id}
        AND ${userRaidBuff.userId} = ${user.userId}
    `);

/** Match the owned inventory bucket and quantity before claiming or publishing a stack merge. */
const mergeStackRowGuard = (
  userId: string,
  item: Pick<UserItemMergeBucketRow, "id" | "equipped" | "storedAtHome">,
  quantity: number,
) =>
  and(
    eq(userItem.id, item.id),
    eq(userItem.userId, userId),
    eq(userItem.isInAuction, false),
    eq(userItem.quantity, quantity),
    eq(userItem.equipped, item.equipped),
    eq(userItem.storedAtHome, item.storedAtHome),
  );

/** List token-unlockable variant choices with parent item names for content authoring. */
export const listVariantNames = (client: Pick<DrizzleClient, "select">) =>
  client
    .select({
      id: itemVariant.id,
      name: sql<string>`concat(${item.name}, ": ", ${itemVariant.name})`,
    })
    .from(itemVariant)
    .innerJoin(item, eq(item.id, itemVariant.itemId))
    .where(eq(itemVariant.costType, "VARIANT_TOKEN"));
