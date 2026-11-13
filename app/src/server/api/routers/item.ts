import * as Sentry from "@sentry/nextjs";
import { TRPCError } from "@trpc/server";
import {
  and,
  eq,
  exists,
  gt,
  gte,
  isNull,
  like,
  lt,
  lte,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  getBulkSellUserUpdate,
  getBuyUserUpdate,
  getConsumedItemUserUpdate,
  getConsumedMealUserUpdate,
  getEvolvedItemUserUpdate,
  getInventoryEquipmentChanges,
  getInventoryQuantityChanges,
  getLoadoutInventoryChanges,
  getMergedStacksUserUpdate,
  getPurchaseVariantUserUpdate,
  getRepairedEquipmentUpdate,
  getSelectItemLoadoutUserUpdate,
  getUnchangedEquipmentUserUpdate,
  getUnequippedUserUpdate,
} from "@/deltas/item";
import { getUserProgressionUpdate } from "@/deltas/profile";
import {
  CACHE_MAX_GRANTED_ITEMS,
  DURABILITY_MAX_DEFAULT,
  EVOLUTION_MAX_CHILDREN,
  HomeTypeDetails,
  ITEM_LEVEL_CAP,
  type ItemSlot,
  ItemSlots,
  MAX_BULK_SELL_ITEMS,
  MAX_EXTRA_JUTSU_SLOTS,
  MAX_EXTRA_RESKIN_SLOTS,
  MAX_ITEM_VARIANTS,
  PET_MAX_CONSUME_PETS,
  TUTORIAL_ITEM_ID,
  VARIANT_COST_TYPES,
  VARIANT_CURRENCY_FIELD,
  type VariantCurrency,
  type VariantCurrencyField,
} from "@/drizzle/constants";
import {
  type Item,
  type ItemLoadout,
  item,
  type UserData,
  type UserItem,
  type UserItemWithRelations,
  type UserPetInsert,
  userData,
  userItem,
} from "@/drizzle/schema";
import { filterRollableBloodlines } from "@/libs/bloodline";
import { findLoadoutHotkeyConflict } from "@/libs/combat/hotkeys";
import { hasAppearAnimation } from "@/libs/combat/util";
import {
  deletedReason,
  editedReason,
  outdateProposalsFor,
} from "@/libs/contentReview/outdate";
import {
  filterVisibleEvolutions,
  isEvolution,
  meetsEvolutionStatRequirements,
  validateEvolutionGraph,
} from "@/libs/evolution";
import { canDropFarmSeed } from "@/libs/farming";
import {
  FURNITURE_IMAGE_MAX_BYTES,
  measureFurnitureImage,
  readFurnitureImageBody,
} from "@/libs/furnitureImage";
import {
  buildItemLoadoutData,
  calcItemRepairCost,
  calcItemSellingPrice,
  canEquipAdditional,
  compatibleEquipSlots,
  computeAutoEquipAssignments,
  computeLoadoutAssignments,
  countsTowardInventoryStorage,
  findFreeEquipSlot,
  getHomeStorageBucket,
  getHomeStorageBucketCapacity,
  getHomeStorageBucketFullMessage,
  getInventoryBucket,
  getInventoryBucketCapacity,
  getInventoryBucketFullMessage,
  getItemStackMergeBucketKey,
  isCompatibleEquipSlot,
  isImbuing,
  nonCombatConsume,
  partitionImbuementsForItemTransfer,
  readItemListFilterSlot,
} from "@/libs/item";
import { getItemPurchaseAllowance, itemPurchaseLimitMessage } from "@/libs/itemEconomy";
import { bulkSellBlockReason, bulkSellMessage } from "@/libs/itemsPage";
import { getJutsuSlotIncreaseError } from "@/libs/jutsuSlots";
import {
  buildMissingLoadouts,
  decideRename,
  resolveSelectableLoadout,
} from "@/libs/loadout";
import { lpcSelectionError } from "@/libs/lpc/appearance";
import {
  effectiveMasteries,
  gearMissingMastery,
  type MasteryBuffUser,
  type MasterySources,
  missingMasteryRequirement,
} from "@/libs/mastery";
import { createPetFromSpecies } from "@/libs/pets/creation";
import { getMaxPetRank, getPetCollectionCapacity } from "@/libs/pets/progression";
import {
  filterQuestTrackersForDbPersist,
  getNewTrackers,
  objectiveContentIds,
} from "@/libs/quest";
import { postProcessRewards } from "@/libs/quest/rewards";
import { hasRequiredLevel } from "@/libs/rank";
import {
  calcRepairAllCost,
  calculateKitsToUse,
  getRepairKits,
  needsInventoryRepair,
} from "@/libs/repair";
import { collapseRewards } from "@/libs/rewards";
import { filterRollableSageModes } from "@/libs/sageMode";
import {
  getShopDiscounts,
  getShopStackPrice,
  isItemAvailableInStore,
  shopItemDiscountFactor,
} from "@/libs/shop";
import { hasRequiredSkill } from "@/libs/skillRequirements";
import { callDiscordContent } from "@/libs/socials";
import { getVillageLoyaltyShopCost } from "@/libs/villageLoyalty";
import {
  CACHE_RESTRICTED_REWARD_MESSAGE,
  cacheItemChance,
  isRestrictedCacheReward,
  isWeightedCacheEffect,
  resolveWeightedCache,
} from "@/libs/weightedCache";
import {
  fetchActionUser,
  updateUserForActionReadiness,
} from "@/queries/actionReadiness";
import { fetchBloodlines, fetchItemBloodlineRolls } from "@/queries/bloodline";
import { listHuntingHabitats } from "@/queries/hunting";
import type { UserItemMergeBucketRow } from "@/queries/item";
import {
  consumeVariantTokenForAction,
  deleteCraftingRequirementForUpdate,
  deleteEmptyUserItem,
  deleteItemForDelete,
  deleteItemVariantById,
  deleteItemVariantForDelete,
  deleteUserItemForDelete,
  deleteUserItemForExecuteMergeStacksForItemBucket,
  deleteUserItemForSellUserItem,
  deleteUserItemImbuementForDelete,
  deleteUserItemImbuementForEvolveItem,
  deleteUserItemImbuementForSellUserItem,
  deleteUserItemImbuementsForSellUserItems,
  deleteUserItemVariantForDelete,
  deleteUserItemVariantForDeleteItemVariant,
  executeUserPetForClaim,
  fetchCacheReferencedItems,
  fetchItem,
  fetchItemLoadouts,
  fetchItemWithCraftingRequirements,
  fetchPurchaseCounters,
  fetchUserEquipmentSnapshot,
  fetchUserItem,
  fetchUserItemWithVariants,
  fetchVariantOwnership,
  findHuntingSessionForDelete,
  findItemForUpdate,
  findItemForUpsertItemVariant,
  findItemLoadoutForRenameLoadout,
  findItemVariantForDeleteItemVariant,
  findItemVariantForPurchaseVariant,
  findUserItemForAdjustUserItem,
  findUserItemForEvolveItem,
  findUserItemForSplitItemStack,
  findUserItemForSplitItemStack2,
  findUserItemVariantForPurchaseVariant,
  insertActionLogForAdjustUserItem,
  insertActionLogForDelete,
  insertActionLogForEvolveItem,
  insertActionLogForSellUserItem,
  insertActionLogForUpdate,
  insertCraftingRequirementForClone,
  insertCraftingRequirementForUpdate,
  insertItemForClone,
  insertItemForCreate,
  insertItemLoadoutForInsertMissing,
  insertItemPurchaseCounterForBuy,
  insertItemVariantForUpsertItemVariant,
  insertUserItemForEvolveItem,
  insertUserItemForSplitItemStack,
  insertUserItems,
  insertUserItemVariantForPurchaseVariant,
  listItemForDelete,
  listItemForGetAll,
  listItemForGetAllNames,
  listItemForGetBloodlineItemNames,
  listItemForGetEvolutions,
  listItemForUpdate,
  listItemForUpdate2,
  listItemVariantForDelete,
  listItemVariantForGetItemVariants,
  listItemVariantForUpsertItemVariant,
  listItemVariantRequiringItemForDelete,
  listPetSpeciesForFetchRewardPetSpecies,
  listQuestForGetItemRelations,
  listUserItemForExecuteMergeStacksForItem,
  listUserItemForFetchUserItems,
  listUserItemForFetchUserItemsWithVariants,
  listUserItemForMergeAllStacks,
  listUserItemsForSellUserItems,
  listUserPetForConsume,
  listVariantNames,
  restoreUserItemDurability,
  selectEvoSiblingCountForUpdate,
  selectItemForDelete,
  selectItemForUpdate,
  selectItemForUpdate2,
  selectItemVariantForUpsertItemVariant,
  selectParentItemForEvoForUpdate,
  selectUserDataForExecuteMergeStacksForItemBucket,
  selectUserItemForGetItemRelations,
  selectUserItemForGetUserItemCounts,
  selectUserItemForSelectItemLoadout,
  selectUserItemVariantForGetUserUnlockedVariants,
  selectVillageStructureForSellUserItem,
  sellUserItemAtomically,
  updateItemForUpdate,
  updateItemLoadoutForEvolveItem,
  updateItemLoadoutForRenameLoadout,
  updateItemLoadoutForSetLoadoutHotkeys,
  updateItemLoadoutForToggleEquip,
  updateItemLoadoutForUnequipAllItems,
  updateItemPurchaseCounterForBuy,
  updateItemVariantForUpsertItemVariant,
  updateUserDataForBuy,
  updateUserDataForCommitConsumption,
  updateUserDataForPurchaseVariant,
  updateUserDataForRefundCurrency,
  updateUserDataForSelectItemLoadout,
  updateUserDataForWriteDefaultPointer,
  updateUserItemForAdjustUserItem,
  updateUserItemForAutoEquipOptimal,
  updateUserItemForDeleteItemVariant,
  updateUserItemForEvolveItem,
  updateUserItemForExecuteMergeStacksForItemBucket,
  updateUserItemForExecuteMergeStacksForItemBucket2,
  updateUserItemForRestoreOriginalQuantities,
  updateUserItemForSelectItemLoadout,
  updateUserItemForSelectVariant,
  updateUserItemForSplitItemStack,
  updateUserItemForSplitItemStack2,
  updateUserItemForToggleEquipItem,
  updateUserItemForTryRepairUserItemDurability,
  updateUserItemForUnequipAllItems,
  updateUserItemForUpdate,
  userItemAvailableAt,
} from "@/queries/item";
import { fetchJutsuLoadouts } from "@/queries/jutsu";
import { findActionLogById } from "@/queries/logs";
import { findLpcDesignForSelection } from "@/queries/lpc";
import { insertUserPet, listVisiblePetJutsu } from "@/queries/pets";
import {
  debitUserMoney,
  fetchAllGameSettings,
  fetchLoadoutUser,
  fetchUser,
  fetchViewerRole,
  incrementUserMoney,
} from "@/queries/profile";
import {
  fetchQuest,
  fetchQuestTrackerState,
  fetchUserQuestByQuestId,
} from "@/queries/quests";
import { fetchSageModeRolls, fetchSageModes } from "@/queries/sageMode";
import { fetchUserSkills, findRequiredSkillTreeEntry } from "@/queries/skillTree";
import { fetchStructures } from "@/queries/village";
import { fetchUpdatedUser } from "@/routers/profile";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  publicProcedure,
  ratelimitMiddleware,
  serverError,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import {
  type ActionReadiness,
  actionReadinessResponse,
  prepareActionReadiness,
} from "@/server/utils/actionReadiness";
import {
  cacheReceiptId,
  commitCacheConsumption,
  readCacheReceipt,
} from "@/server/utils/cacheConsumption";
import {
  consumeUserItemAtomically,
  MERGE_STACK_CLAIM_TIMEOUT_MS,
  refundUserItemQuantityAtomically,
  restoreStaleUserItemMergeClaims,
  runRewardTasks,
  updateUserItemQuantityAtomically,
} from "@/server/utils/concurrency";
import { planConsumeEffects } from "@/server/utils/consumeEffects";
import { consumeMeal } from "@/server/utils/cooking";
import { setEmptyStringsToNulls } from "@/server/utils/emptyStrings";
import { applyLoadoutRename, backfillLoadouts } from "@/server/utils/loadout";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { offsetPage } from "@/server/utils/pagination";
import { assignQuestToUser } from "@/server/utils/questAssignment";
import { nameGrantedRewards, updateRewards } from "@/server/utils/questRewards";
import { validateUrlForSsrf } from "@/server/utils/ssrf";
import { validateTitleRewardIds } from "@/server/utils/titleRewards";
import { calculateContentDiff } from "@/utils/diff";
import { groupBy } from "@/utils/grouping";
import { fetchWithTimeout } from "@/utils/http";
import { isBunnyCdnUrl, transformImageUrl } from "@/utils/image";
import { fedItemLoadouts } from "@/utils/paypal";
import {
  canAwardReputation,
  canChangeContent,
  canEditItems,
  isRestrictedToSelf,
} from "@/utils/permissions";
import { sanitizeVariantText } from "@/utils/sanitize";
import { getNextUserSnapshotAt, getUtcDayKey } from "@/utils/time";
import type { QueryCondition } from "@/utils/typeutils";
import {
  IncreaseJutsuSlots,
  ItemValidator,
  NonCombatConsumeRewardTag,
  NonCombatQuestTag,
  type ZodAllTags,
} from "@/validators/combat";
import {
  type InventoryQuantityChange,
  inventoryQuantityChangeSchema,
} from "@/validators/inventory";
import {
  displayCostType,
  type ItemFilteringSchema,
  ItemVariantValidator,
  itemBuySchema,
  itemCreateSchema,
  itemFilteringSchema,
} from "@/validators/item";
import { furnitureVariantDataSchema } from "@/validators/itemFurniture";
import { renameLoadoutSchema, setLoadoutHotkeysSchema } from "@/validators/loadout";
import { lpcItemFields } from "@/validators/lpc";
import { idSchema } from "@/validators/misc";
import {
  ObjectiveReward,
  PostProcessedRewardSchema,
  type PostProcessedRewards,
} from "@/validators/rewards";
import { userDeltaResponseSchema } from "@/validators/userCache";
import {
  type CacheRewardDisplay,
  cacheConsumptionResponseSchema,
  maximumCacheItems,
  type WeightedCache,
  weightedCacheSchema,
} from "@/validators/weightedCache";

/** Furniture measurements always describe the original uploaded image, never a CDN rendition. */
const furnitureImageMeasurementSchema = z.object({
  image: z.url().max(512),
  useFullFootprint: z.boolean(),
});

const getItemEvolutionsSchema = z.object({
  itemId: z.string(),
});

const evolveItemSchema = z.object({
  userItemId: z.string(),
  evolutionItemId: z.string(),
});

const getPublicUserItemsSchema = z.object({
  userId: z.string(),
});

const adjustUserItemSchema = z.object({
  userId: z.string(),
  userItemId: z.string(),
  level: z.number().int().min(1).max(ITEM_LEVEL_CAP),
});

const ItemVariantResponseSchema = z.object({
  ...lpcItemFields.shape,
  id: z.string(),
  itemId: z.string(),
  name: z.string(),
  image: z.string(),
  requiredItemId: z.string().trim().min(1).nullable().prefault(null),
  costType: z.enum(VARIANT_COST_TYPES),
  cost: z.number(),
  order: z.number(),
  createdAt: z.date(),
  updatedAt: z.date(),
  description: z.string().nullish(),
  battleDescription: z.string().nullish(),
  furnitureData: furnitureVariantDataSchema.nullable().prefault(null),
});

const upsertItemVariantInputSchema = z.object({
  itemId: z.string(),
  variant: ItemVariantValidator,
});

const UserUnlockedVariantResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  variantId: z.string(),
  createdAt: z.date(),
});

/** Meals require a stack snapshot; collection grants and weighted caches require a retry ID. */
const consumeItemInputSchema = z.object({
  userItemId: z.string(),
  expectedQuantity: z.int().positive().optional(),
  requestId: z
    .string()
    .regex(/^[\w-]{10,64}$/)
    .optional(),
});

export const itemRouter = createTRPCRouter({
  /** Content authoring needs source alpha bounds even for generated and historical uploads. */
  getFurnitureImageGeometry: protectedProcedure
    .input(furnitureImageMeasurementSchema)
    .query(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (!canChangeContent(user.role) || user.isBanned)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only content staff can measure furniture images",
        });
      const url = new URL(transformImageUrl(input.image));
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.port ||
        !isBunnyCdnUrl(url.toString())
      )
        return {
          ...errorResponse("Choose an uploaded furniture image"),
          geometry: null,
        };
      url.search = "";
      url.hash = "";
      if (!(await validateUrlForSsrf(url.toString())))
        return {
          ...errorResponse("Furniture image URL is unavailable"),
          geometry: null,
        };
      try {
        // Restrict redirects and size before decoding staff-selected content on the server.
        const response = await fetchWithTimeout(url.toString(), { redirect: "error" });
        if (
          !response.ok ||
          Number(response.headers.get("content-length")) > FURNITURE_IMAGE_MAX_BYTES
        )
          return {
            ...errorResponse("Furniture image could not be measured"),
            geometry: null,
          };
        const bytes = await readFurnitureImageBody(response);
        if (!bytes)
          return {
            ...errorResponse("Furniture image is too large to measure"),
            geometry: null,
          };
        const geometry = await measureFurnitureImage(bytes, input.useFullFootprint);
        return {
          success: true,
          message: "Furniture image measured",
          image: input.image,
          useFullFootprint: input.useFullFootprint,
          geometry,
        };
      } catch {
        // The editor retains the image and exposes a retry beside the framing controls.
        return {
          ...errorResponse(
            "Could not measure this cutout. Check its transparency and try again.",
          ),
          geometry: null,
        };
      }
    }),
  getAllNames: publicProcedure
    .meta({ mcp: { description: "Get all item names and images" } })
    .query(async ({ ctx }) => {
      const items = await listItemForGetAllNames(ctx.drizzle);
      return items.map(({ bloodlineId, effects, ...entry }) => ({
        ...entry,
        /** Distinguish weighted caches from other reward consumables in content selectors. */
        isCache: effects.some(isWeightedCacheEffect),
        isRestrictedCacheReward: isRestrictedCacheReward({ bloodlineId, effects }),
        /** Variant bindings let content selectors offer only compatible unlock tokens. */
        unlockVariantIds: effects.flatMap((effect) =>
          effect.type === "unlockitemvariant" ? [effect.variantId] : [],
        ),
      }));
    }),
  getBloodlineItemNames: publicProcedure
    .meta({
      mcp: {
        description: "Get names of items associated with a bloodline",
      },
    })
    .input(z.object({ bloodlineId: z.string().nullish() }))
    .query(async ({ ctx, input }) => {
      // No bloodline selected (the jutsu editor form sends "" when cleared) means there
      // are no bloodline items to choose from — return an empty list rather than every
      // bloodline item in the database.
      const bloodlineId = input.bloodlineId;
      if (!bloodlineId) return [];
      return await listItemForGetBloodlineItemNames(ctx.drizzle, bloodlineId);
    }),
  get: publicProcedure
    .meta({
      mcp: {
        description: "Get a specific item by ID, or null if no such item exists",
      },
    })
    .input(idSchema)
    .query(async ({ ctx, input }) => {
      // Deleted items stay reachable through stale links on this public endpoint,
      // so a missing row is an ordinary answer rather than an error
      const result = await fetchItem(ctx.drizzle, input.id);
      if (!result) return null;
      return result as Omit<typeof result, "effects"> & { effects: ZodAllTags[] };
    }),
  getBloodlineRollOdds: protectedProcedure
    .input(idSchema)
    .query(async ({ ctx, input }) => {
      const [selectedItem, user, bloodlines, previousRolls] = await Promise.all([
        fetchItem(ctx.drizzle, input.id),
        fetchUser(ctx.drizzle, ctx.userId),
        fetchBloodlines(ctx.drizzle),
        fetchItemBloodlineRolls(ctx.drizzle, ctx.userId),
      ]);
      if (!selectedItem) return null;
      return selectedItem.effects
        .filter((effect) => effect.type === "rollbloodline")
        .map((effect) => {
          // Use the consume handler's pool, including village and least-rolled rules.
          const pool = filterRollableBloodlines({
            bloodlines,
            user,
            previousRolls,
            rank: effect.rank,
          });
          return {
            rank: effect.rank,
            successChance: effect.power,
            outcomes: pool.map(({ id, name }) => ({
              id,
              name,
              chance: effect.power / pool.length,
            })),
          };
        });
    }),
  getItemWithCraftingRequirements: publicProcedure
    .meta({
      mcp: { description: "Get item with crafting requirements" },
    })
    .input(idSchema)
    .query(async ({ ctx, input }) => {
      const result = await fetchItemWithCraftingRequirements(ctx.drizzle, input.id);
      if (!result) {
        throw serverError("NOT_FOUND", "Item not found");
      }
      return result;
    }),
  getUserItem: protectedProcedure
    .meta({ mcp: { description: "Get a specific user item" } })
    .input(idSchema)
    .query(async ({ ctx, input }) => {
      const result = await fetchUserItem(ctx.drizzle, ctx.userId, input.id);
      if (!result) {
        throw serverError("NOT_FOUND", "Item not found");
      }
      return result;
    }),
  // Create new item
  create: protectedProcedure
    .input(itemCreateSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (!canChangeContent(user.role)) {
        return errorResponse(`Not allowed to create item`);
      }
      const id = nanoid();
      await insertItemForCreate(ctx.drizzle, id, input);
      return { success: true, message: id };
    }),
  // Clone an existing item
  clone: protectedProcedure
    .input(idSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, itemData] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchItemWithCraftingRequirements(ctx.drizzle, input.id),
      ]);
      // Guard
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (!itemData) return errorResponse("Item not found");
      if (!canChangeContent(user.role)) return errorResponse("Not allowed");

      // Create new item with copied data
      const newItemId = nanoid();
      // Server-side enforcement: zero out reward_reputation when cloning if user lacks permission
      let clonedEffects = itemData.effects;
      if (!canAwardReputation(user.role)) {
        clonedEffects = itemData.effects.map((effect) => {
          if (effect.type === "noncombatconsumereward") {
            return { ...effect, reward_reputation: 0 };
          }
          return effect;
        }) as ZodAllTags[];
      }
      const clonedItem = {
        ...itemData,
        id: newItemId,
        name: `${itemData.name} - copy`,
        hidden: true,
        effects: clonedEffects,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Run all inserts at once
      await Promise.all([
        insertItemForClone(ctx.drizzle, clonedItem),
        ...(itemData.craftingRequirements && itemData.craftingRequirements.length > 0
          ? [insertCraftingRequirementForClone(ctx.drizzle, itemData, newItemId)]
          : []),
      ]);

      return { success: true, message: newItemId };
    }),
  // Delete a item
  delete: protectedProcedure
    .input(idSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (!canChangeContent(user.role))
        return errorResponse("Not allowed to delete item");
      const [entry, childEvolutions, huntingReferences, requiredByVariants] =
        await Promise.all([
          fetchItem(ctx.drizzle, input.id),
          listItemForDelete(ctx.drizzle, input),
          listHuntingHabitats(ctx.drizzle),
          listItemVariantRequiringItemForDelete(ctx.drizzle, input),
        ]);
      if (
        huntingReferences.some((h) =>
          h.content.contracts.some((c) => c.rewards.some((r) => r.itemId === input.id)),
        )
      )
        return errorResponse(
          "This material is used by a hunting contract. Remove that reward first.",
        );
      if (requiredByVariants.length) {
        return errorResponse(
          `This item unlocks variants: ${requiredByVariants.map((variant) => variant.name).join(", ")}. Change their required unlock item first.`,
        );
      }
      // Check accepted terms after live references: an acceptance can precede a
      // staff edit that removes the reward while the habitat query is in flight.
      // Match the selected contract; backfilled snapshots can contain the whole habitat.
      const activeHunt = await findHuntingSessionForDelete(ctx.drizzle, input);
      if (activeHunt)
        return errorResponse(
          "This material is used by an active hunting session. Wait for it to finish.",
        );
      if (input.id === TUTORIAL_ITEM_ID)
        return errorResponse("Cannot delete tutorial item");
      if (childEvolutions.length > 0) {
        return errorResponse(
          `Cannot delete item with evolutions: ${childEvolutions.map((e) => e.name).join(", ")}`,
        );
      }

      // Guard the parent deletion before removing owned rows, so new references
      // reject without inventory loss. Missing parents still allow cleanup retries.
      if (entry) {
        // Materialize the evolution subquery to avoid MySQL's self-delete restriction.
        const evolutionChildGuard = selectItemForDelete(ctx.drizzle, input);
        const deleteResult = await deleteItemForDelete(
          ctx.drizzle,
          input,
          evolutionChildGuard,
        );
        if (deleteResult.rowsAffected === 0) {
          return errorResponse(
            "Delete incomplete — an evolution or variant now requires this item. Remove the reference and retry.",
          );
        }
        // Record the deletion before retryable cleanup loses the item's metadata.
        await insertActionLogForDelete(ctx.drizzle, ctx, entry);
      }
      // Variant saves require a live parent; load cleanup IDs after deleting it.
      const variants = await listItemVariantForDelete(ctx.drizzle, input);
      if (variants.length > 0) {
        await deleteUserItemVariantForDelete(ctx.drizzle, variants);
        await deleteItemVariantForDelete(ctx.drizzle, input);
      }
      await Promise.all([
        deleteUserItemForDelete(ctx.drizzle, input),
        deleteUserItemImbuementForDelete(ctx.drizzle, input),
      ]);

      await outdateProposalsFor(
        ctx.drizzle,
        "ITEM",
        [input.id],
        deletedReason("ITEM", entry?.name ?? input.id, user.username),
      );
      return { success: true, message: `Item deleted` };
    }),
  // Update an item
  update: protectedProcedure
    .input(z.object({ id: z.string(), data: ItemValidator }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      setEmptyStringsToNulls(input.data, item);
      // Query
      const [
        user,
        entry,
        requiredSkill,
        itemWithName,
        parent,
        siblings,
        evolutionGraph,
        cacheItems,
        rewardSpecies,
        titleError,
        lpcDesign,
      ] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchItemWithCraftingRequirements(ctx.drizzle, input.id),
        input.data.requiredSkillId
          ? findRequiredSkillTreeEntry(ctx.drizzle, {
              data: { requiredSkillId: input.data.requiredSkillId },
            })
          : Promise.resolve(null),
        findItemForUpdate(ctx.drizzle, input),
        input.data.parentItemId
          ? fetchItem(ctx.drizzle, input.data.parentItemId)
          : Promise.resolve(null),
        input.data.parentItemId
          ? listItemForUpdate(ctx.drizzle, {
              data: { parentItemId: input.data.parentItemId },
            })
          : Promise.resolve([]),
        input.data.parentItemId ? listItemForUpdate2(ctx.drizzle) : Promise.resolve([]),
        fetchCacheReferencedItems(ctx.drizzle, {
          ...input.data,
          id: input.id,
          bloodlineId: input.data.bloodlineId ?? null,
        }),
        fetchRewardPetSpecies(ctx.drizzle, input.data.effects),
        validateTitleRewardIds(ctx.drizzle, input.data),
        findLpcDesignForSelection(ctx.drizzle, input.data.lpcProfile),
      ]);
      if (titleError) return errorResponse(titleError);
      if (input.data.requiredSkillId && requiredSkill?.pathType !== "SKILL") {
        return errorResponse("Select a valid SkillTree skill entry");
      }
      // Guard
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (!entry) return errorResponse("Item not found");
      if (itemWithName && itemWithName.id !== entry.id)
        return errorResponse("Item name already exists");
      if (!canChangeContent(user.role)) {
        return errorResponse("Not allowed to edit item");
      }
      const spriteError = lpcSelectionError(
        input.data.lpcProfile,
        entry.lpcProfile,
        lpcDesign,
      );
      if (spriteError) return errorResponse(spriteError);
      if (entry.id === TUTORIAL_ITEM_ID && input?.data?.hidden)
        return errorResponse("Cannot hide tutorial item");
      if (cacheItems.missing.length > 0)
        return errorResponse(
          `Cache rewards reference missing items: ${cacheItems.missing.join(", ")}`,
        );
      if (cacheItems.restricted.length > 0)
        return errorResponse(
          `${CACHE_RESTRICTED_REWARD_MESSAGE}: ${cacheItems.restricted.join(", ")}`,
        );
      if (
        rewardPetSpeciesIds(input.data.effects).some(
          (id) => !rewardSpecies.some((species) => species.id === id),
        )
      )
        return errorResponse("Companion rewards must reference existing species.");
      // Validate evolution chain constraints
      if (input.data.parentItemId) {
        const graphValidation = validateEvolutionGraph({
          contentId: input.id,
          parentId: input.data.parentItemId,
          parentExists: !!parent,
          parentParentId: parent?.parentItemId ?? null,
          siblingIds: siblings.map((s) => s.id),
          graph: evolutionGraph.map((node) => ({
            id: node.id,
            parentId: node.parentItemId,
          })),
          contentLabel: "item",
        });
        if (!graphValidation.ok) return errorResponse(graphValidation.message);
      }
      // Validate that weapons and battle consumables have at least one effect with both appearAnimation and appearSfx
      const requiresAnimation =
        input.data.itemType === "WEAPON" ||
        (input.data.itemType === "CONSUMABLE" && !input.data.preventBattleUsage);
      if (
        requiresAnimation &&
        !input.data.hidden &&
        !hasAppearAnimation(input.data.effects)
      ) {
        return errorResponse(
          "Weapons and battle-usable consumables must have at least one effect with both appearAnimation and appearSfx defined",
        );
      }
      // Server-side enforcement: preserve existing reward_reputation for users without permission
      // Match effects by content (excluding reward_reputation) to handle reordering
      if (!canAwardReputation(user.role)) {
        preserveEffectReputation(entry.effects, input.data.effects);
      }
      // Calculate diff
      const diff = calculateContentDiff(entry, {
        id: entry.id,
        updatedAt: entry.updatedAt,
        createdAt: entry.createdAt,
        ...input.data,
      });
      // Write-time parent existence + sibling-cap guards when setting an evolution parent.
      // The subquery aliases materialize derived tables, avoiding MySQL errno 1093
      // (an UPDATE cannot otherwise read its own target table in a subquery).
      const evolutionUpdateGuards: SQL[] = [];
      if (input.data.parentItemId) {
        const parentItemForEvo = selectItemForUpdate(ctx.drizzle, {
          data: { parentItemId: input.data.parentItemId },
        });
        const evoSiblingCount = selectItemForUpdate2(ctx.drizzle, {
          data: { parentItemId: input.data.parentItemId },
          id: input.id,
        });
        evolutionUpdateGuards.push(
          exists(selectParentItemForEvoForUpdate(ctx.drizzle, parentItemForEvo)),
          lt(
            selectEvoSiblingCountForUpdate(ctx.drizzle, evoSiblingCount),
            EVOLUTION_MAX_CHILDREN,
          ),
        );
      }

      // Setting updatedAt explicitly makes rowsAffected reliable: MySQL reports
      // changed rows, so a no-change re-save would otherwise read as a failed guard.
      const updateResult = await updateItemForUpdate(
        ctx.drizzle,
        input,
        evolutionUpdateGuards,
      );
      if (updateResult.rowsAffected === 0) {
        return errorResponse(
          "Update failed — item references, LPC design, or evolution limits changed. Refresh and try again.",
        );
      }

      // Replace crafting requirements only after the guarded update succeeds, so a
      // failed guard can never wipe the recipe without re-inserting it.
      const newRequirements = input.data.craftingRequirements;
      await Promise.all([
        (async () => {
          await deleteCraftingRequirementForUpdate(ctx.drizzle, input);
          if (newRequirements && newRequirements.length > 0) {
            await insertCraftingRequirementForUpdate(
              ctx.drizzle,
              newRequirements,
              input,
            );
          }
        })(),
        insertActionLogForUpdate(ctx.drizzle, ctx, diff, entry),
        ...(input.data.hidden ? [updateUserItemForUpdate(ctx.drizzle, entry)] : []),
      ]);
      await outdateProposalsFor(
        ctx.drizzle,
        "ITEM",
        [entry.id],
        editedReason("ITEM", entry.name, user.username),
      );
      await callDiscordContent(user.username, entry.name, diff, entry.image);
      return { success: true, message: `Data updated: ${diff.join(". ")}` };
    }),

  getEvolutions: publicProcedure
    .meta({
      mcp: {
        description: "Get all evolution items for a parent item",
      },
    })
    .input(getItemEvolutionsSchema)
    .query(async ({ ctx, input }) => {
      const [viewerRole, evolutions] = await Promise.all([
        fetchViewerRole(ctx.drizzle, ctx.userId),
        listItemForGetEvolutions(ctx.drizzle, input),
      ]);
      return filterVisibleEvolutions(evolutions, canChangeContent(viewerRole));
    }),

  evolveItem: protectedProcedure
    .meta({ mcp: { description: "Evolve an item into its evolution" } })
    .input(evolveItemSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const [
        { user: initialUser, settings, requiresProgressionRefresh },
        userItems,
        evolutionItem,
        loadouts,
      ] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        fetchUserItems(ctx.drizzle, ctx.userId, { includeHidden: true }),
        fetchItem(ctx.drizzle, input.evolutionItemId),
        fetchItemLoadouts(ctx.drizzle, ctx.userId),
      ]);
      if (!initialUser) return errorResponse("User not found");
      const readiness = prepareActionReadiness(initialUser, settings);
      if (readiness.error) return errorResponse(readiness.error);
      const user = readiness.user;

      if (!evolutionItem) return errorResponse("Evolution item not found");
      const parentItemId = evolutionItem.parentItemId;
      if (!parentItemId) return errorResponse("Target item is not an evolution");
      if (evolutionItem.hidden && !canChangeContent(user.role))
        return errorResponse("This evolution is not yet available");

      const userItemObj = userItems.find((ui) => ui.id === input.userItemId);
      if (!userItemObj) return errorResponse("You don't own this item");

      const alreadyEvolved = userItemObj.itemId === input.evolutionItemId;
      if (!alreadyEvolved && userItemObj.itemId !== parentItemId) {
        return errorResponse("This item cannot evolve into the target evolution");
      }

      if (!alreadyEvolved) {
        if (userItemObj.isInAuction)
          return errorResponse("Cannot evolve an item that is in an auction");
        if (userItemObj.quantity !== 1)
          return errorResponse("Split the stack to a single item before evolving");
        if (
          userItemObj.craftingFinishedAt &&
          userItemObj.craftingFinishedAt > new Date()
        ) {
          return errorResponse("Cannot evolve an item that is still crafting");
        }
        if (userItemObj.level < ITEM_LEVEL_CAP) {
          return errorResponse(
            `Item must be at max level (${ITEM_LEVEL_CAP}) to evolve`,
          );
        }
        if (!hasRequiredLevel(user.level, evolutionItem.requiredLevel))
          return errorResponse(
            "You don't meet the level requirement for this evolution",
          );
        if (!meetsEvolutionStatRequirements(evolutionItem, user))
          return errorResponse(
            "You don't meet the stat requirements for this evolution",
          );
        if (
          evolutionItem.bloodlineId &&
          evolutionItem.bloodlineId !== user.bloodlineId
        ) {
          return errorResponse(
            "You don't meet the bloodline requirement for this evolution",
          );
        }
      }

      const canKeepEquipped =
        hasRequiredSkill(evolutionItem, user) &&
        (userItemObj.equipped === "NONE" ||
          isCompatibleEquipSlot(userItemObj.equipped, evolutionItem.slot));

      let didEvolveThisCall = false;
      if (!alreadyEvolved) {
        const evolveResult = await updateUserItemForEvolveItem(
          ctx.drizzle,
          input,
          evolutionItem,
          canKeepEquipped,
          ctx,
          parentItemId,
          userItemObj,
          readiness,
        );

        didEvolveThisCall = evolveResult.rowsAffected > 0;
        if (!didEvolveThisCall) {
          const evolvedNow = await findUserItemForEvolveItem(ctx.drizzle, input, ctx);
          if (!evolvedNow) {
            return errorResponse(
              "Evolution failed - item may have already been evolved",
            );
          }
        }
      }

      const cleanupWrites: Promise<unknown>[] = [];

      // Drop imbuements that cannot exist on the evolved item and refund their
      // crystals, mirroring removeImbuement's policy for system-forced removals.
      const { remove: imbuementsToRemove } = partitionImbuementsForItemTransfer(
        userItemObj.imbuements,
        evolutionItem,
      );
      if (imbuementsToRemove.length > 0) {
        cleanupWrites.push(
          deleteUserItemImbuementForEvolveItem(ctx.drizzle, imbuementsToRemove),
          insertUserItemForEvolveItem(ctx.drizzle, imbuementsToRemove, ctx),
        );
      }

      // Copy-specific entries can be updated directly. Legacy entries — and
      // entries whose saved inventory row no longer exists — only identify the
      // parent by itemId, so they may be remapped or stripped only when no other
      // parent copy remains to which they could still belong.
      const ownsOtherParentCopy = userItems.some(
        (ui) =>
          ui.id !== input.userItemId && ui.itemId === parentItemId && ui.quantity > 0,
      );
      const ownsSavedRow = (id?: string) =>
        !!id && userItems.some((ui) => ui.id === id);
      const referencesEvolvedCopy = (entry: ItemLoadout["itemData"][number]) =>
        ownsSavedRow(entry.userItemId)
          ? entry.userItemId === input.userItemId
          : !ownsOtherParentCopy && entry.itemId === parentItemId;
      loadouts
        .filter((loadout) => loadout.itemData.some(referencesEvolvedCopy))
        .forEach((loadout) => {
          // Remapped entries also adopt the evolved row's id, upgrading legacy
          // and dangling references to copy-specific ones.
          const itemData = canKeepEquipped
            ? loadout.itemData.map((entry) =>
                referencesEvolvedCopy(entry)
                  ? { ...entry, userItemId: input.userItemId, itemId: evolutionItem.id }
                  : entry,
              )
            : loadout.itemData.filter((entry) => !referencesEvolvedCopy(entry));
          cleanupWrites.push(
            updateItemLoadoutForEvolveItem(ctx.drizzle, itemData, loadout, ctx),
          );
        });

      const [recovery] = await Promise.all([
        didEvolveThisCall
          ? Promise.resolve({ rowsAffected: 1 })
          : updateUserForActionReadiness(ctx.drizzle, readiness),
        ...cleanupWrites,
        ...(didEvolveThisCall
          ? [
              insertActionLogForEvolveItem(
                ctx.drizzle,
                ctx,
                userItemObj,
                evolutionItem,
                input,
              ),
            ]
          : []),
      ]);

      if (!recovery.rowsAffected)
        return errorResponse("Your status changed. Please try again.");
      return actionReadinessResponse(
        {
          success: true,
          ...getEvolvedItemUserUpdate({
            user,
            owned: userItemObj,
            evolution: evolutionItem,
            canKeepEquipped,
            removedImbuementIds: imbuementsToRemove.map((entry) => entry.id),
            didEvolve: didEvolveThisCall,
            canProject:
              !requiresProgressionRefresh && (didEvolveThisCall || alreadyEvolved),
          }),
          message: didEvolveThisCall
            ? `Evolved into ${evolutionItem.name}!`
            : `Finished evolution cleanup for ${evolutionItem.name}`,
        },
        readiness,
        ctx.drizzle,
      );
    }),

  getAll: publicProcedure
    .meta({ mcp: { description: "Get paginated items with filters" } })
    .input(
      itemFilteringSchema.extend({
        cursor: z.number().nullish(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { skip, cursorAfter } = offsetPage(input);

      // Build where conditions using the generalized filter
      const baseFilters = itemDatabaseFilter(input);

      const results = await listItemForGetAll(ctx.drizzle, skip, input, baseFilters);
      const nextCursor = cursorAfter(results);
      return {
        data: results,
        nextCursor: nextCursor,
      };
    }),

  // Get counts of user items grouped by item ID
  getUserItemCounts: protectedProcedure
    .meta({ mcp: { description: "Get user item counts by item ID" } })
    .query(async ({ ctx }) => {
      const counts = await selectUserItemForGetUserItemCounts(ctx.drizzle, ctx);
      return counts.map((c) => ({ id: c.itemId, quantity: c.quantity ?? 0 }));
    }),
  // Get user items
  getUserItems: protectedProcedure
    .meta({ mcp: { description: "Get all user items" } })
    .query(async ({ ctx }) => {
      return await fetchUserItems(ctx.drizzle, ctx.userId);
    }),
  getUserItemsWithVariants: protectedProcedure
    .meta({
      mcp: { description: "Get all user items including variant data" },
    })
    .query(async ({ ctx }) => {
      return await fetchUserItemsWithVariants(ctx.drizzle, ctx.userId);
    }),
  // Get items of public user (staff edit)
  getPublicUserItems: protectedProcedure
    .input(getPublicUserItemsSchema)
    .query(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (!canEditItems(user.role)) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Not allowed to edit public user",
        });
      }
      if (isRestrictedToSelf(user.role, user.userId, input.userId)) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You can only view your own items",
        });
      }
      // fetchUserItems self-heals stale merge claims for the viewed user.
      return await fetchUserItems(ctx.drizzle, input.userId, {
        includeHidden: true,
      });
    }),
  // Adjust item level of public user
  adjustUserItem: protectedProcedure
    .input(adjustUserItemSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, owned] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        findUserItemForAdjustUserItem(ctx.drizzle, input),
      ]);
      if (!canEditItems(user.role)) {
        return errorResponse("Not allowed to edit public user");
      }
      if (isRestrictedToSelf(user.role, user.userId, input.userId)) {
        return errorResponse("You can only edit your own items");
      }
      if (!owned?.item) {
        return errorResponse("Item not found for user");
      }

      const updateResult = await updateUserItemForAdjustUserItem(
        ctx.drizzle,
        input,
        owned,
      );
      if (updateResult.rowsAffected === 0) {
        return errorResponse("Item changed concurrently — refresh and try again");
      }

      await insertActionLogForAdjustUserItem(ctx.drizzle, ctx, owned, input);
      return { success: true, message: "Item updated" };
    }),
  getVariantNames: protectedProcedure.query(({ ctx }) => listVariantNames(ctx.drizzle)),

  // Get all variants for an item
  getItemVariants: protectedProcedure
    .input(z.object({ itemId: z.string() }))
    .output(z.array(ItemVariantResponseSchema))
    .query(async ({ ctx, input }) => {
      return await listItemVariantForGetItemVariants(ctx.drizzle, input);
    }),
  // Get unlocked variants for the current user for a given item
  getUserUnlockedVariants: protectedProcedure
    .input(z.object({ itemId: z.string() }))
    .output(z.array(UserUnlockedVariantResponseSchema))
    .query(async ({ ctx, input }) => {
      return selectUserItemVariantForGetUserUnlockedVariants(ctx.drizzle, ctx, input);
    }),
  // Admin: create or update a variant
  upsertItemVariant: protectedProcedure
    .input(upsertItemVariantInputSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, existing, parentItem, requiredItem, lpcDesign] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        listItemVariantForUpsertItemVariant(ctx.drizzle, input),
        findItemForUpsertItemVariant(ctx.drizzle, input),
        input.variant.requiredItemId
          ? findItemForUpsertItemVariant(ctx.drizzle, {
              itemId: input.variant.requiredItemId,
            })
          : undefined,
        findLpcDesignForSelection(ctx.drizzle, input.variant.lpcProfile),
      ]);
      if (user.isBanned) return errorResponse("You are banned");
      if (!canChangeContent(user.role)) return errorResponse("Not allowed");
      if (!parentItem) return errorResponse("Item not found");
      const spriteError = lpcSelectionError(
        input.variant.lpcProfile,
        existing.find((variant) => variant.id === input.variant.id)?.lpcProfile,
        lpcDesign,
      );
      if (spriteError) return errorResponse(spriteError);
      if (input.variant.requiredItemId && !requiredItem)
        return errorResponse("Required unlock item not found");
      if (input.variant.requiredItemId && input.variant.costType !== "VARIANT_TOKEN")
        return errorResponse("Only token variants can require an unlock item");
      if (
        requiredItem &&
        !requiredItem.effects.some(
          (effect) =>
            effect.type === "unlockitemvariant" &&
            (!effect.variantId || effect.variantId === input.variant.id),
        )
      ) {
        return errorResponse("Required unlock item cannot unlock this variant");
      }
      if (parentItem.itemType !== "FURNITURE" && input.variant.furnitureData) {
        return errorResponse("Only furniture variants can define orientation images");
      }
      if (!input.variant.id && existing.length >= MAX_ITEM_VARIANTS) {
        return errorResponse(`Items can have at most ${MAX_ITEM_VARIANTS} variants`);
      }
      const orderConflict = existing.find(
        (v) => v.order === input.variant.order && v.id !== input.variant.id,
      );
      if (orderConflict) {
        return errorResponse(
          `Order ${input.variant.order} is already used by "${orderConflict.name}"`,
        );
      }
      // Use the strict variant sanitizer (no img/iframe) to prevent tracking pixels
      // in the combat log (battleDescription is rendered via parseHtml for all viewers).
      const safeDescription = input.variant.description
        ? sanitizeVariantText(input.variant.description)
        : null;
      const safeBattleDescription = input.variant.battleDescription
        ? sanitizeVariantText(input.variant.battleDescription)
        : null;

      if (input.variant.id) {
        const result = await updateItemVariantForUpsertItemVariant(
          ctx.drizzle,
          {
            variant: {
              name: input.variant.name,
              image: input.variant.image,
              requiredItemId: input.variant.requiredItemId,
              costType: input.variant.costType,
              cost: input.variant.cost,
              order: input.variant.order,
              furnitureData: input.variant.furnitureData,
              id: input.variant.id,
              lpcProfile: input.variant.lpcProfile,
              lpcColor: input.variant.lpcColor,
            },
            itemId: input.itemId,
          },
          safeDescription,
          safeBattleDescription,
        );
        if (result.rowsAffected === 0)
          return errorResponse(
            "Variant, required item, or LPC design changed — refresh and try again",
          );
      } else {
        const newVariantId = nanoid();
        const insertResult = await insertItemVariantForUpsertItemVariant(
          ctx.drizzle,
          newVariantId,
          input,
          safeDescription,
          safeBattleDescription,
        );
        if (insertResult.rowsAffected === 0) {
          return errorResponse(
            `Order ${input.variant.order} is taken or an item or LPC design changed — refresh and try again`,
          );
        }
        // Re-count after insert to close the TOCTOU window on MAX_ITEM_VARIANTS
        const [countRow] = await selectItemVariantForUpsertItemVariant(
          ctx.drizzle,
          input,
        );
        if ((countRow?.n ?? 0) > MAX_ITEM_VARIANTS) {
          await deleteItemVariantById(ctx.drizzle, newVariantId);
          return errorResponse(`Items can have at most ${MAX_ITEM_VARIANTS} variants`);
        }
      }
      await outdateProposalsFor(
        ctx.drizzle,
        "ITEM",
        [parentItem.id],
        editedReason("ITEM", parentItem.name, user.username),
      );
      return { success: true, message: "Variant saved" };
    }),
  // Admin: delete a variant
  deleteItemVariant: protectedProcedure
    .input(z.object({ variantId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, variant] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        findItemVariantForDeleteItemVariant(ctx.drizzle, input),
      ]);
      if (user.isBanned) return errorResponse("You are banned");
      if (!canChangeContent(user.role)) return errorResponse("Not allowed");
      // Step 1: remove user unlock records and clear active variant references in parallel
      await Promise.all([
        deleteUserItemVariantForDeleteItemVariant(ctx.drizzle, input),
        updateUserItemForDeleteItemVariant(ctx.drizzle, input),
      ]);
      // Step 2: delete the variant row itself (after FK dependents are cleared)
      await deleteItemVariantById(ctx.drizzle, input.variantId);
      if (variant?.item) {
        await outdateProposalsFor(
          ctx.drizzle,
          "ITEM",
          [variant.item.id],
          editedReason("ITEM", variant.item.name, user.username),
        );
      }
      return { success: true, message: "Variant deleted" };
    }),
  // Purchase a variant with in-game currency
  purchaseVariant: protectedProcedure
    .input(z.object({ variantId: z.string() }))
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Query — ownership check runs in parallel (variantId known upfront)
      const [user, variant, ownershipRows, existingUnlock] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        findItemVariantForPurchaseVariant(ctx.drizzle, input),
        fetchVariantOwnership(ctx.drizzle, ctx.userId, input.variantId),
        findUserItemVariantForPurchaseVariant(ctx.drizzle, ctx, input),
      ]);

      // Guards
      if (user.isBanned) return errorResponse("You are banned");
      if (!variant) return errorResponse("Variant not found");
      if (variant.costType === "VARIANT_TOKEN") {
        return errorResponse(
          "This variant requires a Variant Token — use consumeVariantToken instead",
        );
      }
      if (!ownershipRows.length) return errorResponse("You don't own this item");
      if (existingUnlock) return errorResponse("Variant already unlocked");

      // Prestige variants share the preview's loyalty price; other currencies keep their cost.
      const cost =
        variant.costType === "VILLAGE_PRESTIGE"
          ? getVillageLoyaltyShopCost(variant.cost, user)
          : variant.cost;
      const currency = getVariantCurrencyOps(variant.costType, cost, user);
      if (currency.balance < cost) {
        return errorResponse(`Insufficient ${currency.label}. Need ${cost}`);
      }

      // Mutate — deduct currency first with CAS guard (skip for free variants)
      if (cost > 0) {
        const deductResult = await updateUserDataForPurchaseVariant(
          ctx.drizzle,
          currency,
          ctx,
        );

        if (deductResult.rowsAffected !== 1) {
          return errorResponse("Insufficient funds — please refresh and try again");
        }
      }

      // Refund the deducted currency (no-op for free variants).
      const refundCurrency = async () => {
        if (cost > 0) {
          await updateUserDataForRefundCurrency(ctx.drizzle, currency, ctx);
        }
      };

      // Insert unlock. Both failure modes refund so the user is never charged
      // without receiving the unlock:
      //  - rowsAffected === 0: a concurrent purchase won the unique-index race and
      //    onDuplicateKeyUpdate silently swallowed the duplicate, which would
      //    otherwise double-charge this caller for an unlock it never inserted.
      //  - thrown error: an unexpected DB failure.
      try {
        const insertResult = await insertUserItemVariantForPurchaseVariant(
          ctx.drizzle,
          ctx,
          input,
        );
        if (insertResult.rowsAffected === 0) {
          await refundCurrency();
          return errorResponse("Variant already unlocked");
        }
      } catch {
        await refundCurrency();
        return errorResponse("Failed to unlock variant — please try again");
      }

      return {
        success: true,
        message: `Variant "${variant.name}" unlocked!`,
        ...getPurchaseVariantUserUpdate({
          user,
          variantCost: variant.cost,
          variantCostType: variant.costType,
        }),
      };
    }),
  // Set the active variant on a user item (null to clear)
  selectVariant: protectedProcedure
    .input(
      z.object({
        userItemId: z.string(),
        variantId: z.string().nullable(),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, ui, unlock] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUserItemWithVariants(ctx.drizzle, ctx.userId, input.userItemId),
        input.variantId
          ? findUserItemVariantForPurchaseVariant(ctx.drizzle, ctx, {
              variantId: input.variantId,
            })
          : Promise.resolve(undefined),
      ]);

      // Guards
      if (user.isBanned) return errorResponse("You are banned");
      if (!ui) return errorResponse("Item not found");
      if (input.variantId && !unlock) {
        return errorResponse("Variant not unlocked");
      }
      if (input.variantId) {
        const variantBelongsToItem = ui.item.variants?.some(
          (v) => v.id === input.variantId,
        );
        if (!variantBelongsToItem) {
          return errorResponse("Variant does not belong to this item");
        }
      }

      // Mutate — when setting a variant, gate the write on the unlock still
      // existing at write time via an EXISTS subquery. deleteItemVariant nulls
      // activeVariantId on all rows when a variant is removed, but that cascade
      // cannot stop a selectVariant write that lands *after* it; the EXISTS guard
      // is evaluated atomically inside this UPDATE, so a concurrently-deleted
      // unlock makes the row no longer match and we refuse to persist a dangling
      // variant. Clearing (variantId === null) needs no such guard.
      const updateResult = await updateUserItemForSelectVariant(
        ctx.drizzle,
        input,
        ctx,
      );

      // PlanetScale reports *changed* rows, so rowsAffected is 0 in three cases:
      // the row was deleted between the guard and this update, the unlock was
      // concurrently deleted (EXISTS guard above fails), or the variant was
      // already active (a harmless re-select). The first two are errors; the
      // re-select is not. All zero-row error cases coincide with the fetched row
      // still holding a different active variant than the one requested.
      if (updateResult.rowsAffected === 0 && ui.activeVariantId !== input.variantId) {
        return errorResponse("Item no longer available — please refresh and try again");
      }

      return { success: true, message: "Active variant updated" };
    }),
  // Consume a Variant Token item to unlock a VARIANT_TOKEN-gated variant
  consumeVariantToken: protectedProcedure
    .input(z.object({ tokenUserItemId: z.string(), variantId: z.string() }))
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Query — ownership check runs in parallel (variantId known upfront). The
      // token only needs its base item (effects) and quantity, so fetchUserItem
      // (no variant join) suffices here.
      const [initialUser, tokenItem, variant, ownershipRows, existingUnlock, settings] =
        await Promise.all([
          fetchActionUser(ctx.drizzle, ctx.userId),
          fetchUserItem(ctx.drizzle, ctx.userId, input.tokenUserItemId),
          findItemVariantForPurchaseVariant(ctx.drizzle, input),
          fetchVariantOwnership(ctx.drizzle, ctx.userId, input.variantId),
          findUserItemVariantForPurchaseVariant(ctx.drizzle, ctx, input),
          fetchAllGameSettings(ctx.drizzle),
        ]);
      const readiness = prepareActionReadiness(initialUser, settings);
      if (readiness.error) return errorResponse(readiness.error);
      const user = readiness.user;

      // Guards — mirror the consume mutation's state checks so a token cannot be
      // spent while the user is not AWAKE (covers TRAVEL/BATTLE/ASLEEP/etc.), while
      // the token stack is still crafting, or while it is tied to an active auction.
      // The atomic consumption below also rechecks auction and hunting availability.
      if (user.isBanned) return errorResponse("You are banned");

      if (!tokenItem) return errorResponse("Token item not found");
      if (!hasRequiredSkill(tokenItem.item, user))
        return errorResponse("Activate the required skill to use this token");
      if (tokenItem.storedAtHome) {
        return errorResponse("Fetch the Variant Token from home storage first");
      }
      if (tokenItem.craftingFinishedAt && tokenItem.craftingFinishedAt > new Date()) {
        return errorResponse("Cannot consume a Variant Token that is still crafting");
      }
      if (tokenItem.isInAuction) {
        return errorResponse("Cannot consume a Variant Token listed in an auction");
      }
      if (!variant) return errorResponse("Variant not found");
      if (variant.costType !== "VARIANT_TOKEN") {
        return errorResponse("This variant does not require a Variant Token");
      }
      const hasVariantTokenEffect = tokenItem.item.effects.some(
        (e) =>
          e.type === "unlockitemvariant" &&
          (!e.variantId || e.variantId === variant.id),
      );
      if (variant.requiredItemId && variant.requiredItemId !== tokenItem.item.id) {
        return errorResponse("This variant requires a different unlock item");
      }
      if (!hasVariantTokenEffect) {
        return errorResponse("This item cannot unlock this variant");
      }
      if (!ownershipRows.length) return errorResponse("You don't own this item");
      if (existingUnlock) return errorResponse("Variant already unlocked");

      // Mutate — consume token first so a crash after this leaves the user without
      // the token but without the unlock (safe-failure direction: retryable). Uses
      // the canonical atomic helper (CAS on quantity, deletes the stack at zero).
      let consumed: boolean;
      try {
        const result = await retryOnDeadlock(() =>
          consumeVariantTokenForAction(ctx.drizzle, ctx.userId, tokenItem, readiness),
        );
        consumed = result.rowsAffected > 0;
      } catch {
        return errorResponse("Could not consume Variant Token — please try again");
      }

      if (!consumed) {
        return errorResponse("Token item was modified concurrently — please try again");
      }

      // Insert unlock — idempotent via unique constraint. The token is already
      // consumed at this point, so both a thrown DB error and a swallowed duplicate
      // (rowsAffected === 0, meaning a concurrent unlock won the race) are surfaced
      // to the user — the token cannot be refunded once spent.
      try {
        const [insertResult] = await Promise.all([
          insertUserItemVariantForPurchaseVariant(ctx.drizzle, ctx, input),
          tokenItem.quantity === 1
            ? deleteEmptyUserItem(ctx.drizzle, tokenItem.id, ctx.userId).catch(
                (error: unknown) => {
                  // The debit is committed; hidden zero stacks can be reclaimed without repeating the unlock.
                  Sentry.captureException(error, {
                    tags: { source: "consumeVariantToken.cleanup" },
                  });
                },
              )
            : undefined,
        ]);
        if (insertResult.rowsAffected === 0) {
          return actionReadinessResponse(
            errorResponse(
              "Variant was already unlocked — your token was consumed. Please contact support.",
            ),
            readiness,
            ctx.drizzle,
          );
        }
      } catch {
        return actionReadinessResponse(
          errorResponse(
            "Token consumed but variant unlock failed — please contact support",
          ),
          readiness,
          ctx.drizzle,
        );
      }

      return actionReadinessResponse(
        {
          success: true,
          ...getRepairedEquipmentUpdate(user, [
            { before: tokenItem, quantity: tokenItem.quantity - 1 },
          ]),
          message: `Variant "${variant.name}" unlocked with token!`,
        },
        readiness,
        ctx.drizzle,
      );
    }),
  getItemRelations: publicProcedure
    .meta({
      mcp: { description: "Get item relations and dependencies" },
    })
    .input(z.object({ itemId: z.string() }))
    .query(async ({ ctx, input }) => {
      const results = await getItemRelations(ctx.drizzle, input.itemId);
      return results;
    }),
  // Merge item stacks
  mergeStacks: protectedProcedure
    .meta({
      mcp: {
        description:
          "Merge carried stacks for one item type (storedAtHome=false). Per (storedAtHome+equipped) bucket; home storage is not included",
      },
    })
    .input(z.object({ itemId: z.string() }))
    .output(
      userDeltaResponseSchema.extend({
        inventoryChanges: z.array(inventoryQuantityChangeSchema).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [initialUser, settings] = await Promise.all([
        fetchActionUser(ctx.drizzle, ctx.userId),
        fetchAllGameSettings(ctx.drizzle),
      ]);
      const readiness = prepareActionReadiness(initialUser, settings);
      if (readiness.error) return errorResponse(readiness.error);
      const user = readiness.user;

      const recoveredAt = getNextUserSnapshotAt(user.updatedAt);
      const ownerWhere = recoveryMergeOwnerWhere(readiness, recoveredAt);
      const [result, recovery] = await Promise.all([
        executeMergeStacksForItem(
          ctx.drizzle,
          ctx.userId,
          input.itemId,
          undefined,
          ownerWhere,
        ),
        updateUserForActionReadiness(ctx.drizzle, readiness, recoveredAt),
      ]);
      if (!recovery.rowsAffected)
        return errorResponse("Your status changed. Please try again.");
      if (!result.success) {
        return actionReadinessResponse(
          { success: false, message: result.message },
          readiness,
          ctx.drizzle,
        );
      }
      return actionReadinessResponse(
        {
          success: true,
          message: result.didMerge ? result.message : "Nothing to merge",
          inventoryChanges: result.inventoryChanges,
          ...getMergedStacksUserUpdate(user, result.inventoryChanges),
        },
        readiness,
        ctx.drizzle,
      );
    }),

  mergeAllStacks: protectedProcedure
    .meta({
      mcp: {
        description:
          "Merge all mergeable item stacks in carried inventory (storedAtHome=false) or home storage (storedAtHome=true)",
      },
    })
    .input(z.object({ storedAtHome: z.boolean().optional() }).nullish())
    .output(
      userDeltaResponseSchema.extend({
        inventoryChanges: z.array(inventoryQuantityChangeSchema).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const storedAtHome = input?.storedAtHome ?? false;
      const [initialUser, recovered, settings] = await Promise.all([
        fetchActionUser(ctx.drizzle, ctx.userId),
        restoreStaleMergeStackClaims(ctx.drizzle, ctx.userId),
        fetchAllGameSettings(ctx.drizzle),
      ]);
      const readiness = prepareActionReadiness(initialUser, settings);
      if (readiness.error) return errorResponse(readiness.error);
      const user = readiness.user;
      const recoveredAt = getNextUserSnapshotAt(user.updatedAt);
      const ownerWhere = recoveryMergeOwnerWhere(readiness, recoveredAt);

      const userItemsAll = await listUserItemForMergeAllStacks(
        ctx.drizzle,
        ctx,
        storedAtHome,
      );
      // The item relation has no foreign key, so an orphaned stack can have no item.
      const stacksByItemId = groupBy(
        userItemsAll.filter((r) => r.item && r.item.stackSize > 1),
        "itemId",
      );
      const [results, recovery] = await Promise.all([
        Promise.all(
          [...stacksByItemId].map(([itemId, rows]) =>
            executeMergeStacksForItem(
              ctx.drizzle,
              ctx.userId,
              itemId,
              { userItems: rows, item: rows[0]?.item },
              ownerWhere,
            ),
          ),
        ),
        updateUserForActionReadiness(ctx.drizzle, readiness, recoveredAt),
      ]);
      if (!recovery.rowsAffected)
        return errorResponse("Your status changed. Please try again.");
      const failed = results.filter((r) => !r.success);
      const mergedTypes = results.filter((r) => r.success && r.didMerge).length;

      if (failed.length > 0 && mergedTypes === 0) {
        return actionReadinessResponse(
          { success: false, message: failed[0]?.message ?? "Merge failed" },
          readiness,
          ctx.drizzle,
        );
      }
      if (failed.length > 0) {
        return actionReadinessResponse(
          {
            success: false,
            message: `Merged ${mergedTypes} item type${mergedTypes === 1 ? "" : "s"}, but ${failed.length} other type${failed.length === 1 ? "" : "s"} did not complete (inventory may already show partial merges — try merge again).`,
          },
          readiness,
          ctx.drizzle,
        );
      }
      return actionReadinessResponse(
        {
          success: true,
          message:
            mergedTypes === 0
              ? "Nothing to merge"
              : `Merged stacks for ${mergedTypes} item type${mergedTypes === 1 ? "" : "s"}`,
          ...getMergedStacksUserUpdate(
            user,
            recovered
              ? undefined
              : results.flatMap((result) => result.inventoryChanges ?? []),
          ),
          inventoryChanges: recovered
            ? undefined
            : results.flatMap((result) => result.inventoryChanges ?? []),
        },
        readiness,
        ctx.drizzle,
      );
    }),
  // Split item stack
  splitStack: protectedProcedure
    .meta({ mcp: { description: "Split an item stack" } })
    .use(ratelimitMiddleware)
    .input(
      z.object({
        userItemId: z.string(),
        quantityToKeep: z.int().min(1),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Use the convenience method to split the stack
      const result = await splitItemStack(
        ctx.drizzle,
        input.userItemId,
        ctx.userId,
        input.quantityToKeep,
      );

      return { success: result.success, message: result.message };
    }),
  // Sell a user item (dropped when it has no resale value)
  sellUserItem: protectedProcedure
    .meta({ mcp: { description: "Sell or drop a user item" } })
    .input(z.object({ userItemId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, useritem, structures] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUserItem(ctx.drizzle, ctx.userId, input.userItemId),
        selectVillageStructureForSellUserItem(ctx.drizzle, ctx),
      ]);
      // Guard
      if (!useritem) return errorResponse("User item not found");
      if (useritem.craftingFinishedAt && useritem.craftingFinishedAt > new Date()) {
        return errorResponse("Cannot sell crafting item");
      }
      if (useritem.isInAuction) {
        return errorResponse("Cannot sell item in auction");
      }
      if (!canDropFarmSeed(useritem.item, user.farmCurrency)) {
        return errorResponse(
          `You need ${useritem.item.farmSellValue} farm coins to buy ${useritem.item.name} back, so it cannot be dropped. Plant it at your farm instead.`,
        );
      }
      // Derived
      const cost = calcItemSellingPrice(user, useritem, structures);
      // Claim the positive stack before granting proceeds. A merge claim negates quantity, so the
      // CAS cannot delete or pay for a row while it belongs to an in-flight merge.
      const deleteResult = await retryOnDeadlock(async () =>
        deleteUserItemForSellUserItem(ctx.drizzle, input, ctx, useritem),
      );
      if (deleteResult.rowsAffected !== 1) {
        return errorResponse(HUNTING_INVENTORY_UNAVAILABLE_MESSAGE);
      }

      // Mutate dependent state only after the inventory CAS succeeds.
      await Promise.all([
        deleteUserItemImbuementForSellUserItem(ctx.drizzle, input),
        incrementUserMoney(ctx.drizzle, cost, ctx.userId),
        ...(useritem.item.cost >= 500000
          ? [insertActionLogForSellUserItem(ctx.drizzle, ctx, useritem, cost)]
          : []),
      ]);
      return {
        success: true,
        message:
          cost > 0
            ? `You sold ${useritem.item.name} for ${cost} ryo`
            : `You dropped ${useritem.item.name}`,
      };
    }),
  sellUserItems: protectedProcedure
    .meta({ mcp: { description: "Sell or drop several user items at once" } })
    .input(
      z.object({
        userItemIds: z
          .array(z.string())
          .min(1)
          .max(MAX_BULK_SELL_ITEMS)
          .refine(
            (ids) => new Set(ids).size === ids.length,
            "Each item can be sold once",
          ),
      }),
    )
    .output(
      userDeltaResponseSchema.extend({
        soldUserItemIds: z.array(z.string()),
        ryo: z.number(),
        refused: z.array(
          z.object({ userItemId: z.string(), name: z.string(), reason: z.string() }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, useritems, structures] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        listUserItemsForSellUserItems(ctx.drizzle, ctx, input.userItemIds),
        selectVillageStructureForSellUserItem(ctx.drizzle, ctx),
      ]);
      // Guard each stack: a single sale's rules, limited to the backpack's unequipped stacks
      const refused: { userItemId: string; name: string; reason: string }[] = [];
      const sellable: typeof useritems = [];
      for (const userItemId of input.userItemIds) {
        const useritem = useritems.find((row) => row.id === userItemId);
        const reason = useritem
          ? bulkSellBlockReason(useritem, user.farmCurrency)
          : "is not in your inventory";
        if (useritem && !reason) sellable.push(useritem);
        else {
          refused.push({
            userItemId,
            name: useritem?.item.name ?? "Item",
            reason: reason ?? "is not in your inventory",
          });
        }
      }
      const salePrices = sellable.map((useritem) =>
        calcItemSellingPrice(user, useritem, structures),
      );
      const sales = await Promise.allSettled(
        sellable.map((useritem, index) =>
          retryOnDeadlock(async () =>
            sellUserItemAtomically(ctx.drizzle, ctx, useritem, salePrices[index] ?? 0),
          ),
        ),
      );
      const unconfirmed: typeof refused = [];
      const sold = sellable.filter((useritem, index) => {
        const sale = sales[index];
        if (sale?.status === "fulfilled" && sale.value.rowsAffected > 0) {
          return true;
        }
        if (sale?.status === "rejected") {
          // A lost acknowledgement can follow a committed sale, so its balance is unknown.
          unconfirmed.push({
            userItemId: useritem.id,
            name: useritem.item.name,
            reason: "sale could not be confirmed",
          });
          return false;
        }
        refused.push({
          userItemId: useritem.id,
          name: useritem.item.name,
          reason: "changed, is in use by a hunting battle, or could not be sold",
        });
        return false;
      });
      const prices = salePrices.filter((_, index) => {
        const sale = sales[index];
        return sale?.status === "fulfilled" && sale.value.rowsAffected > 0;
      });
      const ryo = prices.reduce((sum, price) => sum + price, 0);
      // Cleanup cannot make a paid stack sellable again, even if it needs retrying.
      if (sold.length > 0) {
        await Promise.all([
          deleteUserItemImbuementsForSellUserItems(
            ctx.drizzle,
            sold.map((useritem) => useritem.id),
          ),
          deleteEmptyUserItem(
            ctx.drizzle,
            sold.map((useritem) => useritem.id),
            ctx.userId,
          ),
          ...sold.flatMap((useritem, index) =>
            useritem.item.cost >= 500000
              ? [
                  insertActionLogForSellUserItem(
                    ctx.drizzle,
                    ctx,
                    useritem,
                    prices[index] ?? 0,
                  ),
                ]
              : [],
          ),
        ]);
      }
      return {
        success: sold.length > 0,
        message: bulkSellMessage(prices, refused, unconfirmed),
        soldUserItemIds: sold.map((useritem) => useritem.id),
        ryo,
        refused: [...refused, ...unconfirmed],
        ...(unconfirmed.length > 0 ? {} : getBulkSellUserUpdate(ryo)),
      };
    }),
  // Equip or unequip a user item
  toggleEquip: protectedProcedure
    .meta({ mcp: { description: "Toggle item equip status" } })
    .input(z.object({ userItemId: z.string(), slot: z.enum(ItemSlots).optional() }))
    .output(
      baseServerResponse.extend({
        // Omission keeps clients on authoritative reads when no projection is supplied.
        equipmentChanges: z
          .array(
            z.object({
              id: z.string(),
              equipped: z.enum(ItemSlots),
              beforeEquipped: z.enum(ItemSlots),
            }),
          )
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [useritems, user, loadouts] = await Promise.all([
        fetchUserItems(ctx.drizzle, ctx.userId),
        fetchUserEquipmentSnapshot(ctx.drizzle, ctx.userId),
        fetchItemLoadouts(ctx.drizzle, ctx.userId),
      ]);
      if (!user) return errorResponse("User not found");
      // Mutate
      const result = await toggleEquipItem(
        ctx.drizzle,
        input.userItemId,
        useritems,
        user,
        input.slot,
      );
      // If anything happened
      if (result.success && "write" in result) {
        const saved = await retryOnDeadlock(async () => result.write);
        if (saved.rowsAffected !== result.expectedRowsAffected)
          return errorResponse(HUNTING_INVENTORY_UNAVAILABLE_MESSAGE);
        // Save only committed equipment. A hunt starting afterward must not leave
        // its template stale; this write cannot alter the encounter's equipment.
        if (user.itemLoadout) {
          const currentLoadout = loadouts.find((l) => l.id === user.itemLoadout);
          if (currentLoadout) {
            const newItemData = buildItemLoadoutData(result.newUserItems);
            await retryOnDeadlock(async () =>
              updateItemLoadoutForToggleEquip(ctx.drizzle, newItemData, currentLoadout),
            );
          }
        }
        // Return
        return {
          success: true,
          message: result.message,
          equipmentChanges: getInventoryEquipmentChanges(
            useritems,
            result.newUserItems,
          ),
        };
      }
      // Else return the result from toggling
      return result;
    }),

  unequipAllItems: protectedProcedure
    .meta({
      mcp: {
        description:
          "Unequip all items on the character and clear the active item loadout",
      },
    })
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx }) => {
      // Equipped rows only (fetchUserItems omits hidden items).
      const [user, loadouts] = await Promise.all([
        fetchUserEquipmentSnapshot(ctx.drizzle, ctx.userId),
        fetchItemLoadouts(ctx.drizzle, ctx.userId),
      ]);
      if (!user) return errorResponse("User not found");
      const equippedItems = user.items.filter((entry) => !entry.isInAuction);

      const currentLoadout = user.itemLoadout
        ? loadouts.find((l) => l.id === user.itemLoadout)
        : undefined;
      const shouldClearLoadout = !!currentLoadout && currentLoadout.itemData.length > 0;

      if (equippedItems.length === 0) {
        if (shouldClearLoadout && currentLoadout) {
          await updateItemLoadoutForUnequipAllItems(ctx.drizzle, currentLoadout, ctx);
        }
        return {
          success: true,
          message: shouldClearLoadout ? "Cleared active loadout" : "Nothing equipped",
          ...getUnchangedEquipmentUserUpdate({ user }),
        };
      }

      // The timestamp acknowledges an already-unequipped row, while the hunting
      // guard rejects a stale request after encounter admission.
      const itemUnequipPromises: Promise<{ rowsAffected: number }>[] =
        equippedItems.map((ui) =>
          updateUserItemForUnequipAllItems(ctx.drizzle, ui, ctx),
        );

      // Save committed unequips even if a hunt starts afterward; clearing the
      // template cannot alter the encounter's equipment.
      const loadoutClearPromise =
        shouldClearLoadout && currentLoadout
          ? updateItemLoadoutForUnequipAllItems(ctx.drizzle, currentLoadout, ctx)
          : undefined;

      const outcomes = await Promise.all(
        itemUnequipPromises.map((write) => retryOnDeadlock(async () => write)),
      );
      if (outcomes.some((saved) => saved.rowsAffected !== 1))
        return errorResponse(HUNTING_INVENTORY_UNAVAILABLE_MESSAGE);
      if (loadoutClearPromise)
        outcomes.push(await retryOnDeadlock(async () => loadoutClearPromise));

      return {
        success: true,
        ...getUnequippedUserUpdate({ outcomes, user, equippedItems }),

        message: `Unequipped ${equippedItems.length} item${equippedItems.length === 1 ? "" : "s"}${loadoutClearPromise ? " and cleared active loadout" : ""}`,
      };
    }),

  // Consume item — atomic quantity decrement runs before effects (see handler below).
  consume: protectedProcedure
    .meta({ mcp: { description: "Consume a consumable item" } })
    .input(consumeItemInputSchema)
    .output(
      userDeltaResponseSchema.extend({
        rewards: PostProcessedRewardSchema.nullish(),
        cacheRewards: cacheConsumptionResponseSchema.shape.cacheRewards.optional(),
        petRewards: cacheConsumptionResponseSchema.shape.petRewards,
        inventoryChanges: z.array(inventoryQuantityChangeSchema).optional(),
        bloodlineRollsChanged: z.boolean().optional(),
        raidBuffsChanged: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const receiptId = input.requestId
        ? cacheReceiptId(ctx.userId, input.requestId)
        : undefined;
      // Query
      const [
        updatedUser,
        useritem,
        allBloodlines,
        previousRolls,
        previousSageRolls,
        allSageModes,
        userSkills,
        previousOpening,
      ] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
          forceRegen: true,
        }),
        fetchUserItem(ctx.drizzle, ctx.userId, input.userItemId),
        fetchBloodlines(ctx.drizzle),
        fetchItemBloodlineRolls(ctx.drizzle, ctx.userId),
        fetchSageModeRolls(ctx.drizzle, ctx.userId),
        fetchSageModes(ctx.drizzle),
        fetchUserSkills(ctx.drizzle, ctx.userId),
        receiptId ? findActionLogById(ctx.drizzle, receiptId) : undefined,
      ]);
      if (previousOpening)
        return readCacheReceipt(previousOpening.changes, input.userItemId);
      const { user: initialUser } = updatedUser;
      if (!initialUser) return errorResponse("User not found");
      const readiness = prepareActionReadiness(initialUser, updatedUser.settings);
      if (readiness.error) return errorResponse(readiness.error);
      const user = readiness.user;

      // Guard
      if (!useritem) return errorResponse("User item not found");
      if (useritem.item.itemType === "MEAL") {
        const result = await consumeMeal({
          client: ctx.drizzle,
          user,
          owned: useritem,
          expectedQuantity: input.expectedQuantity,
          readiness,
        });
        if (!("userPatch" in result)) return result;
        const { userPatch, ...response } = result;
        if (updatedUser.requiresProgressionRefresh !== false)
          return actionReadinessResponse(response, readiness, ctx.drizzle);
        const progression = getUserProgressionUpdate(
          user,
          updatedUser.publishedAchievementIds,
        );
        return actionReadinessResponse(
          {
            ...response,
            ...progression,
            ...getConsumedMealUserUpdate({
              progressionUserPatch: progression.userPatch,
              userPatch,
            }),
          },
          readiness,
          ctx.drizzle,
        );
      }
      if (useritem.isInAuction) {
        return errorResponse("Cannot consume an item listed in an auction");
      }

      if (useritem.craftingFinishedAt && useritem.craftingFinishedAt > new Date()) {
        return errorResponse("Cannot consume item that is being crafted");
      }
      if (!hasRequiredSkill(useritem.item, { userSkills })) {
        return errorResponse("Activate the required skill to consume this item");
      }
      if (!nonCombatConsume(useritem.item, user)) {
        return errorResponse("Not consumable");
      }

      // Reject malformed persisted grants before the atomic claim can consume the item.
      let jutsuSlotIncrease = 0;
      for (const effect of useritem.item.effects) {
        if (effect.type !== "increasejutsuslots") continue;
        const parsed = IncreaseJutsuSlots.safeParse(effect);
        if (
          !parsed.success ||
          !useritem.item.preventBattleUsage ||
          !useritem.item.destroyOnUse ||
          useritem.item.target !== "SELF" ||
          useritem.item.method !== "SINGLE"
        )
          return errorResponse(
            "This item has an invalid jutsu slot grant. Please contact staff.",
          );
        jutsuSlotIncrease += parsed.data.power;
      }
      if (jutsuSlotIncrease > 0) {
        const slotError = getJutsuSlotIncreaseError(
          user.extraJutsuSlots,
          jutsuSlotIncrease,
        );
        if (slotError) return errorResponse(slotError);
      }

      const questEffects = useritem.item.effects.filter(
        (effect) => effect.type === "noncombatquest",
      );
      const questEffect = questEffects[0];
      if (
        questEffects.length > 1 ||
        (questEffect &&
          (!NonCombatQuestTag.safeParse(questEffect).success ||
            !useritem.item.preventBattleUsage ||
            useritem.item.target !== "SELF" ||
            useritem.item.method !== "SINGLE"))
      )
        return errorResponse(
          "This item has an invalid quest grant. Please contact staff.",
        );
      if (questEffect && !receiptId)
        return errorResponse("Please reload before starting this Special quest.");
      // Only quest items need this content/history preload. Reject active attempts before
      // debiting inventory or applying any of the item's other effects.
      const [grantedQuest, previousQuestAttempt] = questEffect
        ? await Promise.all([
            fetchQuest(ctx.drizzle, questEffect.questId),
            fetchUserQuestByQuestId(ctx.drizzle, ctx.userId, questEffect.questId),
          ])
        : [undefined, undefined];
      if (questEffect && grantedQuest?.questType !== "special")
        return errorResponse(
          "This item must grant an existing Special quest. Please contact staff.",
        );
      if (
        grantedQuest &&
        previousQuestAttempt?.completed === 0 &&
        !previousQuestAttempt.endAt
      )
        return errorResponse(
          `You are already on this quest: ${grantedQuest.name}. Complete it before using this item again.`,
        );
      // Assignment failures must escape the receipt callback to roll back the debit,
      // then become a normal user-facing rejection after the transaction ends.
      const questRejected = new Error("Item quest grant rejected");
      let questRejectionMessage = "The quest could not be started. Please try again.";

      if (
        useritem.item.effects.some(
          (effect) =>
            effect.type === "noncombatconsumereward" &&
            effect.rewardMode !== undefined &&
            effect.rewardMode !== "standard" &&
            effect.rewardMode !== "weightedCache",
        )
      )
        return errorResponse(
          "This item has an unsupported reward mode. Please contact staff.",
        );
      if (
        useritem.item.effects.some(
          (effect) =>
            effect.type === "noncombatconsumereward" &&
            (!NonCombatConsumeRewardTag.shape.reward_pets.safeParse(effect.reward_pets)
              .success ||
              (effect.rewardMode === "weightedCache" &&
                (effect.reward_pets?.length ?? 0) > 0)),
        )
      )
        return errorResponse(
          "This item has an invalid companion reward. Please contact staff.",
        );
      const petRewardIds = rewardPetSpeciesIds(useritem.item.effects);
      if (
        petRewardIds.length > PET_MAX_CONSUME_PETS ||
        (petRewardIds.length > 0 && !useritem.item.preventBattleUsage)
      )
        return errorResponse(
          "This item has an invalid companion reward. Please contact staff.",
        );
      if (petRewardIds.length > 0 && !receiptId)
        return errorResponse("Please reload before claiming this companion.");
      let petReward: UserPetInsert | null = null;
      let petCapacity = 0;
      let rewardSpeciesUpdatedAt: Date | undefined;
      if (petRewardIds.length > 0) {
        if (user.isBanned || user.isAi || getMaxPetRank(user.rank) < 1)
          return errorResponse(
            "Only eligible player characters can receive a companion.",
          );
        // The item determines whether this catalog and collection preload is needed.
        const [species, pets, petJutsus] = await Promise.all([
          fetchRewardPetSpecies(ctx.drizzle, useritem.item.effects),
          listUserPetForConsume(ctx.drizzle, ctx),
          listVisiblePetJutsu(ctx.drizzle),
        ]);
        // Authored rewards may grant species excluded from daily sanctuary offers.
        const selected = species.find((entry) => entry.id === petRewardIds[0]);
        if (!selected)
          return errorResponse(
            "This companion species is unavailable. Please contact staff.",
          );
        petCapacity = getPetCollectionCapacity(user).slots;
        if (pets.length >= petCapacity)
          return errorResponse(
            "Unlock another collection slot or release a companion before using this item.",
          );
        rewardSpeciesUpdatedAt = selected.updatedAt;
        // Freeze identity, traits and defaults before any transaction/deadlock retry.
        petReward = createPetFromSpecies({
          species: selected,
          user,
          jutsus: petJutsus,
        });
      }
      const caches: WeightedCache[] = [];
      for (const effect of useritem.item.effects.filter(isWeightedCacheEffect)) {
        const parsed = weightedCacheSchema.safeParse(effect.weightedCache);
        if (!parsed.success)
          return errorResponse(
            "This cache has an invalid reward configuration. Please contact staff.",
          );
        caches.push(parsed.data);
      }
      if (caches.length > 0 && !receiptId)
        return errorResponse("Please reload before opening this cache");
      if (
        caches.length > 0 &&
        isRestrictedCacheReward({ effects: useritem.item.effects })
      )
        return errorResponse(CACHE_RESTRICTED_REWARD_MESSAGE);
      const cacheReferences =
        caches.length > 0
          ? await fetchCacheReferencedItems(ctx.drizzle, useritem.item)
          : { items: [], missing: [], restricted: [] };
      if (cacheReferences.missing.length > 0)
        return errorResponse(
          "This cache references unavailable rewards. Please contact staff.",
        );
      if (cacheReferences.restricted.length > 0)
        return errorResponse(CACHE_RESTRICTED_REWARD_MESSAGE);
      if (
        caches.reduce((sum, cache) => sum + maximumCacheItems(cache), 0) >
        CACHE_MAX_GRANTED_ITEMS
      )
        return errorResponse(
          "This cache exceeds the reward limit. Please contact staff.",
        );
      const cacheResults = caches.map((cache) => resolveWeightedCache(cache));
      const cacheRewards: CacheRewardDisplay[] = caches.map((cache, index) => ({
        displayName: cache.displayName,
        items: (cacheResults[index]?.items ?? []).map((reward) => ({
          name:
            cacheReferences.items.find((item) => item.id === reward.itemId)?.name ??
            reward.itemId,
          chance: cacheItemChance(cache, reward.itemId),
        })),
      }));

      // Reject an empty pool before consuming any quantity; the rolls below draw from these.
      const bloodlinePools = new Map(
        useritem.item.effects
          .filter((effect) => effect.type === "rollbloodline")
          .map(({ rank }) => [
            rank,
            filterRollableBloodlines({
              bloodlines: allBloodlines,
              user,
              previousRolls,
              rank,
            }),
          ]),
      );
      if ([...bloodlinePools.values()].some((pool) => pool.length === 0)) {
        return errorResponse("No bloodline is available to roll");
      }

      const canRollSageMode =
        !user.sageModeId &&
        useritem.item.effects.some((e) => e.type === "rollsagemode");
      const sageModePool = canRollSageMode
        ? filterRollableSageModes({
            sageModes: allSageModes,
            user,
            previousRolls: previousSageRolls,
          })
        : [];
      if (canRollSageMode && sageModePool.length === 0) {
        return errorResponse("No sage mode is available to roll");
      }

      // Check if item would increase reskin slots beyond max
      const reskinIncreaseEffect = useritem.item.effects.find(
        (e) => e.type === "noncombatincreasereskins",
      );
      if (
        reskinIncreaseEffect &&
        user.extraReskinSlots + reskinIncreaseEffect.power > MAX_EXTRA_RESKIN_SLOTS
      ) {
        return errorResponse(
          `Your reskin slots would exceed the maximum! Current: ${user.extraReskinSlots}, Max: ${MAX_EXTRA_RESKIN_SLOTS}`,
        );
      }

      // Calculations
      const {
        updates,
        messages,
        rewards,
        mutations,
        grantedSageModeId,
        changedBloodlineId,
      } = planConsumeEffects({
        effects: useritem.item.effects,
        user,
        ctx,
        bloodlinePools,
        sageModePool,
        previousRolls,
        userSkills,
      });
      if (petReward)
        messages.unshift(
          `${petReward.name} joined your companion collection. Generate its appearance from your companion profile.`,
        );
      // Parse rewards
      let processedRewards: PostProcessedRewards | null = null;
      if (rewards.length > 0) {
        const collapsedRewards = collapseRewards(rewards);
        processedRewards = postProcessRewards(collapsedRewards, user);
      }
      if (cacheResults.length > 0) {
        processedRewards ??= postProcessRewards(ObjectiveReward.parse({}), user);
        processedRewards.reward_items.push(
          ...cacheResults.flatMap((cache) =>
            cache.items.flatMap((reward) =>
              Array<string>(reward.quantity).fill(reward.itemId),
            ),
          ),
        );
      }
      /**
       * Apply the guarded debit and effects on the supplied client. Transactional
       * grants reuse the receipt owner's session; ordinary items use the root client.
       */
      const commitConsumption = async (
        client: DrizzleClient,
        inTransaction: boolean,
      ) => {
        // Isolate each deadlock attempt from reward boosts and response name resolution.
        const grantedRewards = processedRewards
          ? structuredClone(processedRewards)
          : null;
        // Quest assignment updates trackers; sibling item rewards must persist that same
        // projection rather than overwrite the new quest with the pre-consumption snapshot.
        const consumptionUser = grantedQuest ? structuredClone(user) : user;
        // Claim the account, apply its effects and debit the stack together. A run
        // or battle that wins the account race leaves the item available for retry.
        // Drizzle cannot express this joined UPDATE. Empty stacks are cleaned up
        // after the claim; quantity zero cannot be consumed or used as an entry item.
        // Slot grants increment the live counter and guard capacity in this same atomic statement.
        // A standalone slot grant needs no receipt transaction: the debit and grant share this claim.
        const claim = () =>
          executeUserPetForClaim(
            client,
            user,
            updates,
            jutsuSlotIncrease,
            grantedSageModeId,
            petReward,
            useritem,
            ctx,
            input,
            grantedQuest,
            petCapacity,
            rewardSpeciesUpdatedAt,
            readiness,
          );
        const consumeResult = await (inTransaction ? claim() : retryOnDeadlock(claim));
        if (consumeResult.rowsAffected === 0) {
          return errorResponse(
            jutsuSlotIncrease > 0
              ? `Could not add jutsu slots: the item or account changed, or you reached the maximum of ${MAX_EXTRA_JUTSU_SLOTS} extra jutsu slots. Your item was not consumed. Refresh and try again.`
              : "Item no longer available — please refresh and try again",
          );
        }
        if (grantedQuest) {
          const assigned = await assignQuestToUser({
            client,
            // Deadlock retries must start with the original projection and trackers.
            user: consumptionUser,
            quest: grantedQuest,
            source: "item",
            prevAttempt: previousQuestAttempt,
            inTransaction: true,
          });
          if (!assigned.success) {
            questRejectionMessage = assigned.message;
            throw questRejected;
          }
        }
        // Mutate
        const rewardTask = () =>
          grantedRewards
            ? updateRewards({
                client: client,
                user: consumptionUser,
                rewards: grantedRewards,
                reason: "ITEM/CONSUME",
                inTransaction,
              })
            : {
                items: [],
                jutsus: [],
                bloodlines: [],
                badges: [],
                sageModes: [],
                titles: [],
              };
        const tasks = [
          () => (petReward ? insertUserPet(client, petReward) : undefined),
          () =>
            changedBloodlineId !== undefined
              ? updateUserDataForCommitConsumption(client, changedBloodlineId, ctx)
              : undefined,
          () =>
            useritem.quantity === 1
              ? deleteEmptyUserItem(client, input.userItemId, ctx.userId)
              : undefined,
          () =>
            useritem.quantity === 1
              ? deleteUserItemImbuementForSellUserItem(client, input)
              : undefined,
          ...mutations.map((mutate) => () => mutate(client)),
        ];
        const [granted] = await runRewardTasks(inTransaction)([rewardTask, ...tasks]);
        const { items } = granted;
        if (inTransaction) {
          // Catalog deletion after validation must roll back the debit and every partial grant.
          const expected = new Map<string, number>();
          for (const cache of cacheResults)
            for (const reward of cache.items)
              expected.set(
                reward.itemId,
                (expected.get(reward.itemId) ?? 0) + reward.quantity,
              );
          for (const [id, quantity] of expected) {
            const delivered = items
              .filter((item) => item.id === id)
              .reduce((sum, item) => sum + item.quantity, 0);
            if (delivered < quantity)
              throw new Error("Cache reward became unavailable during delivery");
          }
        }
        // Prettify rewards
        if (grantedRewards) {
          nameGrantedRewards(grantedRewards, granted);
          // Consumption receipts list each unit rather than each stack.
          grantedRewards.reward_items = items.flatMap((i) =>
            Array<string>(i.quantity).fill(i.name),
          );
        }
        // A plain consumable changes only the claimed scalar fields and its equipped stack.
        // Grants that select content or reward relations retain profile reconciliation.
        // Return
        return actionReadinessResponse(
          {
            success: true as const,
            message: grantedQuest
              ? `Quest started: ${grantedQuest.name}`
              : `You used ${useritem.item.name}`,
            notifications: messages,
            rewards: grantedRewards,
            cacheRewards,
            bloodlineRollsChanged: useritem.item.effects.some(
              (effect) => effect.type === "rollbloodline",
            ),
            raidBuffsChanged: false,
            ...getConsumedItemUserUpdate({
              user,
              updates,
              useritem,
              jutsuSlotIncrease,
              requiresProgressionRefresh:
                updatedUser.requiresProgressionRefresh !== false,
              hasReward: !!grantedRewards,
              hasPetReward: !!petReward,
              hasQuestReward: !!grantedQuest,
              hasBloodlineChange: changedBloodlineId !== undefined,
              hasSageModeReward: !!grantedSageModeId,
              publishedAchievementIds: updatedUser.publishedAchievementIds,
            }),
            ...(petReward
              ? {
                  petRewards: [
                    {
                      id: petReward.id,
                      speciesId: petReward.speciesId,
                      name: petReward.name,
                    },
                  ],
                }
              : {}),
          },
          readiness,
        );
      };
      // Quest history may need insertion, and entry costs/rewards can touch more rows.
      // These must commit with the scroll debit and replay receipt; one guarded UPDATE
      // cannot cover inserts, so they share the cache/collection receipt transaction.
      if ((caches.length > 0 || petReward || grantedQuest) && receiptId) {
        return await commitCacheConsumption({
          client: ctx.drizzle,
          receiptId,
          userId: ctx.userId,
          userItemId: input.userItemId,
          itemId: useritem.item.id,
          selections: petReward
            ? { caches: cacheResults, pet: petReward }
            : cacheResults,
          relatedMsg: grantedQuest
            ? "SpecialQuestConsumption"
            : petReward
              ? "CompanionRewardConsumption"
              : "WeightedCacheOpening",
          onCommitted: (response) => {
            // Reward receipts reconcile the profile; retain replayable feedback without stale recovery snapshots.
            actionReadinessResponse(response, readiness, ctx.drizzle);
            return response;
          },
          consume: async (tx) => {
            const response = await commitConsumption(tx, true);
            return response.success
              ? cacheConsumptionResponseSchema.parse(response)
              : response;
          },
        }).catch((error: unknown) => {
          if (error === questRejected) return errorResponse(questRejectionMessage);
          throw error;
        });
      }
      // Ordinary consumables use the guarded claim and parallel mutation path.
      const response = await commitConsumption(ctx.drizzle, false);
      return response.success
        ? actionReadinessResponse(response, readiness, ctx.drizzle)
        : response;
    }),
  // Repair user item
  repair: protectedProcedure
    .meta({ mcp: { description: "Repair an item with ryo" } })
    .input(z.object({ userItemId: z.string() }))
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [initialUser, useritem, settings] = await Promise.all([
        fetchActionUser(ctx.drizzle, ctx.userId),
        fetchUserItem(ctx.drizzle, ctx.userId, input.userItemId),
        fetchAllGameSettings(ctx.drizzle),
      ]);
      const readiness = prepareActionReadiness(initialUser, settings);
      if (readiness.error) return errorResponse(readiness.error);
      const user = readiness.user;
      // Guard
      if (!useritem) return errorResponse("User item not found");
      if (user.occupation !== "CRAFTING") {
        return errorResponse("You must have the Crafting occupation to repair items");
      }

      if (useritem.durability >= useritem.item.maxDurability) {
        return errorResponse("Item is already at full durability");
      }
      if (useritem.storedAtHome) {
        return errorResponse("Fetch at home first");
      }
      if (useritem.isInAuction) {
        return errorResponse("Cannot repair items that are in auction");
      }
      if (!needsInventoryRepair(useritem)) {
        return errorResponse("This item cannot be repaired");
      }
      // Calculate repair cost
      const repairCost = calcItemRepairCost(useritem);
      if (user.money < repairCost) {
        return errorResponse(`Insufficient funds. Repair costs ${repairCost} ryo`);
      }
      // Mutate - update money with conditional guard to prevent race conditions
      const moneyUpdateResult = await debitUserMoney(
        ctx.drizzle,
        repairCost,
        ctx,
        readiness,
      );
      if (moneyUpdateResult.rowsAffected !== 1) {
        return errorResponse("Insufficient funds for this repair");
      }
      // CAS durability write — refund if item left inventory / changed concurrently
      const repaired = await tryRepairUserItemDurability(
        ctx.drizzle,
        ctx.userId,
        useritem,
        useritem.item.maxDurability,
      );
      if (!repaired) {
        await refundUserMoney(ctx.drizzle, ctx.userId, repairCost);
        return actionReadinessResponse(
          errorResponse(
            "Could not repair item — it may have been stored, auctioned, or already repaired",
          ),
          readiness,
          ctx.drizzle,
        );
      }
      return actionReadinessResponse(
        {
          success: true,
          ...getRepairedEquipmentUpdate(
            user,
            [{ before: useritem, durability: useritem.item.maxDurability }],
            repairCost,
          ),
          message: `Repaired ${useritem.item.name} for ${repairCost} ryo`,
        },
        readiness,
        ctx.drizzle,
      );
    }),
  // Repair all user items
  repairAll: protectedProcedure
    .meta({ mcp: { description: "Repair all items with ryo" } })
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx }) => {
      // Query
      const [initialUser, useritems, settings] = await Promise.all([
        fetchActionUser(ctx.drizzle, ctx.userId),
        fetchUserItems(ctx.drizzle, ctx.userId),
        fetchAllGameSettings(ctx.drizzle),
      ]);
      const readiness = prepareActionReadiness(initialUser, settings);
      if (readiness.error) return errorResponse(readiness.error);
      const user = readiness.user;
      // Guard
      if (user.occupation !== "CRAFTING") {
        return errorResponse("You must have the Crafting occupation to repair items");
      }

      // Filter items that need repair (carried inventory only — not home/auction)
      const { itemsNeedingRepair, totalCost: totalRepairCost } =
        calcRepairAllCost(useritems);
      if (itemsNeedingRepair.length === 0) {
        return errorResponse("No items need repair");
      }
      if (user.money < totalRepairCost) {
        return errorResponse(
          `Insufficient funds. Total repair cost is ${totalRepairCost} ryo, but you only have ${user.money} ryo`,
        );
      }
      // Mutate - repair all items and update money
      // Update money with conditional guard to prevent race conditions
      const moneyUpdateResult = await debitUserMoney(
        ctx.drizzle,
        totalRepairCost,
        ctx,
        readiness,
      );
      if (moneyUpdateResult.rowsAffected !== 1) {
        return errorResponse("Insufficient funds for this repair");
      }
      // CAS each durability write; refund cost for any item that left inventory
      const repairOutcomes = await Promise.all(
        itemsNeedingRepair.map(async (useritem) => {
          const repaired = await tryRepairUserItemDurability(
            ctx.drizzle,
            ctx.userId,
            useritem,
            useritem.item.maxDurability,
          );
          return { useritem, repaired, cost: calcItemRepairCost(useritem) };
        }),
      );
      const succeeded = repairOutcomes.filter((o) => o.repaired);
      const failed = repairOutcomes.filter((o) => !o.repaired);
      const refundAmount = failed.reduce((sum, o) => sum + o.cost, 0);
      if (refundAmount > 0) {
        await refundUserMoney(ctx.drizzle, ctx.userId, refundAmount);
      }
      if (succeeded.length === 0) {
        return actionReadinessResponse(
          errorResponse(
            "Could not repair items — they may have been stored, auctioned, or already repaired",
          ),
          readiness,
          ctx.drizzle,
        );
      }
      const charged = totalRepairCost - refundAmount;
      if (failed.length > 0) {
        // A failed target may have left cached gear; its unknown equipment state needs reconciliation with the net charge.
        return actionReadinessResponse(
          {
            success: true,
            message: `Repaired ${succeeded.length} item${succeeded.length !== 1 ? "s" : ""} for ${charged.toLocaleString()} ryo (${failed.length} skipped — stored, auctioned, or changed)`,
          },
          readiness,
          ctx.drizzle,
        );
      }
      return actionReadinessResponse(
        {
          success: true,
          ...getRepairedEquipmentUpdate(
            user,
            succeeded.map(({ useritem }) => ({
              before: useritem,
              durability: useritem.item.maxDurability,
            })),
            charged,
          ),
          message: `Repaired ${succeeded.length} item${succeeded.length !== 1 ? "s" : ""} for ${charged.toLocaleString()} ryo`,
        },
        readiness,
        ctx.drizzle,
      );
    }),
  // Use repair item on another item
  useRepairItem: protectedProcedure
    .meta({ mcp: { description: "Use repair kit on an item" } })
    .input(z.object({ repairItemId: z.string(), targetItemId: z.string() }))
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [initialUser, repairUserItem, targetUserItem, settings] = await Promise.all(
        [
          fetchActionUser(ctx.drizzle, ctx.userId),
          fetchUserItem(ctx.drizzle, ctx.userId, input.repairItemId),
          fetchUserItem(ctx.drizzle, ctx.userId, input.targetItemId),
          fetchAllGameSettings(ctx.drizzle),
        ],
      );
      const readiness = prepareActionReadiness(initialUser, settings);
      if (readiness.error) return errorResponse(readiness.error);
      const user = readiness.user;
      // Guard
      if (!repairUserItem) return errorResponse("Repair item not found");
      if (!hasRequiredSkill(repairUserItem.item, user))
        return errorResponse("Activate the required skill to use this repair item");
      if (!targetUserItem) return errorResponse("Target item not found");

      if (repairUserItem.storedAtHome) {
        return errorResponse("Fetch the repair item from home storage first");
      }
      if (repairUserItem.isInAuction) {
        return errorResponse("Cannot use a repair item listed in an auction");
      }
      if (
        repairUserItem.craftingFinishedAt &&
        repairUserItem.craftingFinishedAt > new Date()
      ) {
        return errorResponse("Cannot use repair item that is being crafted");
      }
      if (repairUserItem.item.itemType === "FURNITURE") {
        return errorResponse("This item cannot be used as a repair kit");
      }
      if (targetUserItem.durability >= targetUserItem.item.maxDurability) {
        return errorResponse("Item is already at full durability");
      }
      if (targetUserItem.storedAtHome) {
        return errorResponse("Fetch at home first");
      }
      if (targetUserItem.isInAuction) {
        return errorResponse("Cannot repair items that are in auction");
      }
      if (!needsInventoryRepair(targetUserItem)) {
        return errorResponse("This item cannot be repaired");
      }
      // Check if repair item has repair tag
      const repairEffect = repairUserItem.item.effects.find((e) => e.type === "repair");
      if (!repairEffect) {
        return errorResponse("This item does not have a repair effect");
      }
      // Calculate repair amount
      const repairAmount = Math.floor(repairEffect.power || 0);
      if (repairAmount <= 0) {
        return errorResponse("Repair item has invalid power");
      }
      // Calculate new durability
      const newDurability = Math.min(
        targetUserItem.durability + repairAmount,
        targetUserItem.item.maxDurability,
      );
      const actualRepair = newDurability - targetUserItem.durability;
      // CAS target durability first — never consume a kit if the write fails
      const [repaired, recovery] = await Promise.all([
        tryRepairUserItemDurability(
          ctx.drizzle,
          ctx.userId,
          targetUserItem,
          newDurability,
        ),
        updateUserForActionReadiness(ctx.drizzle, readiness),
      ]);
      if (!recovery.rowsAffected) {
        if (repaired)
          await restoreUserItemDurability(
            ctx.drizzle,
            targetUserItem.durability,
            targetUserItem.id,
            ctx.userId,
            newDurability,
          );
        return errorResponse("Your status changed. Please try again.");
      }
      if (!repaired) {
        return actionReadinessResponse(
          errorResponse(
            "Could not repair item — it may have been stored, auctioned, or already repaired",
          ),
          readiness,
          ctx.drizzle,
        );
      }
      // Consume repair item if it's consumable
      if (repairUserItem.item.destroyOnUse) {
        const consumed = await retryOnDeadlock(() =>
          consumeUserItemAtomically({
            client: ctx.drizzle,
            userId: ctx.userId,
            userItemId: input.repairItemId,
            expectedQuantity: repairUserItem.quantity,
            where: [
              eq(userItem.equipped, repairUserItem.equipped),
              eq(userItem.level, repairUserItem.level),
              eq(userItem.experience, repairUserItem.experience),
              eq(
                userItem.durability,
                repairUserItem.id === targetUserItem.id
                  ? newDurability
                  : repairUserItem.durability,
              ),
              eq(userItem.storedAtHome, false),
              eq(userItem.isInAuction, false),
            ],
          }),
        );
        if (!consumed) {
          // Restore live durability after a lost kit claim. Admission may already
          // hold the repaired snapshot, so settlement can retain the player's
          // repaired durability; the guarded kit quantity remains available.
          await restoreUserItemDurability(
            ctx.drizzle,
            targetUserItem.durability,
            input.targetItemId,
            ctx.userId,
            newDurability,
          );
          return actionReadinessResponse(
            errorResponse(
              "Could not consume repair kit — inventory changed, please try again",
            ),
            readiness,
            ctx.drizzle,
          );
        }
      }
      return actionReadinessResponse(
        {
          success: true,
          ...getRepairedEquipmentUpdate(user, [
            { before: targetUserItem, durability: newDurability },
            ...(repairUserItem.item.destroyOnUse
              ? [{ before: repairUserItem, quantity: repairUserItem.quantity - 1 }]
              : []),
          ]),
          message: `Repaired ${targetUserItem.item.name} by ${actualRepair} durability using ${repairUserItem.item.name}`,
        },
        readiness,
        ctx.drizzle,
      );
    }),
  // Use repair items to repair all items
  useRepairAll: protectedProcedure
    .meta({ mcp: { description: "Use repair kits to fix all items" } })
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx }) => {
      // Query
      const [initialUser, useritems, settings] = await Promise.all([
        fetchActionUser(ctx.drizzle, ctx.userId),
        fetchUserItems(ctx.drizzle, ctx.userId),
        fetchAllGameSettings(ctx.drizzle),
      ]);
      const readiness = prepareActionReadiness(initialUser, settings);
      if (readiness.error) return errorResponse(readiness.error);
      const user = readiness.user;
      // Guard

      // Filter items that need repair (carried inventory only — not home/auction)
      const itemsNeedingRepair = useritems.filter(needsInventoryRepair);
      if (itemsNeedingRepair.length === 0) {
        return errorResponse("No items need repair");
      }
      // Shared kit selection with the inventory preview (lowest power first)
      const repairKits = getRepairKits(useritems, user);
      if (repairKits.length === 0) {
        return errorResponse("You don't have any repair items in your inventory");
      }
      const { kitsToUse, totalDurabilityNeeded, canRepairAll } = calculateKitsToUse(
        itemsNeedingRepair,
        repairKits,
      );
      if (!canRepairAll) {
        const coveredDurability = kitsToUse.reduce((sum, kit) => {
          const power =
            repairKits.find((k) => k.userItem.id === kit.repairItemId)?.repairAmount ??
            0;
          return sum + kit.quantityUsed * power;
        }, 0);
        return errorResponse(
          `Insufficient repair kits. Need ${totalDurabilityNeeded} durability total, but only have enough for ${coveredDurability} durability`,
        );
      }

      const kitsUsedSummary = kitsToUse
        .map((kit) => `${kit.quantityUsed}x ${kit.repairItemName}`)
        .join(", ");

      // Apply repairs with CAS; roll back and abort if any target left inventory
      const [repairOutcomes, recovery] = await Promise.all([
        Promise.all(
          itemsNeedingRepair.map(async (useritem) => {
            const repaired = await tryRepairUserItemDurability(
              ctx.drizzle,
              ctx.userId,
              useritem,
              useritem.item.maxDurability,
            );
            return { useritem, repaired };
          }),
        ),
        updateUserForActionReadiness(ctx.drizzle, readiness),
      ]);
      const confirmedReadiness = recovery.rowsAffected > 0 ? readiness : undefined;
      const failedRepairs = repairOutcomes.filter((o) => !o.repaired);
      // A hunt may have captured a completed target write before compensation.
      // Its snapshot can retain the player's repaired durability; kit claims stay guarded.
      if (!recovery.rowsAffected || failedRepairs.length > 0) {
        await Promise.all(
          repairOutcomes
            .filter((o) => o.repaired)
            .map((o) =>
              restoreUserItemDurability(
                ctx.drizzle,
                o.useritem.durability,
                o.useritem.id,
                ctx.userId,
                o.useritem.item.maxDurability,
              ),
            ),
        );
        return actionReadinessResponse(
          errorResponse(
            "Could not repair all items — one or more were stored, auctioned, or changed. No kits were consumed.",
          ),
          confirmedReadiness,
          ctx.drizzle,
        );
      }

      // Consume repair kits only after every target write succeeded. calculateKitsToUse clamps
      // quantityUsed to the stack quantity, so the helper's delete-at-zero branch covers the
      // full-stack case.
      const kitConsumeResults = await Promise.all(
        kitsToUse.map(async ({ repairItemId, quantityUsed }) => {
          const repairKitRow = useritems.find((ui) => ui.id === repairItemId);
          if (!repairKitRow?.item.destroyOnUse) {
            return null;
          }
          const consumed = await retryOnDeadlock(() =>
            updateUserItemQuantityAtomically({
              client: ctx.drizzle,
              userId: ctx.userId,
              userItemId: repairItemId,
              expectedQuantity: repairKitRow.quantity,
              nextQuantity: repairKitRow.quantity - quantityUsed,
              where: [
                eq(userItem.equipped, repairKitRow.equipped),
                eq(userItem.level, repairKitRow.level),
                eq(userItem.experience, repairKitRow.experience),
                eq(
                  userItem.durability,
                  itemsNeedingRepair.some((row) => row.id === repairKitRow.id)
                    ? repairKitRow.item.maxDurability
                    : repairKitRow.durability,
                ),
                eq(userItem.storedAtHome, false),
                eq(userItem.isInAuction, false),
              ],
            }),
          );
          return consumed ? { repairKitRow, quantityConsumed: quantityUsed } : false;
        }),
      );
      if (kitConsumeResults.some((result) => result === false)) {
        await Promise.all([
          ...itemsNeedingRepair.map((useritem) =>
            restoreUserItemDurability(
              ctx.drizzle,
              useritem.durability,
              useritem.id,
              ctx.userId,
              useritem.item.maxDurability,
            ),
          ),
          ...kitConsumeResults.flatMap((result) =>
            result
              ? [
                  refundUserItemQuantityAtomically({
                    client: ctx.drizzle,
                    // Admission may have captured the decremented stack. Refund separately
                    // so settlement cannot overwrite it or recreate an occupied equipped slot.
                    itemSnapshot: {
                      ...result.repairKitRow,
                      id: nanoid(),
                      equipped: "NONE",
                      createdAt: new Date(),
                      updatedAt: new Date(),
                    },
                    quantity: result.quantityConsumed,
                  }),
                ]
              : [],
          ),
        ]);
        return actionReadinessResponse(
          errorResponse(
            "Could not consume repair kits — inventory changed, please try again",
          ),
          confirmedReadiness,
          ctx.drizzle,
        );
      }

      return actionReadinessResponse(
        {
          success: true,
          ...getRepairedEquipmentUpdate(user, [
            ...itemsNeedingRepair.map((row) => ({
              before: row,
              durability: row.item.maxDurability,
            })),
            ...kitConsumeResults.flatMap((result) =>
              result
                ? [
                    {
                      before: result.repairKitRow,
                      quantity: result.repairKitRow.quantity - result.quantityConsumed,
                    },
                  ]
                : [],
            ),
          ]),
          message: `Repaired ${itemsNeedingRepair.length} item${itemsNeedingRepair.length !== 1 ? "s" : ""} using ${kitsUsedSummary}`,
        },
        confirmedReadiness,
        ctx.drizzle,
      );
    }),
  // Authenticated and uncached: allowance changes after purchases and UTC resets.
  getPurchaseAllowance: protectedProcedure
    .input(idSchema)
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const [info, counters] = await Promise.all([
        fetchItem(ctx.drizzle, input.id),
        fetchPurchaseCounters(ctx.drizzle, ctx.userId, input.id, now),
      ]);
      if (!info) return null;
      return getItemPurchaseAllowance(info, counters, now);
    }),
  buy: protectedProcedure
    .meta({ mcp: { description: "Buy an item from shop" } })
    .input(itemBuySchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Query
      const iid = input.itemId;
      const uid = ctx.userId;
      const purchaseTime = new Date();
      // Read userData before inventory so the transactional updatedAt CAS below
      // detects any capacity mutation that commits between these snapshots.
      const user = await fetchUserEquipmentSnapshot(ctx.drizzle, ctx.userId);
      if (!user) return errorResponse("User not found");
      const [info, useritems, structures, questState, purchaseCounters] =
        await Promise.all([
          fetchItem(ctx.drizzle, iid),
          fetchUserItems(ctx.drizzle, uid),
          fetchStructures(ctx.drizzle, input.villageId),
          fetchQuestTrackerState(ctx.drizzle, ctx.userId),
          fetchPurchaseCounters(ctx.drizzle, uid, iid, purchaseTime),
        ]);
      // Guard
      if (user.villageId !== input.villageId) return errorResponse("Wrong village");
      if (!info) return errorResponse("Item not found");
      const factor = shopItemDiscountFactor(getShopDiscounts(user, structures, info));
      const allowance = getItemPurchaseAllowance(info, purchaseCounters, purchaseTime);
      if (allowance.remaining != null && input.stack > allowance.remaining) {
        return errorResponse(itemPurchaseLimitMessage(allowance));
      }
      if (input.stack > 1 && !info.canStack) return errorResponse("Item cannot stack");
      if (input.stack > 1 && input.stack > info.stackSize)
        return errorResponse("You can not buy a stack with this many items");
      if (!info.inShop) return errorResponse("Item is not for sale");
      if (isEvolution(info.parentItemId))
        return errorResponse("Evolution items cannot be bought; they must be evolved");
      // Farm produce is priced in farm coins, so buying it for ryo here would let a
      // player mint farm currency from the ryo economy (buy cheap, sell at the farm).
      if (info.isFarmSeed || info.farmSellValue > 0) {
        return errorResponse("Farm items are traded at the farm, not the item shop");
      }
      if (user.isBanned) return errorResponse("You are banned");
      if (info.hidden && !canChangeContent(user.role)) {
        return errorResponse("Item is hidden, cannot be bought");
      }
      const isFurniture = info.itemType === "FURNITURE";
      if (isFurniture) {
        const homeBucket = getHomeStorageBucket(info);
        const storedCount = useritems.filter(
          (owned) =>
            owned.storedAtHome && getHomeStorageBucket(owned.item) === homeBucket,
        ).length;
        if (
          storedCount >=
          getHomeStorageBucketCapacity(
            homeBucket,
            HomeTypeDetails[user.homeType].storage,
          )
        ) {
          return errorResponse(getHomeStorageBucketFullMessage(homeBucket));
        }
      }
      if (!isItemAvailableInStore(info.expireFromStoreAt)) {
        return errorResponse("Item has expired");
      }
      const { ryoCost, repsCost, seichiSilverCost } = getShopStackPrice(
        info,
        input.stack,
        factor,
      );
      // Figure out if we equip this
      let equipped: ItemSlot = "NONE";
      const instancesEquipped = useritems.filter(
        (ui) => ui.itemId === info.id && ui.equipped !== "NONE",
      ).length;
      const canAutoEquip =
        !info.effects.find((e) => e.type.includes("bloodline")) &&
        hasRequiredSkill(info, user) &&
        instancesEquipped < info.maxEquips &&
        user.level >= info.requiredLevel &&
        (!info.bloodlineId || info.bloodlineId === user.bloodlineId) &&
        !missingMasteryRequirement(effectiveMasteries(user), info) &&
        canEquipAdditional(
          info,
          useritems
            .filter((ui) => ui.equipped !== "NONE")
            .map((ui) => ({
              slot: ui.equipped,
              itemType: ui.item.itemType,
              bloodlineId: ui.item.bloodlineId,
            })),
        ) === null;

      if (canAutoEquip) {
        equipped = findFreeEquipSlot(info.slot, useritems) ?? "NONE";
      }
      // Resolve auto-equip first: a purchase placed directly into an equipment
      // slot can succeed even when the backpack is full.
      if (!isFurniture && equipped === "NONE") {
        const purchaseBucket = getInventoryBucket(info);
        const bucketCount = useritems.filter(
          (ui) =>
            countsTowardInventoryStorage(ui) &&
            getInventoryBucket(ui.item) === purchaseBucket,
        ).length;
        if (bucketCount >= getInventoryBucketCapacity(purchaseBucket, user)) {
          return errorResponse(getInventoryBucketFullMessage(purchaseBucket));
        }
      }
      // buy_item quest tracker (NPC item shop purchases; auction buyouts do not advance it).
      // questData and userQuests/completedQuests come from the single
      // fetchQuestTrackerState read above, so the tracker read is internally consistent.
      // If that fetch failed (null), skip tracking entirely: writing an empty questData
      // would wipe the user's existing quest progress.
      // Only touch questData when the purchase can actually advance a buy_item
      // objective for this item: buy_item is content-gated (unlike the always-on
      // counters in craft/train), so any other purchase would re-serialize an
      // unchanged snapshot — and since this read-modify-write has no CAS on
      // questData, that write could clobber a concurrent tracker update for no
      // benefit. Objectives already marked done are skipped for the same reason:
      // completed achievements stay in fetchQuestTrackerState's result forever, so
      // without the done-check every later matching purchase would re-open the
      // redundant-write window. When it does advance, the full-snapshot write
      // accepts that window.
      const advancesBuyItemObjective = questState?.userQuests.some((uq) =>
        uq.quest?.content?.objectives?.some((o) => {
          if (o.task !== "buy_item" || !objectiveContentIds(o).includes(iid)) {
            return false;
          }
          const goal = questState?.questData
            ?.find((tracker) => tracker.id === uq.questId)
            ?.goals.find((g) => g.id === o.id);
          return !goal?.done;
        }),
      );
      let questDataUpdate: {
        questData?: ReturnType<typeof filterQuestTrackersForDbPersist>;
      } = {};
      if (questState && advancesBuyItemObjective) {
        const buyer = {
          ...user,
          // Keep quest state from one snapshot. Orphaned history IDs let the
          // tracker/persist helpers remove deleted quest trackers.
          questData: questState.questData,
          userQuests: questState.userQuests,
          completedQuests: questState.completedQuests,
        } as unknown as Parameters<typeof getNewTrackers>[0];
        const { trackers } = getNewTrackers(buyer, [
          { task: "buy_item", increment: input.stack, contentId: iid },
        ]);
        questDataUpdate = {
          questData: filterQuestTrackersForDbPersist(trackers, buyer, true),
        };
      }
      // Commit the user-snapshot claim, fund deduction, quest update, and item insert
      // together. The updatedAt CAS serializes the earlier capacity read with other
      // inventory mutations, while the transaction prevents charging without delivery.
      // Persist the same complete row returned to the cache, including timestamps,
      // so an equipped purchase needs no readback of database-generated defaults.
      const purchasedItem: UserItem = {
        id: nanoid(),
        userId: uid,
        itemId: iid,
        createdAt: purchaseTime,
        updatedAt: purchaseTime,
        quantity: input.stack,
        equipped,
        level: 1,
        experience: 0,
        durability: isFurniture ? 0 : DURABILITY_MAX_DEFAULT,
        storedAtHome: isFurniture,
        homeX: null,
        homeY: null,
        homeRotation: 0,
        homeRoom: "main",
        isInAuction: false,
        craftingFinishedAt: null,
        activeVariantId: null,
        dropChancePerc: 0,
      };
      const quotaConflict = new Error("Purchase quota changed");
      const purchaseCommitted = await retryOnDeadlock(() =>
        ctx.drizzle.transaction(async (tx) => {
          const result = await updateUserDataForBuy(
            tx,
            ryoCost,
            repsCost,
            seichiSilverCost,
            user,
            questDataUpdate,
            uid,
          );
          if (result.rowsAffected !== 1) return false;

          if (allowance.periodStart && allowance.limit != null) {
            // A duplicate leaves the existing count intact. The guarded increment below
            // is authoritative even when another purchase read the same allowance.
            await insertItemPurchaseCounterForBuy(tx, uid, iid, {
              period: allowance.period,
              periodStart: allowance.periodStart,
            });
            const claimed = await updateItemPurchaseCounterForBuy(tx, input, uid, iid, {
              period: allowance.period,
              periodStart: allowance.periodStart,
              limit: allowance.limit,
            });
            // Throw to roll back payment, quest progress, and a newly inserted counter.
            if (claimed.rowsAffected !== 1) throw quotaConflict;
          }

          await insertUserItems(tx, [purchasedItem]);
          return true;
        }),
      ).catch((error: unknown) => {
        if (error === quotaConflict) return "QUOTA" as const;
        throw error;
      });
      if (purchaseCommitted !== true && allowance.limit != null) {
        const counters = await fetchPurchaseCounters(
          ctx.drizzle,
          uid,
          iid,
          purchaseTime,
        );
        const currentAllowance = getItemPurchaseAllowance(info, counters, purchaseTime);
        if (
          purchaseCommitted === "QUOTA" ||
          input.stack > (currentAllowance.remaining ?? 0)
        ) {
          return errorResponse(itemPurchaseLimitMessage(currentAllowance));
        }
      }
      if (purchaseCommitted !== true) {
        return {
          success: false,
          message: "Inventory or funds changed, please refresh and try again",
        };
      }
      return {
        success: true,
        message: `You bought ${info.name}`,
        // Quest purchases keep the full refresh so achievement and masked objective state agree.
        ...getBuyUserUpdate({
          advancesBuyItemObjective,
          user,
          ryoCost,
          repsCost,
          seichiSilverCost,
          equipped,
          purchasedItem,
          info,
        }),
      };
    }),
  // Auto-equip optimal items based on cost
  autoEquipOptimal: protectedProcedure
    .meta({ mcp: { description: "Auto-equip best items by cost" } })
    .output(baseServerResponse)
    .mutation(async ({ ctx }) => {
      const [useritems, user] = await Promise.all([
        fetchUserItems(ctx.drizzle, ctx.userId),
        fetchUserEquipmentSnapshot(ctx.drizzle, ctx.userId),
      ]);
      if (!user) return errorResponse("User not found");

      // Slot exclusivity and category / maxEquips limits are decided against one
      // in-memory snapshot. Writes are a single Promise.all so validation is not
      // serialized per item. The same `now` is reused in the write predicates so
      // a row that moves home / auction / crafting / imbue after the snapshot
      // is not equipped.
      const now = new Date();
      const masteries = effectiveMasteries(user);
      const { assignments, hasUnequipped, hasAvailableSlots } =
        computeAutoEquipAssignments(useritems, { ...user, ...masteries }, now);

      if (!hasUnequipped) {
        return errorResponse("No unequipped items available");
      }
      if (!hasAvailableSlots) {
        return errorResponse("No available slots to equip items");
      }

      let nEquipped = 0;
      if (assignments.length > 0) {
        const results = await Promise.all(
          assignments.map((assignment) =>
            updateUserItemForAutoEquipOptimal(ctx.drizzle, assignment, user, now),
          ),
        );
        nEquipped = results.reduce((sum, result) => sum + result.rowsAffected, 0);
      }

      return {
        success: true,
        message: `Equipped ${nEquipped} item${nEquipped === 1 ? "" : "s"}`,
      };
    }),
  getItemLoadouts: protectedProcedure
    .meta({ mcp: { description: "Get user's item loadouts" } })
    .query(async ({ ctx }) => {
      // Query
      const [loadouts, user] = await Promise.all([
        fetchItemLoadouts(ctx.drizzle, ctx.userId),
        fetchLoadoutUser(ctx.drizzle, ctx.userId),
      ]);
      // Backfill any loadouts the user is entitled to but does not yet own. A
      // deterministic id + no-op upsert keeps concurrent reads from inserting
      // duplicates, and one batched insert avoids a round-trip per slot.
      const maxLoadouts = fedItemLoadouts(user);
      const missing = buildMissingLoadouts(
        ctx.userId,
        "item",
        loadouts.length,
        maxLoadouts,
        { itemData: [] as ItemLoadout["itemData"], hotkeys: {} },
        new Date(),
      );
      return backfillLoadouts<ItemLoadout>({
        loadouts,
        missing,
        maxLoadouts,
        currentPointer: user?.itemLoadout ?? null,
        insertMissing: (rows) => insertItemLoadoutForInsertMissing(ctx.drizzle, rows),
        writeDefaultPointer: (id) =>
          // Compare-and-swap: only set the default when no pointer exists yet, so
          // a concurrent select that set it first is not overwritten.
          updateUserDataForWriteDefaultPointer(ctx.drizzle, id, ctx),
      });
    }),
  selectItemLoadout: protectedProcedure
    .meta({ mcp: { description: "Select an item loadout" } })
    .input(idSchema)
    .output(
      userDeltaResponseSchema.extend({
        equipmentChanges: z
          .array(
            z.object({
              id: z.string(),
              equipped: z.enum(ItemSlots),
              beforeEquipped: z.enum(ItemSlots),
            }),
          )
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Query
      let inventoryRecovered = false;
      const [loadouts, user, useritems] = await Promise.all([
        fetchItemLoadouts(ctx.drizzle, ctx.userId),
        fetchUserEquipmentSnapshot(ctx.drizzle, ctx.userId),
        fetchUserItems(ctx.drizzle, ctx.userId, {
          includeHidden: true,
          onStaleMergeClaimRecovery: () => {
            inventoryRecovered = true;
          },
        }),
      ]);
      if (!user) return errorResponse("User not found");
      // Mutate & return result
      const id = input.id;
      const beforeEquipment = useritems.map((row) => ({ ...row }));
      const result = await selectItemLoadout(
        ctx.drizzle,
        id,
        loadouts,
        useritems,
        user,
      );
      return result.success
        ? {
            ...result,
            // Slot changes cannot represent stacks restored by the inventory preload.
            equipmentChanges:
              !inventoryRecovered &&
              result.userCacheEligible &&
              result.inventoryCacheEligible
                ? getLoadoutInventoryChanges(beforeEquipment, useritems)
                : undefined,
            ...getSelectItemLoadoutUserUpdate({
              result,
              user,
              id,
              useritems,
            }),
          }
        : result;
    }),

  setLoadoutHotkeys: protectedProcedure
    .meta({ mcp: { description: "Set the battle hotkeys of a item loadout" } })
    .input(setLoadoutHotkeysSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [loadout, jutsuLoadouts] = await Promise.all([
        findItemLoadoutForRenameLoadout(ctx.drizzle, input, ctx),
        fetchJutsuLoadouts(ctx.drizzle, ctx.userId),
      ]);
      if (!loadout) return errorResponse("Loadout not found");
      const conflict = findLoadoutHotkeyConflict("item", input.hotkeys, jutsuLoadouts);
      if (conflict) {
        return errorResponse(
          `${conflict.key.toUpperCase()} is used in ${conflict.loadoutName}. Change it there first.`,
        );
      }
      // Concurrent edits on this account can leave a reversible binding conflict;
      // resolveHotkeys still gives each key one action without requiring a transaction.
      const result = await updateItemLoadoutForSetLoadoutHotkeys(
        ctx.drizzle,
        input,
        ctx,
      );
      // MySQL reports no affected row when the keys did not change, so confirm
      // ownership before calling an unchanged save a failure.
      if (result.rowsAffected === 0) {
        const exists = await findItemLoadoutForRenameLoadout(ctx.drizzle, input, ctx);
        if (!exists) return errorResponse("Loadout not found");
      }
      return { success: true, message: "Hotkeys saved" };
    }),
  renameLoadout: protectedProcedure
    .meta({ mcp: { description: "Rename an item loadout" } })
    .input(renameLoadoutSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [loadouts, user] = await Promise.all([
        fetchItemLoadouts(ctx.drizzle, ctx.userId),
        fetchLoadoutUser(ctx.drizzle, ctx.userId),
      ]);
      return applyLoadoutRename(
        decideRename(loadouts, fedItemLoadouts(user), input),
        (name) => updateItemLoadoutForRenameLoadout(ctx.drizzle, name, input, ctx),
        () =>
          findItemLoadoutForRenameLoadout(ctx.drizzle, input, ctx).then((row) => !!row),
      );
    }),
});

type EffectWithReputation = Record<string, unknown> & {
  type: string;
  reward_reputation?: number;
};

/**
 * Keep stored `reward_reputation` on incoming effects that match by content, so reordering
 * survives while editors without award permission cannot add or move reputation.
 */
const preserveEffectReputation = (
  existing: Item["effects"],
  incoming: Item["effects"],
) => {
  const existingEffects = existing as EffectWithReputation[];
  const existingReputationEffects = existingEffects.filter(
    (e) => e.type === "noncombatconsumereward" && (e.reward_reputation ?? 0) > 0,
  );

  // Create signature for matching (all properties except reward_reputation)
  const getEffectSignature = (effect: EffectWithReputation): string => {
    const { reward_reputation: _reputation, ...rest } = effect;
    return JSON.stringify(rest, Object.keys(rest).sort());
  };

  // Build lookup map from existing effects' signatures to their reward_reputation
  // Use an array to track multiple identical effects and prevent reputation multiplication
  const signatureToReputations = new Map<string, number[]>();
  for (const effect of existingReputationEffects) {
    const sig = getEffectSignature(effect);
    const reputations = signatureToReputations.get(sig) ?? [];
    reputations.push(effect.reward_reputation ?? 0);
    signatureToReputations.set(sig, reputations);
  }

  // Preserve reputation for matching effects, set to 0 for new/modified effects
  // Each reputation value can only be used once (prevents duplication exploit)
  incoming.forEach((effect) => {
    if (effect.type === "noncombatconsumereward") {
      const typedEffect = effect as EffectWithReputation;
      const sig = getEffectSignature(typedEffect);
      const reputations = signatureToReputations.get(sig);
      // Pop the first available reputation value to prevent reuse
      const existingReputation = reputations?.shift() ?? 0;
      (effect as { reward_reputation?: number }).reward_reputation = existingReputation;
    }
  });
};

/** Pet rewards address authored species, while each delivery creates a new owned individual. */
const rewardPetSpeciesIds = (effects: Item["effects"]) =>
  effects.flatMap((effect) =>
    effect.type === "noncombatconsumereward" ? (effect.reward_pets ?? []) : [],
  );

const fetchRewardPetSpecies = (client: DrizzleClient, effects: Item["effects"]) => {
  const ids = rewardPetSpeciesIds(effects);
  return ids.length > 0
    ? listPetSpeciesForFetchRewardPetSpecies(client, ids)
    : Promise.resolve([]);
};

/**
 * COMMON QUERIES WHICH ARE REUSED
 */

/**
 * @param client - The database client
 * @param loadoutId - The ID of the loadout to select
 * @param loadouts - The loadouts to select from
 * @param useritems - The user items to select from
 * @param user - The user data with the sources of their mastery tags
 * @returns A promise that resolves to the result of the select
 */
export const selectItemLoadout = async (
  client: DrizzleClient,
  loadoutId: string,
  loadouts: ItemLoadout[],
  useritems: UserItemWithRelations[],
  user: Pick<UserData, "userId" | "federalStatus" | "staffAccount"> &
    Omit<MasteryBuffUser, "items">,
) => {
  // Guard: only loadouts within the user's current allowance are selectable, so
  // a downgraded user can't reach an out-of-range loadout by guessing its
  // deterministic id (loadouts are ordered the same way getItemLoadouts slices).
  const selectable = resolveSelectableLoadout(
    loadouts,
    loadoutId,
    fedItemLoadouts(user),
  );
  if (!selectable.ok) return errorResponse(selectable.message);
  const loadout = selectable.loadout;

  // Decide which rows get which slots (pure, fully validated). Reuse this `now`
  // for the SQL availability guards below so the snapshot validation and the
  // atomic update reason about the same instant.
  const now = new Date();
  const { assignments, invalidItems } = computeLoadoutAssignments(
    loadout.itemData,
    useritems,
    user,
    now,
  );

  // Apply atomically: a single statement equips the loadout and unequips
  // everything else, so there is no wipe-then-partial-fail window.
  let equipped: ItemSlot | SQL = "NONE";
  if (assignments.length > 0) {
    const sqlChunks: SQL[] = [sql`(case`];
    for (const a of assignments) {
      // Re-check availability inside the atomic update (mirrors
      // getEquipBlockReason + isImbuing): if a row was moved home/auction/crafting
      // or began imbuing between the snapshot and now, its arm no longer matches
      // and it falls to 'NONE' instead of being equipped while ineligible.
      sqlChunks.push(
        sql`when ${and(eq(userItem.id, a.userItemId), userItemAvailableAt(client, a.userItemId, now))} then ${a.slot}`,
      );
    }
    sqlChunks.push(sql`else 'NONE' end)`);
    equipped = sql.join(sqlChunks, sql` `);
  }
  const equippedRows = await retryOnDeadlock(async () =>
    updateUserItemForSelectItemLoadout(client, equipped, user),
  );
  if (useritems.length > 0 && equippedRows.rowsAffected === 0)
    return errorResponse(HUNTING_INVENTORY_UNAVAILABLE_MESSAGE);

  // The equip above is one atomic statement, so it never half-applies. Advance
  // the active-loadout pointer only AFTER it succeeds (one extra round-trip, not
  // a parallel Promise.all) so the pointer can never race ahead of the equip and
  // point at a loadout that was not actually applied.
  const pointerUpdate = await updateUserDataForSelectItemLoadout(client, loadout, user);

  // The CASE can legitimately drop an assignment to 'NONE' when the row became
  // unavailable (home/auction/crafting/imbue) between the snapshot and the
  // UPDATE. Re-read the committed equipped state for the assigned rows so the
  // in-memory list, the returned items and the warnings reflect what was
  // actually equipped — not merely what we intended to equip.
  const assignmentIds = assignments.map((a) => a.userItemId);
  const committedRows =
    assignmentIds.length > 0
      ? await selectUserItemForSelectItemLoadout(client, user, assignmentIds)
      : [];
  const committedSlot = new Map(
    committedRows
      .filter((r) => r.equipped !== "NONE" && r.quantity > 0)
      .map((r) => [r.id, r.equipped]),
  );
  useritems.forEach((ui) => {
    const committed = committedRows.find((row) => row.id === ui.id);
    if (committed) Object.assign(ui, committed);
    ui.equipped = committedSlot.get(ui.id) ?? "NONE";
  });
  // Surface any intended assignment the guard dropped to 'NONE' so the caller
  // (and combat battle state) does not treat a raced-out row as equipped.
  assignments
    .filter((a) => !committedSlot.has(a.userItemId))
    .forEach((a) => {
      const name = useritems.find((u) => u.id === a.userItemId)?.item.name ?? "Item";
      invalidItems.push(`${name} became unavailable`);
    });

  const message =
    invalidItems.length > 0
      ? `Loadout selected. Warnings: ${invalidItems.join(", ")}`
      : "Loadout selected";

  return {
    success: true,
    message,
    userCacheEligible: pointerUpdate.rowsAffected === 1,
    // Dropped assignments can reflect moved or unavailable rows beyond their equipment slots.
    inventoryCacheEligible: invalidItems.length === 0,
    items: useritems.filter((ui) => committedSlot.has(ui.id)),
  };
};

/**
 * Return AI and quest relations for an item
 */
export const getItemRelations = async (client: DrizzleClient, itemId: string) => {
  const [aiEquippedItem, questsUsingItem] = await Promise.all([
    selectUserItemForGetItemRelations(client, itemId),
    listQuestForGetItemRelations(client, itemId),
  ]);

  return { aiEquippedItem, questsUsingItem };
};
export type ItemRelations = Awaited<ReturnType<typeof getItemRelations>>;

// The user's balance, the CAS guard for an atomic deduct, and the decrement/increment update
// sets for one variant currency.
const getVariantCurrencyOps = (
  costType: VariantCurrency,
  cost: number,
  user: Record<VariantCurrencyField, number>,
) => {
  const field = VARIANT_CURRENCY_FIELD[costType];
  return {
    label: costType === "VILLAGE_PRESTIGE" ? "Prestige" : displayCostType(costType),
    balance: user[field],
    where: gte(userData[field], cost),
    decrementSet: { [field]: sql`${userData[field]} - ${cost}` },
    incrementSet: { [field]: sql`${userData[field]} + ${cost}` },
  };
};

const restoreStaleMergeStackClaims = async (client: DrizzleClient, userId: string) =>
  restoreStaleUserItemMergeClaims({
    client,
    userId,
    staleBefore: new Date(Date.now() - MERGE_STACK_CLAIM_TIMEOUT_MS),
  });

/**
 * Self-heals abandoned stack-merge state on the primary inventory reads: rows are fetched
 * without a quantity filter, and only when a stale claim/tombstone is actually present (a merge
 * died mid-protocol — rare) does the reaper run followed by one refetch. The common case pays no
 * extra round trip, and a crashed merge recovers on the player's next inventory load instead of
 * leaving their stacks invisible until they press merge again.
 */
const withStaleMergeClaimRecovery = async <
  T extends { quantity: number; updatedAt: Date },
>(
  client: DrizzleClient,
  userId: string,
  fetchRows: () => Promise<T[]>,
  canRecover?: () => Promise<boolean>,
  onStaleMergeClaimRecovery?: () => void,
): Promise<T[]> => {
  let rows = await fetchRows();
  const staleBefore = new Date(Date.now() - MERGE_STACK_CLAIM_TIMEOUT_MS);
  if (
    rows.some((row) => row.quantity <= 0 && row.updatedAt <= staleBefore) &&
    (!canRecover || (await canRecover()))
  ) {
    await restoreStaleUserItemMergeClaims({ client, userId, staleBefore });
    rows = await fetchRows();
    onStaleMergeClaimRecovery?.();
  }
  return rows.filter((row) => row.quantity > 0);
};

export const fetchUserItems = async (
  client: DrizzleClient,
  userId: string,
  options?: {
    includeHidden?: boolean;
    /** Parallel authorization reads must finish before an inventory read repairs stale claims. */
    canRecoverStaleMergeClaims?: () => Promise<boolean>;
    onStaleMergeClaimRecovery?: () => void;
  },
) => {
  const useritems = await withStaleMergeClaimRecovery(
    client,
    userId,
    () => listUserItemForFetchUserItems(client, userId),
    options?.canRecoverStaleMergeClaims,
    options?.onStaleMergeClaimRecovery,
  );
  return useritems.filter(
    (ui) => ui.item && (options?.includeHidden || !ui.item.hidden),
  );
};

export const fetchUserItemsWithVariants = async (
  client: DrizzleClient,
  userId: string,
) => {
  const useritems = await withStaleMergeClaimRecovery(client, userId, () =>
    listUserItemForFetchUserItemsWithVariants(client, userId),
  );
  return useritems.filter((ui) => ui.item && !ui.item.hidden);
};

/**
 * @param client - The database client
 * @param userItemId - The ID of the user item to toggle
 * @param useritems - The user items to toggle
 * @param user - The user data with the sources of their mastery tags
 * @param slot - The slot to toggle (optional)
 * @returns A promise that resolves to the result of the toggle
 */
export const toggleEquipItem = async (
  client: DrizzleClient,
  userItemId: string,
  useritems: UserItemWithRelations[],
  user: UserData & Required<MasterySources>,
  slot?: ItemSlot,
) => {
  // Create a clone to be returned
  const newUserItems = structuredClone(useritems);
  // Get the user item
  const useritem = newUserItems.find((i) => i.id === userItemId);
  // Definitions & Guard
  if (!useritem) return errorResponse("User item not found");
  if (useritem.storedAtHome) return errorResponse("Fetch at home first");
  const doEquip = slot ? useritem.equipped !== slot : useritem.equipped === "NONE";

  // Only check requirements when equipping (not when unequipping)
  if (doEquip) {
    if (useritem.item.itemType === "MEAL")
      return errorResponse("Meals can be eaten from inventory and cannot be equipped");
    if (!hasRequiredSkill(useritem.item, user)) {
      return errorResponse("Activate the required skill to equip this item");
    }
    if (useritem.item.requiredLevel > user.level) {
      return errorResponse(
        `You need to be level ${useritem.item.requiredLevel} to equip this item`,
      );
    }
    if (useritem.item.bloodlineId && useritem.item.bloodlineId !== user.bloodlineId) {
      return errorResponse(`This item requires a specific bloodline to equip`);
    }
    if (useritem.craftingFinishedAt && useritem.craftingFinishedAt > new Date()) {
      return errorResponse("Cannot equip crafting item");
    }
    if (useritem.isInAuction) {
      return errorResponse("Cannot equip item in auction");
    }
    if (isImbuing(useritem)) {
      return errorResponse("Cannot equip item because it is being imbued");
    }
    if (slot && !isCompatibleEquipSlot(slot, useritem.item.slot)) {
      return errorResponse("This item does not fit that slot");
    }
  }
  const info = useritem.item;
  const instances = newUserItems.filter(
    (ui) => ui.itemId === info.id && ui.equipped !== "NONE",
  );
  const instancesEquipped = instances.length;
  if (doEquip && instancesEquipped >= info.maxEquips) {
    return errorResponse(
      `No more than ${info.maxEquips} instances. Already have ${instancesEquipped} equipped.`,
    );
  }
  // Category limits (bloodline / hand armor / accessory) shared with loadout + buyItem
  if (doEquip) {
    const categoryError = canEquipAdditional(
      info,
      newUserItems
        .filter((ui) => ui.equipped !== "NONE" && ui.id !== useritem.id)
        .map((ui) => ({
          slot: ui.equipped,
          itemType: ui.item.itemType,
          bloodlineId: ui.item.bloodlineId,
        })),
    );
    if (categoryError) {
      return errorResponse(categoryError);
    }
  }
  // Determine equipment slot (first empty slots, then any slot)
  const newEquipSlot =
    slot ??
    findFreeEquipSlot(info.slot, newUserItems) ??
    compatibleEquipSlots(info.slot).at(-1);
  // We need to have a slot
  if (doEquip && !newEquipSlot) return errorResponse("No slot found");
  // Gated on the gear worn after the swap, so the item it displaces unlocks nothing
  if (doEquip && newEquipSlot) {
    const missingMastery = gearMissingMastery(useritem, {
      ...user,
      items: user.items.filter((ui) => ui.equipped !== newEquipSlot),
    });
    if (missingMastery) {
      return errorResponse(
        `This item requires ${missingMastery.required.toLocaleString()} ${missingMastery.label} to equip`,
      );
    }
  }
  // Response info
  let message = "";
  const changedIds = [useritem.id];
  // Mutate
  if (doEquip && newEquipSlot) {
    const userItemInSlot = newUserItems.find(
      (ui) => ui.equipped === newEquipSlot && ui.id !== useritem.id,
    );
    // Optimistic update
    useritem.equipped = newEquipSlot;
    if (userItemInSlot) {
      userItemInSlot.equipped = "NONE";
      changedIds.push(userItemInSlot.id);
    }
    message = `Equipped ${info.name}`;
  } else {
    useritem.equipped = "NONE";
    message = `Unequipped ${info.name}`;
  }
  // Return information
  return {
    success: true,
    message,
    // Swap both rows together so hunting cannot preload two items in the same slot.
    write: updateUserItemForToggleEquipItem(client, useritem, changedIds, user),
    expectedRowsAffected: changedIds.length,
    newUserItems,
  };
};

const HUNTING_INVENTORY_UNAVAILABLE_MESSAGE =
  "Inventory changed or is in use by a hunting battle. Finish any hunt, refresh and try again.";

/**
 * Build database filters for item queries based on filtering schema
 */
export const itemDatabaseFilter = (
  input?: Partial<ItemFilteringSchema>,
): QueryCondition[] => {
  const { slot, itemType } = readItemListFilterSlot(input?.slot, input?.itemType);
  return [
    // Name filter
    ...(input?.name ? [like(item.name, `%${input.name}%`)] : []),

    // Item type filter
    ...(itemType ? [eq(item.itemType, itemType)] : []),

    // Rarity filter
    ...(input?.itemRarity ? [eq(item.rarity, input.itemRarity)] : []),

    // Slot filter
    ...(slot ? [eq(item.slot, slot)] : []),

    // Method filter
    ...(input?.method ? [eq(item.method, input.method)] : []),

    // Target filter
    ...(input?.target ? [eq(item.target, input.target)] : []),

    // Effect filter
    ...(input?.effect && input.effect.length > 0
      ? [
          or(
            ...input.effect.map(
              (effect: string) =>
                sql`JSON_SEARCH(${item.effects},'one',${effect}) IS NOT NULL`,
            ),
          ),
        ]
      : []),

    // Stat filter
    ...(input?.stat
      ? [sql`JSON_SEARCH(${item.effects},'one',${input.stat}) IS NOT NULL`]
      : []),

    // Event items filter
    ...(input?.eventItems !== undefined
      ? [eq(item.isEventItem, input.eventItems)]
      : []),

    // Shop filter
    ...(input?.onlyInShop !== undefined ? [eq(item.inShop, input.onlyInShop)] : []),

    // Timed store listings: match Shop's client hide so paged catalogs do not
    // fill a page with expired rows and stall the infinite-scroll sentinel.
    ...(input?.excludeExpiredFromStore
      ? [or(isNull(item.expireFromStoreAt), gt(item.expireFromStoreAt, getUtcDayKey()))]
      : []),

    // Hidden filter (default to false if not specified)
    ...(input?.hidden !== undefined
      ? [eq(item.hidden, input.hidden)]
      : [eq(item.hidden, false)]),

    // Crafting filter
    ...(input?.canBeCrafted !== undefined
      ? [eq(item.canBeCrafted, input.canBeCrafted)]
      : []),

    // Imbuing filter
    ...(input?.canBeImbued !== undefined
      ? [eq(item.canBeImbued, input.canBeImbued)]
      : []),

    // Hunting filter
    ...(input?.canBeHunted !== undefined
      ? [eq(item.canBeHunted, input.canBeHunted)]
      : []),

    // Gathering filter
    ...(input?.canBeGathered !== undefined
      ? [eq(item.canBeGathered, input.canBeGathered)]
      : []),

    // Trading filter
    ...(input?.canBeTraded !== undefined
      ? [eq(item.canBeTraded, input.canBeTraded)]
      : []),

    // Level filter - only show items the user can use
    ...(input?.maxLevel !== undefined ? [lte(item.requiredLevel, input.maxLevel)] : []),

    // Cost filters
    gte(item.cost, input?.minCost ?? 0),
    gte(item.repsCost, input?.minRepsCost ?? 0),
    gte(item.seichiSilverCost, input?.minSeichiSilverCost ?? 0),
    ...(input?.maxSeichiSilverCost !== undefined
      ? [lte(item.seichiSilverCost, input.maxSeichiSilverCost)]
      : []),

    // Battle usage type filter
    ...(input?.battleUsageType
      ? [eq(item.battleUsageType, input.battleUsageType)]
      : []),

    // Action cost filter
    ...(input?.actionCostPerc !== undefined
      ? [eq(item.actionCostPerc, input.actionCostPerc)]
      : []),
  ];
};

/**
 * Split an item stack into two stacks
 * @param client - The database client
 * @param userItemId - The ID of the user item to split
 * @param userId - The ID of the user who owns the item (for ownership verification)
 * @param quantityToKeep - The quantity to keep in the original stack
 * @param expectedQuantity - Reject if the source no longer matches a priced snapshot
 * @returns A response with success status, message, and new stack info on success
 */
export const splitItemStack = async (
  client: DrizzleClient,
  userItemId: string,
  userId: string,
  quantityToKeep: number,
  expectedQuantity?: number,
): Promise<
  | { success: true; message: string; newUserItemId: string; quantityToSplit: number }
  | { success: false; message: string }
> => {
  // Fetch the user item to verify ownership
  const currentUserItem = await findUserItemForSplitItemStack(
    client,
    userItemId,
    userId,
  );

  if (!currentUserItem) {
    return { success: false, message: "Item not found" };
  }

  // Auction totals are priced from a prior read; reject changes before splitting.
  // The quantity CAS below protects the interval after this check.
  if (expectedQuantity !== undefined && currentUserItem.quantity !== expectedQuantity) {
    return {
      success: false,
      message: "Item quantity changed, please refresh and try again",
    };
  }

  // Do not split items that are currently in auction
  if (currentUserItem.isInAuction) {
    return { success: false, message: "Cannot split items in auction" };
  }

  // Do not split items that are currently equipped
  if (currentUserItem.equipped !== "NONE") {
    return { success: false, message: "Cannot split equipped items" };
  }

  // Check if item can be stacked
  if (!currentUserItem.item.canStack) {
    return { success: false, message: "Item cannot be stacked" };
  }

  // Check if item has imbuements (can't split items with imbuements)
  if (currentUserItem.imbuements.length > 0) {
    return { success: false, message: "Cannot split items with imbuements" };
  }

  // Validate quantity
  if (quantityToKeep >= currentUserItem.quantity) {
    return {
      success: false,
      message: `Quantity to keep must be less than current quantity (${currentUserItem.quantity})`,
    };
  }

  if (quantityToKeep < 1) {
    return { success: false, message: "Quantity to keep must be at least 1" };
  }

  const quantityToSplit = currentUserItem.quantity - quantityToKeep;
  const newUserItemId = nanoid();

  // Claim the source quantity before inserting the new row. This CAS cannot match a negative
  // merge claim and prevents a concurrent merge from turning a failed split into duplicated items.
  const updateResult = await updateUserItemForSplitItemStack(
    client,
    quantityToKeep,
    userItemId,
    userId,
    {
      quantity: currentUserItem.quantity,
      equipped: currentUserItem.equipped,
      storedAtHome: currentUserItem.storedAtHome,
    },
  );
  if (updateResult.rowsAffected !== 1) {
    return { success: false, message: "Inventory changed, please try again" };
  }

  try {
    await insertUserItemForSplitItemStack(
      client,
      newUserItemId,
      currentUserItem,
      quantityToSplit,
    );
  } catch {
    // A thrown insert is ambiguous on PlanetScale's HTTP driver (the row may have committed
    // before the response was lost), so verify before compensating — restoring the source while
    // the new row exists would duplicate the split quantity.
    const inserted = await findUserItemForSplitItemStack2(client, newUserItemId);
    if (!inserted) {
      const restored = await updateUserItemForSplitItemStack2(
        client,
        currentUserItem,
        userItemId,
        userId,
        quantityToKeep,
      );
      if (restored.rowsAffected !== 1) {
        console.error(
          `splitItemStack: failed to restore source stack ${userItemId} after insert failure`,
        );
      }
      return { success: false, message: "Could not create the split stack" };
    }
  }

  return {
    success: true,
    message: `Split stack: kept ${quantityToKeep}, created new stack with ${quantityToSplit}`,
    newUserItemId,
    quantityToSplit,
  };
};

/**
 * CAS durability write for inventory repair: only succeeds while the item is still
 * owned, carried (not home), not auctioned, outside a hunting battle, and at the
 * expected durability.
 */
const tryRepairUserItemDurability = async (
  drizzle: DrizzleClient,
  userId: string,
  target: Pick<
    UserItem,
    "id" | "durability" | "quantity" | "equipped" | "level" | "experience"
  >,
  newDurability: number,
) => {
  const result = await retryOnDeadlock(async () =>
    updateUserItemForTryRepairUserItemDurability(
      drizzle,
      newDurability,
      target,
      userId,
    ),
  );
  return result.rowsAffected === 1;
};

const refundUserMoney = async (
  drizzle: DrizzleClient,
  userId: string,
  amount: number,
) => {
  if (amount <= 0) return;
  await incrementUserMoney(drizzle, amount, userId);
};

// --- Stack merge (used by mergeStacks / mergeAllStacks)

type MergeEligibleUserItemForStackMerge = UserItem & {
  imbuements: readonly unknown[];
};

type PreloadedStackMergePayload = {
  userItems: MergeEligibleUserItemForStackMerge[];
  item: Item | undefined;
};

type MergeStacksExecutionResult = (
  | { success: true; didMerge: boolean; message: string }
  | { success: false; didMerge: false; message: string }
) & { inventoryChanges?: InventoryQuantityChange[] };

/**
 * Merges stacks only within the same inventory bucket (`storedAtHome` + `equipped`) so
 * merge never deletes an equipped row while keeping a backpack copy (or mixes home vs carried).
 *
 * Recoverable merge protocol: claim every row in the bucket by negating its
 * quantity with CAS guards, then atomically publish every keeper target and zero-quantity
 * tombstone in one UPDATE. The negative value preserves the original quantity if the process
 * crashes before publish; a crash after publish leaves the correct positive inventory and only
 * hidden tombstones for stale cleanup. If a normal claim/publish conflict occurs, restore the
 * original quantities.
 */
async function executeMergeStacksForItemBucket(
  drizzle: DrizzleClient,
  userId: string,
  itemName: string,
  stackSize: number,
  bucketItems: UserItemMergeBucketRow[],
  ownerWhere?: SQL,
): Promise<MergeStacksExecutionResult> {
  if (stackSize <= 1) {
    return { success: true, didMerge: false, message: "", inventoryChanges: [] };
  }

  const totalQuantity = bucketItems.reduce((acc, i) => acc + i.quantity, 0);
  const numFullStacks = Math.floor(totalQuantity / stackSize);
  const remainder = totalQuantity % stackSize;
  const targetStacks = numFullStacks + (remainder > 0 ? 1 : 0);
  // Publishing only rewrites existing rows, so stacks holding more than they could at the
  // stack size (after the item's stack size was lowered) stay as they are.
  if (targetStacks > bucketItems.length) {
    return { success: true, didMerge: false, message: "", inventoryChanges: [] };
  }

  // Keep the strongest ownership progression when consolidating consumables. Gear
  // buckets already share a level, so their deterministic ID ordering stays intact.
  const sortedItems = [...bucketItems].sort(
    (a, b) => b.level - a.level || a.id.localeCompare(b.id),
  );
  const itemsToKeep = sortedItems.slice(0, targetStacks);
  const itemsToDelete = sortedItems.slice(targetStacks);

  const targetQuantityForKeepIndex = (index: number) =>
    index < numFullStacks ? stackSize : remainder;

  const needsMerge =
    itemsToDelete.length > 0 ||
    itemsToKeep.some(
      (item, index) => item.quantity !== targetQuantityForKeepIndex(index),
    );
  if (!needsMerge) {
    return { success: true, didMerge: false, message: "", inventoryChanges: [] };
  }

  const conflictMessage = `Failed to merge stacks of ${itemName} — inventory changed, please try again`;

  const claimedAt = new Date();
  const publishTargets = sortedItems.map((item, index) => ({
    id: item.id,
    quantity: index < targetStacks ? targetQuantityForKeepIndex(index) : 0,
  }));
  // Admission can change status after the endpoint's initial read. Both phases
  // must stop at combat entry; restoring our claims preserves the original stacks.
  const awakeOwner = exists(
    selectUserDataForExecuteMergeStacksForItemBucket(drizzle, userId, ownerWhere),
  );

  // Restores every row this attempt touched back to its original quantity in one UPDATE. The
  // `updatedAt = claimedAt` stamp scopes the write to our own claims/publishes, and the per-row
  // quantity guard matches a still-claimed row (-q) and, once the publish has been sent, an
  // already-published one (its target), so even a partially applied publish is fully undone.
  // Before the publish only claimed rows match: another merge that claimed in the same
  // millisecond may have published those targets itself. `updatedAt` intentionally stays at
  // `claimedAt`: positive rows are never touched by the stale-claim reaper, and the tombstone
  // delete additionally guards on quantity 0.
  let publishSent = false;
  const restoreOriginalQuantities = () =>
    updateUserItemForRestoreOriginalQuantities(
      drizzle,
      sortedItems,
      userId,
      claimedAt,
      publishSent ? publishTargets : undefined,
    );

  let publishedRows = 0;
  try {
    // Phase 1: claim every row (qty → -qty) in ONE statement so a partial claim volley cannot
    // exist, while retaining enough information to recover an abandoned claim.
    const claimResult = await updateUserItemForExecuteMergeStacksForItemBucket(
      drizzle,
      sortedItems,
      claimedAt,
      awakeOwner,

      userId,
    );

    if (claimResult.rowsAffected !== sortedItems.length) {
      await restoreOriginalQuantities();
      return { success: false, didMerge: false, message: conflictMessage };
    }

    // Phase 2: atomically publish every keeper and convert extras to hidden tombstones in one
    // UPDATE, so a process crash cannot commit only a subset of the target quantities/deletions.
    publishSent = true;
    const publishResult = await updateUserItemForExecuteMergeStacksForItemBucket2(
      drizzle,
      publishTargets,
      awakeOwner,
      sortedItems,

      userId,
    );
    publishedRows = publishResult.rowsAffected;

    if (publishedRows !== sortedItems.length) {
      const restored = await restoreOriginalQuantities();
      // rowsAffected counts changed rows only; a published row whose target equals its
      // original quantity restores without changing, so subtract those before comparing.
      const unchangedByRestore = sortedItems.filter(
        (item, index) => (publishTargets[index]?.quantity ?? 0) === item.quantity,
      ).length;
      if (
        publishedRows > 0 &&
        restored.rowsAffected < sortedItems.length - unchangedByRestore
      ) {
        // A concurrent writer moved a row out of both recoverable states mid-protocol; surface
        // it loudly since quantities may need manual reconciliation.
        console.error(
          `mergeStacks: partial publish of ${itemName} for ${userId} restored ${restored.rowsAffected}/${sortedItems.length} rows`,
        );
      }
      return { success: false, didMerge: false, message: conflictMessage };
    }
  } catch (err) {
    // A rejected statement leaves unknown state (it may or may not have applied); the restore's
    // claim-scoped guards make it safe either way, and the stale reaper covers anything left.
    try {
      await restoreOriginalQuantities();
    } catch {
      // Stale-claim recovery on the next inventory read handles any remaining claims.
    }
    if (err instanceof TypeError || err instanceof ReferenceError) {
      throw err;
    }
    return { success: false, didMerge: false, message: conflictMessage };
  }

  // Physical deletion is cleanup only; zero rows are already excluded everywhere and the stale
  // claim reaper will remove them if this request dies or the best-effort delete fails.
  if (itemsToDelete.length > 0) {
    try {
      await deleteUserItemForExecuteMergeStacksForItemBucket(
        drizzle,
        userId,
        itemsToDelete,
        claimedAt,
      );
    } catch {
      // The logical merge already committed; stale cleanup will retry this tombstone deletion.
    }
  }

  return {
    success: true,
    didMerge: true,
    message: `Merged stacks of ${itemName}`,
    inventoryChanges: getInventoryQuantityChanges(
      sortedItems,
      publishTargets,
      claimedAt,
    ),
  };
}

/**
 * Merge stacks for one item type (`mergeStacks`, `mergeAllStacks`).
 *
 * **Carried inventory:** Without `preloaded`, the query uses `storedAtHome === false` only.
 * Use `mergeAllStacks({ storedAtHome: true })` with preloaded home rows to merge storage.
 *
 * **Buckets:** Each `(storedAtHome, equipped)` group merges separately so equipped and
 * backpack rows are never consolidated into one row.
 *
 * **Concurrency:** Each bucket uses a claim-then-commit protocol (see
 * `executeMergeStacksForItemBucket`) so concurrent store/retrieve cannot leave a
 * partial merge that duplicates quantities.
 *
 * **mergeAllStacks** passes `preloaded` rows of this item, already limited to the
 * requested scope (carried or home) and to positive, non-auction stacks.
 */
async function executeMergeStacksForItem(
  drizzle: DrizzleClient,
  userId: string,
  itemId: string,
  preloaded?: PreloadedStackMergePayload,
  ownerWhere?: SQL,
): Promise<MergeStacksExecutionResult> {
  let canProject = true;
  let info: Item | undefined;
  let userItems: MergeEligibleUserItemForStackMerge[];

  if (preloaded) {
    info = preloaded.item;
    userItems = preloaded.userItems;
  } else {
    // fetchItem is independent of the user's claim state, so it runs in parallel with the
    // reaper → items chain instead of serializing behind it.
    const [fetchedInfo, fetchedUserItems] = await Promise.all([
      fetchItem(drizzle, itemId),
      restoreStaleMergeStackClaims(drizzle, userId).then((recovered) => {
        canProject = !recovered;
        return listUserItemForExecuteMergeStacksForItem(drizzle, userId, itemId);
      }),
    ]);
    info = fetchedInfo;
    userItems = fetchedUserItems;
  }
  const filteredUserItems = userItems.filter(
    (i) =>
      i.imbuements.length === 0 &&
      (!i.craftingFinishedAt || i.craftingFinishedAt < new Date()),
  );
  if (!info || filteredUserItems.length === 0) {
    return {
      success: true,
      didMerge: false,
      message: "",
      inventoryChanges: canProject ? [] : undefined,
    };
  }

  const buckets = new Map<string, UserItemMergeBucketRow[]>();
  for (const row of filteredUserItems) {
    const key = getItemStackMergeBucketKey(info, row);
    const list = buckets.get(key);
    if (list) {
      list.push(row);
    } else {
      buckets.set(key, [row]);
    }
  }

  const bucketResults = await Promise.all(
    [...buckets.values()].map((bucket) =>
      executeMergeStacksForItemBucket(
        drizzle,
        userId,
        info.name,
        info.stackSize,
        bucket,
        ownerWhere,
      ),
    ),
  );

  const failed = bucketResults.find((r) => !r.success);
  if (failed) {
    return failed;
  }

  const didMerge = bucketResults.some((r) => r.didMerge);
  return {
    success: true,
    didMerge,
    message: didMerge ? `Merged stacks of ${info.name}` : "",
    inventoryChanges: canProject
      ? bucketResults.flatMap((result) => result.inventoryChanges ?? [])
      : undefined,
  };
}

/** A parallel merge accepts only its validated actor snapshot or its own committed wake revision. */
const recoveryMergeOwnerWhere = (readiness: ActionReadiness, recoveredAt: Date) =>
  readiness.notice
    ? or(
        readiness.where,
        and(eq(userData.status, "AWAKE"), eq(userData.updatedAt, recoveredAt)),
      )
    : undefined;
