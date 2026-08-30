import { TRPCError } from "@trpc/server";
import {
  and,
  asc,
  count,
  eq,
  exists,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  ne,
  notExists,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  hasUserMiddleware,
  protectedProcedure,
  publicProcedure,
  ratelimitMiddleware,
  serverError,
} from "@/api/trpc";
import type { ItemSlot } from "@/drizzle/constants";
import {
  ANBU_ITEMSHOP_DISCOUNT_PERC,
  EVOLUTION_MAX_CHILDREN,
  IMG_AVATAR_DEFAULT,
  ITEM_LEVEL_CAP,
  ItemSlots,
  ItemTypes,
  MAX_EXTRA_RESKIN_SLOTS,
  MAX_ITEM_VARIANTS,
  MAX_MARRIAGE_SLOTS,
  MEDNIN_HEAL_ITEM_DISCOUNT_PERC,
  TUTORIAL_ITEM_ID,
} from "@/drizzle/constants";
import type {
  ItemLoadout,
  UserData,
  UserItem,
  UserItemWithRelations,
} from "@/drizzle/schema";
import {
  actionLog,
  bloodlineRolls,
  craftingRequirement,
  item,
  itemLoadout,
  itemVariant,
  quest,
  questHistory,
  sageModeRolls,
  userData,
  userItem,
  userItemImbuement,
  userItemVariant,
  userSkill,
} from "@/drizzle/schema";
import { filterRollableBloodlines } from "@/libs/bloodline";
import {
  filterVisibleEvolutions,
  isEvolution,
  meetsEvolutionStatRequirements,
  validateEvolutionGraph,
} from "@/libs/evolution";
import {
  buildItemLoadoutData,
  calcItemRepairCost,
  calcItemSellingPrice,
  calcMaxEventItems,
  calcMaxItems,
  calcMaxMaterials,
  canEquipAdditional,
  computeLoadoutAssignments,
  nonCombatConsume,
  partitionImbuementsForItemTransfer,
} from "@/libs/item";
import {
  buildMissingLoadouts,
  decideRename,
  resolveSelectableLoadout,
} from "@/libs/loadout";
import {
  collapseRewards,
  filterQuestTrackersForDbPersist,
  getNewTrackers,
  objectiveContentIds,
  postProcessRewards,
} from "@/libs/quest";
import { calculateKitsToUse, getRepairKits, needsInventoryRepair } from "@/libs/repair";
import {
  fetchSageModeRolls,
  fetchSageModes,
  filterRollableSageModes,
} from "@/libs/sageMode";
import { callDiscordContent } from "@/libs/socials";
import { hasRequiredLevel } from "@/libs/train";
import { fetchBloodlines, fetchItemBloodlineRolls } from "@/routers/bloodline";
import { fetchUpdatedUser, fetchUser } from "@/routers/profile";
import { fetchUserSkills } from "@/routers/skillTree";
import { fetchStructures } from "@/routers/village";
import type { DrizzleClient } from "@/server/db";
import {
  consumeUserItemAtomically,
  MERGE_STACK_CLAIM_TIMEOUT_MS,
  refundUserItemQuantityAtomically,
  restoreStaleUserItemMergeClaims,
  updateUserItemQuantityAtomically,
  userItemMergeQuantityCase,
} from "@/server/utils/concurrency";
import {
  applyLoadoutRename,
  backfillLoadouts,
  fetchLoadoutUser,
} from "@/server/utils/loadout";
import { getRandomElement } from "@/utils/array";
import { calculateContentDiff } from "@/utils/diff";
import { fedItemLoadouts } from "@/utils/paypal";
import {
  canAwardReputation,
  canChangeContent,
  canEditItems,
  canOnlyEditSelf,
} from "@/utils/permissions";
import { sanitizeVariantText } from "@/utils/sanitize";
import type { QueryCondition } from "@/utils/typeutils";
import { setEmptyStringsToNulls } from "@/utils/typeutils";
import { getStrucBoost } from "@/utils/village";
import type { ZodAllTags } from "@/validators/combat";
import { HealTag, ItemValidator, NonCombatGainSkill } from "@/validators/combat";
import type { ItemFilteringSchema } from "@/validators/item";
import {
  adjustUserItemSchema,
  evolveItemSchema,
  getItemEvolutionsSchema,
  getPublicUserItemsSchema,
  ItemVariantResponseSchema,
  ItemVariantValidator,
  itemBuySchema,
  itemFilteringSchema,
  UserUnlockedVariantResponseSchema,
} from "@/validators/item";
import { renameLoadoutSchema } from "@/validators/loadout";
import type { PostProcessedRewards } from "@/validators/rewards";
import { ObjectiveReward, type ObjectiveRewardType } from "@/validators/rewards";
import { updateRewards } from "./quests";

const MIN_ITEM_SHOP_DISCOUNT_FACTOR = 0.05;

export const itemRouter = createTRPCRouter({
  getAllNames: publicProcedure
    .meta({ mcp: { enabled: true, description: "Get all item names and images" } })
    .query(async ({ ctx }) => {
      return await ctx.drizzle.query.item.findMany({
        columns: {
          id: true,
          name: true,
          image: true,
          canBeHunted: true,
          canBeGathered: true,
        },
        orderBy: (table, { asc }) => [asc(table.name)],
      });
    }),
  getBloodlineItemNames: publicProcedure
    .meta({
      mcp: {
        enabled: true,
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
      return await ctx.drizzle.query.item.findMany({
        columns: { id: true, name: true },
        where: (table, { eq }) => eq(table.bloodlineId, bloodlineId),
        orderBy: (table, { asc }) => [asc(table.name)],
      });
    }),
  get: publicProcedure
    .meta({
      mcp: {
        enabled: true,
        description: "Get a specific item by ID, or null if no such item exists",
      },
    })
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      // Deleted items stay reachable through stale links on this public endpoint,
      // so a missing row is an ordinary answer rather than an error
      const result = await fetchItem(ctx.drizzle, input.id);
      if (!result) return null;
      return result as Omit<typeof result, "effects"> & { effects: ZodAllTags[] };
    }),
  getItemWithCraftingRequirements: publicProcedure
    .meta({
      mcp: { enabled: true, description: "Get item with crafting requirements" },
    })
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await fetchItemWithCraftingRequirements(ctx.drizzle, input.id);
      if (!result) {
        throw serverError("NOT_FOUND", "Item not found");
      }
      return result;
    }),
  getUserItem: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Get a specific user item" } })
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await fetchUserItem(ctx.drizzle, ctx.userId, input.id);
      if (!result) {
        throw serverError("NOT_FOUND", "Item not found");
      }
      return result;
    }),
  // Create new item
  create: protectedProcedure
    .input(z.object({ type: z.enum(ItemTypes) }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (canChangeContent(user.role)) {
        const id = nanoid();
        await ctx.drizzle.insert(item).values({
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
        });
        return { success: true, message: id };
      } else {
        return { success: false, message: `Not allowed to create item` };
      }
    }),
  // Clone an existing item
  clone: protectedProcedure
    .input(z.object({ id: z.string() }))
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
        ctx.drizzle.insert(item).values(clonedItem),
        ...(itemData.craftingRequirements && itemData.craftingRequirements.length > 0
          ? [
              ctx.drizzle.insert(craftingRequirement).values(
                itemData.craftingRequirements.map((req) => ({
                  id: nanoid(),
                  craftItemId: newItemId,
                  requirementItemId: req.requirementItemId,
                  quantity: req.quantity,
                })),
              ),
            ]
          : []),
      ]);

      return { success: true, message: newItemId };
    }),
  // Delete a item
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, entry, childEvolutions, variants] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchItem(ctx.drizzle, input.id),
        ctx.drizzle.query.item.findMany({
          columns: { id: true, name: true },
          where: eq(item.parentItemId, input.id),
        }),
        ctx.drizzle.query.itemVariant.findMany({
          where: eq(itemVariant.itemId, input.id),
          columns: { id: true },
        }),
      ]);
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (!entry) return errorResponse("Item not found");
      if (entry.id === TUTORIAL_ITEM_ID)
        return errorResponse("Cannot delete tutorial item");
      if (!canChangeContent(user.role)) {
        return { success: false, message: `Not allowed to delete item` };
      }
      if (childEvolutions.length > 0) {
        return errorResponse(
          `Cannot delete item with evolutions: ${childEvolutions.map((e) => e.name).join(", ")}`,
        );
      }

      // No FK cascades on PlanetScale, so clean dependent rows leaf-first (user
      // unlocks -> variant definitions -> user rows) and delete the parent Item
      // last. A partial failure then leaves children pointing at a still-present
      // parent, and the delete can simply be retried.
      if (variants.length > 0) {
        await ctx.drizzle.delete(userItemVariant).where(
          inArray(
            userItemVariant.variantId,
            variants.map((v) => v.id),
          ),
        );
        await ctx.drizzle.delete(itemVariant).where(eq(itemVariant.itemId, input.id));
      }
      await Promise.all([
        ctx.drizzle.delete(userItem).where(eq(userItem.itemId, input.id)),
        ctx.drizzle
          .delete(userItemImbuement)
          .where(eq(userItemImbuement.imbuementItemId, input.id)),
      ]);

      // Write-time guard: only delete if no child evolutions appeared concurrently.
      // The subquery alias materializes a derived table, avoiding MySQL errno 1093
      // (a DELETE cannot otherwise read its own target table in a subquery).
      const evolutionChildGuard = ctx.drizzle
        .select({ id: item.id })
        .from(item)
        .where(eq(item.parentItemId, input.id))
        .as("evolutionChildren");
      const deleteResult = await ctx.drizzle
        .delete(item)
        .where(
          and(
            eq(item.id, input.id),
            notExists(ctx.drizzle.select({ one: sql`1` }).from(evolutionChildGuard)),
          ),
        );
      if (deleteResult.rowsAffected === 0) {
        return errorResponse(
          "Delete incomplete — an evolution now points at this item. Remove it and retry.",
        );
      }
      await ctx.drizzle.insert(actionLog).values({
        id: nanoid(),
        userId: ctx.userId,
        tableName: "item",
        changes: [`Deleted: ${entry.name}`],
        relatedId: entry.id,
        relatedMsg: `Delete: ${entry.name}`,
        relatedImage: entry.image,
      });
      return { success: true, message: `Item deleted` };
    }),
  // Update an item
  update: protectedProcedure
    .input(z.object({ id: z.string(), data: ItemValidator }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      setEmptyStringsToNulls(input.data, item);
      // Query
      const [user, entry, itemWithName, parent, siblings, evolutionGraph] =
        await Promise.all([
          fetchUser(ctx.drizzle, ctx.userId),
          fetchItemWithCraftingRequirements(ctx.drizzle, input.id),
          ctx.drizzle.query.item.findFirst({
            columns: { name: true, id: true },
            where: eq(item.name, input.data.name),
          }),
          input.data.parentItemId
            ? fetchItem(ctx.drizzle, input.data.parentItemId)
            : Promise.resolve(null),
          input.data.parentItemId
            ? ctx.drizzle.query.item.findMany({
                columns: { id: true },
                where: eq(item.parentItemId, input.data.parentItemId),
              })
            : Promise.resolve([]),
          input.data.parentItemId
            ? ctx.drizzle.query.item.findMany({
                columns: { id: true, parentItemId: true },
                where: isNotNull(item.parentItemId),
              })
            : Promise.resolve([]),
        ]);
      // Guard
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (!entry) return errorResponse("Item not found");
      if (itemWithName && itemWithName.id !== entry.id)
        return errorResponse("Item name already exists");
      if (!canChangeContent(user.role)) {
        return errorResponse("Not allowed to edit item");
      }
      if (entry.id === TUTORIAL_ITEM_ID && input?.data?.hidden)
        return errorResponse("Cannot hide tutorial item");
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
      if (requiresAnimation) {
        const hasValidAnimation = input.data.effects.some(
          (effect) =>
            "appearAnimation" in effect &&
            effect.appearAnimation &&
            "appearSfx" in effect &&
            effect.appearSfx,
        );
        if (!input.data.hidden && !hasValidAnimation) {
          return errorResponse(
            "Weapons and battle-usable consumables must have at least one effect with both appearAnimation and appearSfx defined",
          );
        }
      }
      // Server-side enforcement: preserve existing reward_reputation for users without permission
      // Match effects by content (excluding reward_reputation) to handle reordering
      if (!canAwardReputation(user.role)) {
        type EffectWithReputation = Record<string, unknown> & {
          type: string;
          reward_reputation?: number;
        };
        const existingEffects = entry.effects as EffectWithReputation[];
        const existingReputationEffects = existingEffects.filter(
          (e) => e.type === "noncombatconsumereward" && (e.reward_reputation ?? 0) > 0,
        );

        // Create signature for matching (all properties except reward_reputation)
        const getEffectSignature = (effect: EffectWithReputation): string => {
          const { reward_reputation: _unused, ...rest } = effect;
          void _unused; // Explicitly mark as intentionally unused
          return JSON.stringify(rest, Object.keys(rest).sort());
        };

        // Build lookup map from existing effects' signatures to their reward_reputation
        // Use an array to track multiple identical effects and prevent reputation multiplication
        const signatureToReputations = new Map<string, number[]>();
        for (const existing of existingReputationEffects) {
          const sig = getEffectSignature(existing);
          const reputations = signatureToReputations.get(sig) ?? [];
          reputations.push(existing.reward_reputation ?? 0);
          signatureToReputations.set(sig, reputations);
        }

        // Preserve reputation for matching effects, set to 0 for new/modified effects
        // Each reputation value can only be used once (prevents duplication exploit)
        input.data.effects.forEach((effect) => {
          if (effect.type === "noncombatconsumereward") {
            const typedEffect = effect as EffectWithReputation;
            const sig = getEffectSignature(typedEffect);
            const reputations = signatureToReputations.get(sig);
            // Pop the first available reputation value to prevent reuse
            const existingReputation = reputations?.shift() ?? 0;
            (effect as { reward_reputation?: number }).reward_reputation =
              existingReputation;
          }
        });
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
        const parentItemForEvo = ctx.drizzle
          .select({ id: item.id })
          .from(item)
          .where(eq(item.id, input.data.parentItemId))
          .as("parentItemForEvo");
        const evoSiblingCount = ctx.drizzle
          .select({ cnt: count().as("cnt") })
          .from(item)
          .where(
            and(eq(item.parentItemId, input.data.parentItemId), ne(item.id, input.id)),
          )
          .as("evoSiblingCount");
        evolutionUpdateGuards.push(
          exists(ctx.drizzle.select({ one: sql`1` }).from(parentItemForEvo)),
          lt(
            ctx.drizzle.select({ cnt: evoSiblingCount.cnt }).from(evoSiblingCount),
            EVOLUTION_MAX_CHILDREN,
          ),
        );
      }

      // Setting updatedAt explicitly makes rowsAffected reliable: MySQL reports
      // changed rows, so a no-change re-save would otherwise read as a failed guard.
      const updateResult = await ctx.drizzle
        .update(item)
        .set({ ...input.data, updatedAt: new Date() })
        .where(and(eq(item.id, input.id), ...evolutionUpdateGuards));
      if (updateResult.rowsAffected === 0) {
        return errorResponse(
          "Update failed — parent may have been deleted or evolution limits changed. Refresh and try again.",
        );
      }

      // Replace crafting requirements only after the guarded update succeeds, so a
      // failed guard can never wipe the recipe without re-inserting it.
      const newRequirements = input.data.craftingRequirements;
      await Promise.all([
        (async () => {
          await ctx.drizzle
            .delete(craftingRequirement)
            .where(eq(craftingRequirement.craftItemId, input.id));
          if (newRequirements && newRequirements.length > 0) {
            await ctx.drizzle.insert(craftingRequirement).values(
              newRequirements.flatMap((req) =>
                req.ids?.map((id) => ({
                  id: nanoid(),
                  craftItemId: input.id,
                  requirementItemId: id,
                  quantity: req.number,
                })),
              ),
            );
          }
        })(),
        ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "item",
          changes: diff,
          relatedId: entry.id,
          relatedMsg: `Update: ${entry.name}`,
          relatedImage: entry.image,
        }),
        ...(input.data.hidden
          ? [
              ctx.drizzle
                .update(userItem)
                .set({ equipped: "NONE" })
                .where(eq(userItem.itemId, entry.id)),
            ]
          : []),
      ]);
      if (process.env.NODE_ENV !== "development") {
        await callDiscordContent(user.username, entry.name, diff, entry.image);
      }
      return { success: true, message: `Data updated: ${diff.join(". ")}` };
    }),

  getEvolutions: publicProcedure
    .meta({
      mcp: {
        enabled: true,
        description: "Get all evolution items for a parent item",
      },
    })
    .input(getItemEvolutionsSchema)
    .query(async ({ ctx, input }) => {
      const [user, evolutions] = await Promise.all([
        ctx.userId
          ? ctx.drizzle.query.userData.findFirst({
              where: eq(userData.userId, ctx.userId),
              columns: { role: true },
            })
          : Promise.resolve(null),
        ctx.drizzle.query.item.findMany({
          where: eq(item.parentItemId, input.itemId),
          orderBy: (table, { asc: orderAsc }) => [orderAsc(table.requiredLevel)],
        }),
      ]);
      const canViewHidden = !!user && canChangeContent(user.role);
      return filterVisibleEvolutions(evolutions, canViewHidden);
    }),

  evolveItem: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Evolve an item into its evolution" } })
    .input(evolveItemSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [{ user }, userItems, evolutionItem, loadouts] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        fetchUserItems(ctx.drizzle, ctx.userId, { includeHidden: true }),
        fetchItem(ctx.drizzle, input.evolutionItemId),
        fetchItemLoadouts(ctx.drizzle, ctx.userId),
      ]);
      if (!user) return errorResponse("User not found");
      if (user.status !== "AWAKE")
        return errorResponse("Must be awake to evolve an item");
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
        userItemObj.equipped === "NONE" ||
        userItemObj.equipped === evolutionItem.slot ||
        userItemObj.equipped.startsWith(`${evolutionItem.slot}_`);

      let didEvolveThisCall = false;
      if (!alreadyEvolved) {
        const evolveResult = await ctx.drizzle
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

        didEvolveThisCall = evolveResult.rowsAffected === 1;
        if (!didEvolveThisCall) {
          const evolvedNow = await ctx.drizzle.query.userItem.findFirst({
            where: and(
              eq(userItem.id, input.userItemId),
              eq(userItem.userId, ctx.userId),
              eq(userItem.itemId, input.evolutionItemId),
            ),
            columns: { id: true },
          });
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
          ctx.drizzle.delete(userItemImbuement).where(
            inArray(
              userItemImbuement.id,
              imbuementsToRemove.map((imb) => imb.id),
            ),
          ),
          ctx.drizzle.insert(userItem).values(
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
          ),
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
            ctx.drizzle
              .update(itemLoadout)
              .set({ itemData })
              .where(
                and(eq(itemLoadout.id, loadout.id), eq(itemLoadout.userId, ctx.userId)),
              ),
          );
        });

      await Promise.all([
        ...cleanupWrites,
        ...(didEvolveThisCall
          ? [
              ctx.drizzle.insert(actionLog).values({
                id: nanoid(),
                userId: ctx.userId,
                tableName: "userItem",
                changes: [
                  `Evolved ${userItemObj.item.name} into ${evolutionItem.name}`,
                ],
                relatedId: input.evolutionItemId,
                relatedMsg: "ItemEvolution",
                relatedImage: evolutionItem.image,
              }),
            ]
          : []),
      ]);

      return {
        success: true,
        message: didEvolveThisCall
          ? `Evolved into ${evolutionItem.name}!`
          : `Finished evolution cleanup for ${evolutionItem.name}`,
      };
    }),

  getAll: publicProcedure
    .meta({ mcp: { enabled: true, description: "Get paginated items with filters" } })
    .input(
      itemFilteringSchema.extend({
        cursor: z.number().nullish(),
        limit: z.number().min(1).max(500),
      }),
    )
    .query(async ({ ctx, input }) => {
      const currentCursor = input.cursor ? input.cursor : 0;
      const skip = currentCursor * input.limit;

      // Build where conditions using the generalized filter
      const baseFilters = itemDatabaseFilter(input);

      const results = await ctx.drizzle.query.item.findMany({
        offset: skip,
        limit: input.limit,
        where: and(...baseFilters),
        orderBy: (table, { asc }) => [
          asc(table.cost),
          asc(table.repsCost),
          asc(table.id),
        ],
      });
      const nextCursor = results.length < input.limit ? null : currentCursor + 1;
      return {
        data: results,
        nextCursor: nextCursor,
      };
    }),

  // Get counts of user items grouped by item ID
  getUserItemCounts: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Get user item counts by item ID" } })
    .query(async ({ ctx }) => {
      const counts = await ctx.drizzle
        .select({
          count: sql<number>`count(${userItem.id})`,
          itemId: userItem.itemId,
          quantity: sql<number>`sum(${userItem.quantity})`,
        })
        .from(userItem)
        .where(and(eq(userItem.userId, ctx.userId), gt(userItem.quantity, 0)))
        .groupBy(userItem.itemId);
      return counts.map((c) => ({ id: c.itemId, quantity: c.quantity ?? 0 }));
    }),
  // Get user items
  getUserItems: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Get all user items" } })
    .query(async ({ ctx }) => {
      return await fetchUserItems(ctx.drizzle, ctx.userId);
    }),
  getUserItemsWithVariants: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Get all user items including variant data" },
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
      if (canOnlyEditSelf(user.role) && user.userId !== input.userId) {
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
        ctx.drizzle.query.userItem.findFirst({
          where: and(
            eq(userItem.id, input.userItemId),
            eq(userItem.userId, input.userId),
            gt(userItem.quantity, 0),
          ),
          with: { item: true },
        }),
      ]);
      if (!canEditItems(user.role)) {
        return errorResponse("Not allowed to edit public user");
      }
      if (canOnlyEditSelf(user.role) && user.userId !== input.userId) {
        return errorResponse("You can only edit your own items");
      }
      if (!owned?.item) {
        return errorResponse("Item not found for user");
      }

      const updateResult = await ctx.drizzle
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
      if (updateResult.rowsAffected === 0) {
        return errorResponse("Item changed concurrently — refresh and try again");
      }

      await ctx.drizzle.insert(actionLog).values({
        id: nanoid(),
        userId: ctx.userId,
        tableName: "user",
        changes: [`Item ${owned.item.name} lvl ${owned.level} -> ${input.level}`],
        relatedId: input.userId,
        relatedMsg: `Update: ${owned.item.name}`,
        relatedImage: owned.item.image,
      });
      return { success: true, message: "Item updated" };
    }),
  // Get all variants for an item
  getItemVariants: protectedProcedure
    .input(z.object({ itemId: z.string() }))
    .output(z.array(ItemVariantResponseSchema))
    .query(async ({ ctx, input }) => {
      return await ctx.drizzle.query.itemVariant.findMany({
        where: eq(itemVariant.itemId, input.itemId),
        orderBy: asc(itemVariant.order),
      });
    }),
  // Get unlocked variants for the current user for a given item
  getUserUnlockedVariants: protectedProcedure
    .input(z.object({ itemId: z.string() }))
    .output(z.array(UserUnlockedVariantResponseSchema))
    .query(async ({ ctx, input }) => {
      return ctx.drizzle
        .select({
          id: userItemVariant.id,
          userId: userItemVariant.userId,
          variantId: userItemVariant.variantId,
          createdAt: userItemVariant.createdAt,
        })
        .from(userItemVariant)
        .innerJoin(itemVariant, eq(userItemVariant.variantId, itemVariant.id))
        .where(
          and(
            eq(userItemVariant.userId, ctx.userId),
            eq(itemVariant.itemId, input.itemId),
          ),
        );
    }),
  // Admin: create or update a variant
  upsertItemVariant: protectedProcedure
    .input(z.object({ itemId: z.string(), variant: ItemVariantValidator }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, existing, parentItem] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.itemVariant.findMany({
          where: eq(itemVariant.itemId, input.itemId),
        }),
        ctx.drizzle.query.item.findFirst({
          where: eq(item.id, input.itemId),
          columns: { id: true },
        }),
      ]);
      if (user.isBanned) return errorResponse("You are banned");
      if (!canChangeContent(user.role)) return errorResponse("Not allowed");
      if (!parentItem) return errorResponse("Item not found");
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
        const result = await ctx.drizzle
          .update(itemVariant)
          .set({
            name: input.variant.name,
            image: input.variant.image,
            costType: input.variant.costType,
            cost: input.variant.cost,
            order: input.variant.order,
            description: safeDescription,
            battleDescription: safeBattleDescription,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(itemVariant.id, input.variant.id),
              eq(itemVariant.itemId, input.itemId),
            ),
          );
        if (result.rowsAffected === 0) return errorResponse("Variant not found");
      } else {
        const newVariantId = nanoid();
        const insertResult = await ctx.drizzle
          .insert(itemVariant)
          .values({
            id: newVariantId,
            itemId: input.itemId,
            name: input.variant.name,
            image: input.variant.image,
            costType: input.variant.costType,
            cost: input.variant.cost,
            order: input.variant.order,
            description: safeDescription,
            battleDescription: safeBattleDescription,
          })
          .onDuplicateKeyUpdate({ set: { id: sql`id` } });
        if (insertResult.rowsAffected === 0) {
          return errorResponse(`Order ${input.variant.order} is already taken`);
        }
        // Re-count after insert to close the TOCTOU window on MAX_ITEM_VARIANTS
        const [countRow] = await ctx.drizzle
          .select({ n: sql<number>`COUNT(*)` })
          .from(itemVariant)
          .where(eq(itemVariant.itemId, input.itemId));
        if ((countRow?.n ?? 0) > MAX_ITEM_VARIANTS) {
          await ctx.drizzle.delete(itemVariant).where(eq(itemVariant.id, newVariantId));
          return errorResponse(`Items can have at most ${MAX_ITEM_VARIANTS} variants`);
        }
      }
      return { success: true, message: "Variant saved" };
    }),
  // Admin: delete a variant
  deleteItemVariant: protectedProcedure
    .input(z.object({ variantId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (user.isBanned) return errorResponse("You are banned");
      if (!canChangeContent(user.role)) return errorResponse("Not allowed");
      // Step 1: remove user unlock records and clear active variant references in parallel
      await Promise.all([
        ctx.drizzle
          .delete(userItemVariant)
          .where(eq(userItemVariant.variantId, input.variantId)),
        ctx.drizzle
          .update(userItem)
          .set({ activeVariantId: null })
          .where(eq(userItem.activeVariantId, input.variantId)),
      ]);
      // Step 2: delete the variant row itself (after FK dependents are cleared)
      await ctx.drizzle.delete(itemVariant).where(eq(itemVariant.id, input.variantId));
      return { success: true, message: "Variant deleted" };
    }),
  // Purchase a variant with in-game currency
  purchaseVariant: protectedProcedure
    .input(z.object({ variantId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query — ownership check runs in parallel (variantId known upfront)
      const [user, variant, ownershipRows, existingUnlock] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.itemVariant.findFirst({
          where: eq(itemVariant.id, input.variantId),
        }),
        fetchVariantOwnership(ctx.drizzle, ctx.userId, input.variantId),
        ctx.drizzle.query.userItemVariant.findFirst({
          where: and(
            eq(userItemVariant.userId, ctx.userId),
            eq(userItemVariant.variantId, input.variantId),
          ),
        }),
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

      // Currency checks
      const currency = getVariantCurrencyOps(variant.costType, variant.cost, user);
      if (currency.balance < variant.cost) {
        return errorResponse(`Insufficient ${currency.label}. Need ${variant.cost}`);
      }

      // Mutate — deduct currency first with CAS guard (skip for free variants)
      if (variant.cost > 0) {
        const deductResult = await ctx.drizzle
          .update(userData)
          .set(currency.decrementSet)
          .where(and(eq(userData.userId, ctx.userId), currency.where));

        if (deductResult.rowsAffected !== 1) {
          return errorResponse("Insufficient funds — please refresh and try again");
        }
      }

      // Refund the deducted currency (no-op for free variants).
      const refundCurrency = async () => {
        if (variant.cost > 0) {
          await ctx.drizzle
            .update(userData)
            .set(currency.incrementSet)
            .where(eq(userData.userId, ctx.userId));
        }
      };

      // Insert unlock. Both failure modes refund so the user is never charged
      // without receiving the unlock:
      //  - rowsAffected === 0: a concurrent purchase won the unique-index race and
      //    onDuplicateKeyUpdate silently swallowed the duplicate, which would
      //    otherwise double-charge this caller for an unlock it never inserted.
      //  - thrown error: an unexpected DB failure.
      try {
        const insertResult = await ctx.drizzle
          .insert(userItemVariant)
          .values({ id: nanoid(), userId: ctx.userId, variantId: input.variantId })
          .onDuplicateKeyUpdate({ set: { id: sql`id` } });
        if (insertResult.rowsAffected === 0) {
          await refundCurrency();
          return errorResponse("Variant already unlocked");
        }
      } catch {
        await refundCurrency();
        return errorResponse("Failed to unlock variant — please try again");
      }

      return { success: true, message: `Variant "${variant.name}" unlocked!` };
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
          ? ctx.drizzle.query.userItemVariant.findFirst({
              where: and(
                eq(userItemVariant.userId, ctx.userId),
                eq(userItemVariant.variantId, input.variantId),
              ),
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
      const updateResult = await ctx.drizzle
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
                    ctx.drizzle
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
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query — ownership check runs in parallel (variantId known upfront). The
      // token only needs its base item (effects) and quantity, so fetchUserItem
      // (no variant join) suffices here.
      const [user, tokenItem, variant, ownershipRows, existingUnlock] =
        await Promise.all([
          fetchUser(ctx.drizzle, ctx.userId),
          fetchUserItem(ctx.drizzle, ctx.userId, input.tokenUserItemId),
          ctx.drizzle.query.itemVariant.findFirst({
            where: eq(itemVariant.id, input.variantId),
          }),
          fetchVariantOwnership(ctx.drizzle, ctx.userId, input.variantId),
          ctx.drizzle.query.userItemVariant.findFirst({
            where: and(
              eq(userItemVariant.userId, ctx.userId),
              eq(userItemVariant.variantId, input.variantId),
            ),
          }),
        ]);

      // Guards — mirror the consume mutation's state checks so a token cannot be
      // spent while the user is not AWAKE (covers TRAVEL/BATTLE/ASLEEP/etc.), while
      // the token stack is still crafting, or while it is tied to an active auction
      // (consumeUserItemAtomically only guards id/userId/quantity).
      if (user.isBanned) return errorResponse("You are banned");
      if (user.status !== "AWAKE") {
        return errorResponse(`Cannot use items while ${user.status.toLowerCase()}`);
      }
      if (!tokenItem) return errorResponse("Token item not found");
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
      // Variant Tokens are intentionally generic: any item carrying the
      // `unlockitemvariant` effect can unlock any token-gated variant on any item
      // the user owns. This mirrors the jutsu Reskin Token model — there is
      // deliberately no per-item or per-variant binding stored on the token.
      const hasVariantTokenEffect = tokenItem.item.effects.some(
        (e) => e.type === "unlockitemvariant",
      );
      if (!hasVariantTokenEffect) {
        return errorResponse("This item is not a Variant Token");
      }
      if (!ownershipRows.length) return errorResponse("You don't own this item");
      if (existingUnlock) return errorResponse("Variant already unlocked");
      if (tokenItem.quantity <= 0) {
        return errorResponse("Token item has no remaining uses");
      }

      // Mutate — consume token first so a crash after this leaves the user without
      // the token but without the unlock (safe-failure direction: retryable). Uses
      // the canonical atomic helper (CAS on quantity, deletes the stack at zero).
      let consumed: boolean;
      try {
        consumed = await consumeUserItemAtomically({
          client: ctx.drizzle,
          userId: ctx.userId,
          userItemId: input.tokenUserItemId,
          expectedQuantity: tokenItem.quantity,
        });
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
        const insertResult = await ctx.drizzle
          .insert(userItemVariant)
          .values({ id: nanoid(), userId: ctx.userId, variantId: input.variantId })
          .onDuplicateKeyUpdate({ set: { id: sql`id` } });
        if (insertResult.rowsAffected === 0) {
          return errorResponse(
            "Variant was already unlocked — your token was consumed. Please contact support.",
          );
        }
      } catch {
        return errorResponse(
          "Token consumed but variant unlock failed — please contact support",
        );
      }

      return {
        success: true,
        message: `Variant "${variant.name}" unlocked with token!`,
      };
    }),
  getItemRelations: publicProcedure
    .meta({
      mcp: { enabled: true, description: "Get item relations and dependencies" },
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
        enabled: true,
        description:
          "Merge carried stacks for one item type (storedAtHome=false). Per (storedAtHome+equipped) bucket; home storage is not included",
      },
    })
    .input(z.object({ itemId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (user.status !== "AWAKE") {
        return errorResponse(`Cannot merge items while ${user.status.toLowerCase()}`);
      }
      const result = await executeMergeStacksForItem(
        ctx.drizzle,
        ctx.userId,
        input.itemId,
      );
      if (!result.success) {
        return { success: false, message: result.message };
      }
      if (!result.didMerge) {
        return { success: true, message: "Nothing to merge" };
      }
      return { success: true, message: result.message };
    }),

  mergeAllStacks: protectedProcedure
    .meta({
      mcp: {
        enabled: true,
        description:
          "Merge all mergeable item stacks in carried inventory (storedAtHome=false) or home storage (storedAtHome=true)",
      },
    })
    .input(z.object({ storedAtHome: z.boolean().optional() }).nullish())
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const storedAtHome = input?.storedAtHome ?? false;
      const [user] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        restoreStaleMergeStackClaims(ctx.drizzle, ctx.userId),
      ]);
      if (user.status !== "AWAKE") {
        return errorResponse(`Cannot merge items while ${user.status.toLowerCase()}`);
      }
      const userItemsAll = await ctx.drizzle.query.userItem.findMany({
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
      if (userItemsAll.length === 0) {
        return { success: true, message: "Nothing to merge" };
      }
      const itemIds = [
        ...new Set(
          userItemsAll
            .filter((r) => r.item && r.item.stackSize > 1)
            .map((r) => r.itemId),
        ),
      ];
      if (itemIds.length === 0) {
        return { success: true, message: "Nothing to merge" };
      }
      const itemById = new Map<string, ItemRowForMerge>();
      for (const row of userItemsAll) {
        if (row.item) {
          itemById.set(row.itemId, row.item);
        }
      }
      const userItemsByItemId = new Map<string, typeof userItemsAll>();
      for (const row of userItemsAll) {
        const list = userItemsByItemId.get(row.itemId);
        if (list) {
          list.push(row);
        } else {
          userItemsByItemId.set(row.itemId, [row]);
        }
      }
      const results = await Promise.all(
        itemIds.map((itemId) =>
          executeMergeStacksForItem(ctx.drizzle, ctx.userId, itemId, {
            userItems: userItemsByItemId.get(itemId) ?? [],
            item: itemById.get(itemId) ?? undefined,
          }),
        ),
      );
      const failed = results.filter((r) => !r.success);
      const mergedTypes = results.filter((r) => r.success && r.didMerge).length;

      if (failed.length > 0 && mergedTypes === 0) {
        return { success: false, message: failed[0]?.message ?? "Merge failed" };
      }
      if (failed.length > 0) {
        return {
          success: false,
          message: `Merged ${mergedTypes} item type${mergedTypes === 1 ? "" : "s"}, but ${failed.length} other type${failed.length === 1 ? "" : "s"} did not complete (inventory may already show partial merges — try merge again).`,
        };
      }
      if (mergedTypes === 0) {
        return { success: true, message: "Nothing to merge" };
      }
      return {
        success: true,
        message: `Merged stacks for ${mergedTypes} item type${mergedTypes === 1 ? "" : "s"}`,
      };
    }),
  // Split item stack
  splitStack: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Split an item stack" } })
    .use(ratelimitMiddleware)
    .use(hasUserMiddleware)
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
  // Drop user item
  sellUserItem: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Sell or drop a user item" } })
    .input(z.object({ userItemId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, useritem] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUserItem(ctx.drizzle, ctx.userId, input.userItemId),
      ]);
      const structures = await fetchStructures(ctx.drizzle, user.villageId);
      // Guard
      if (!useritem) return errorResponse("User item not found");
      if (useritem.userId !== user.userId) return errorResponse("Not yours to sell");
      if (useritem.craftingFinishedAt && useritem.craftingFinishedAt > new Date()) {
        return errorResponse("Cannot sell crafting item");
      }
      if (useritem.isInAuction) {
        return errorResponse("Cannot sell item in auction");
      }
      // Derived
      const cost = calcItemSellingPrice(user, useritem, structures);
      // Claim the positive stack before granting proceeds. A merge claim negates quantity, so the
      // CAS cannot delete or pay for a row while it belongs to an in-flight merge.
      const deleteResult = await ctx.drizzle
        .delete(userItem)
        .where(
          and(
            eq(userItem.id, input.userItemId),
            eq(userItem.userId, ctx.userId),
            eq(userItem.quantity, useritem.quantity),
            gt(userItem.quantity, 0),
            eq(userItem.isInAuction, false),
          ),
        );
      if (deleteResult.rowsAffected !== 1) {
        return errorResponse("Inventory changed, please refresh and try again");
      }

      // Mutate dependent state only after the inventory CAS succeeds.
      await Promise.all([
        ctx.drizzle
          .delete(userItemImbuement)
          .where(eq(userItemImbuement.userItemId, input.userItemId)),
        ctx.drizzle
          .update(userData)
          .set({ money: sql`${userData.money} + ${cost}` })
          .where(eq(userData.userId, ctx.userId)),
        ...(useritem.item.cost >= 500000
          ? [
              ctx.drizzle.insert(actionLog).values({
                id: nanoid(),
                userId: ctx.userId,
                tableName: "user",
                changes: [`Sold item: ${useritem.item.name} for ${cost} ryo`],
                relatedId: ctx.userId,
                relatedMsg: `Sold item: ${useritem.item.name}`,
                relatedImage: useritem.item.image,
              }),
            ]
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
  // Use user item
  toggleEquip: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Toggle item equip status" } })
    .input(z.object({ userItemId: z.string(), slot: z.enum(ItemSlots).optional() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [useritems, user, loadouts] = await Promise.all([
        fetchUserItems(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, ctx.userId),
        fetchItemLoadouts(ctx.drizzle, ctx.userId),
      ]);
      // Mutate
      const result = await toggleEquipItem(
        ctx.drizzle,
        input.userItemId,
        useritems,
        user,
        input.slot,
      );
      // If anything happened
      if (result.success && "promises" in result && result.promises.length > 0) {
        // Update current loadout with new equipment state
        if (user.itemLoadout) {
          const currentLoadout = loadouts.find((l) => l.id === user.itemLoadout);
          if (currentLoadout) {
            const newItemData = buildItemLoadoutData(result.newUserItems);
            result.promises.push(
              ctx.drizzle
                .update(itemLoadout)
                .set({ itemData: newItemData })
                .where(eq(itemLoadout.id, currentLoadout.id)),
            );
          }
        }
        // Execute all promises in parallel
        await Promise.all(result.promises);
        // Return
        return { success: true, message: result.message };
      }
      // Else return the result from toggling
      return result;
    }),

  unequipAllItems: protectedProcedure
    .meta({
      mcp: {
        enabled: true,
        description:
          "Unequip all items on the character and clear the active item loadout",
      },
    })
    .output(baseServerResponse)
    .mutation(async ({ ctx }) => {
      // Equipped rows only (not fetchUserItems — it omits hidden items). `ctx.userId` is the session user; no extra userId guard.
      const [user, loadouts, equippedItems] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchItemLoadouts(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.userItem.findMany({
          where: and(
            eq(userItem.userId, ctx.userId),
            ne(userItem.equipped, "NONE"),
            eq(userItem.isInAuction, false),
            gt(userItem.quantity, 0),
          ),
        }),
      ]);
      if (!user) return errorResponse("User not found");

      const currentLoadout = user.itemLoadout
        ? loadouts.find((l) => l.id === user.itemLoadout)
        : undefined;
      const shouldClearLoadout = !!currentLoadout && currentLoadout.itemData.length > 0;

      if (equippedItems.length === 0) {
        if (shouldClearLoadout && currentLoadout) {
          await ctx.drizzle
            .update(itemLoadout)
            .set({ itemData: [] })
            .where(
              and(
                eq(itemLoadout.id, currentLoadout.id),
                eq(itemLoadout.userId, ctx.userId),
              ),
            );
          return { success: true, message: "Cleared active loadout" };
        }
        return { success: true, message: "Nothing equipped" };
      }

      const itemUnequipPromises: Promise<{ rowsAffected: number }>[] =
        equippedItems.map((ui) =>
          ctx.drizzle
            .update(userItem)
            .set({ equipped: "NONE" })
            .where(
              and(
                eq(userItem.id, ui.id),
                eq(userItem.userId, ctx.userId),
                ne(userItem.equipped, "NONE"),
                eq(userItem.isInAuction, false),
                gt(userItem.quantity, 0),
              ),
            ),
        );

      // rowsAffected may be 0 if another request already unequipped (same WHERE); still success.
      // Best-effort loadout clear runs in parallel; another request may have cleared it first.
      const loadoutClearPromise =
        shouldClearLoadout && currentLoadout
          ? ctx.drizzle
              .update(itemLoadout)
              .set({ itemData: [] })
              .where(
                and(
                  eq(itemLoadout.id, currentLoadout.id),
                  eq(itemLoadout.userId, ctx.userId),
                ),
              )
          : undefined;

      await Promise.all([
        ...itemUnequipPromises,
        ...(loadoutClearPromise ? [loadoutClearPromise] : []),
      ]);

      return {
        success: true,
        message: `Unequipped ${equippedItems.length} item${equippedItems.length === 1 ? "" : "s"}${loadoutClearPromise ? " and cleared active loadout" : ""}`,
      };
    }),

  // Consume item — atomic quantity decrement runs before effects (see handler below).
  consume: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Consume a consumable item" } })
    .input(z.object({ userItemId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Query
      const [
        updatedUser,
        useritem,
        allBloodlines,
        previousRolls,
        previousSageRolls,
        allSageModes,
        userSkills,
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
      ]);
      const { user } = updatedUser;

      // Guard
      if (!user) return errorResponse("User not found");
      if (!useritem) return errorResponse("User item not found");
      if (useritem.userId !== user.userId) return errorResponse("Not yours to consume");
      if (user.status !== "AWAKE")
        return errorResponse(`Cannot use items while ${user.status.toLowerCase()}`);
      if (useritem.craftingFinishedAt && useritem.craftingFinishedAt > new Date()) {
        return errorResponse("Cannot consume item that is being crafted");
      }
      if (!nonCombatConsume(useritem.item, user)) {
        return errorResponse("Not consumable");
      }

      const hasSageRoll = useritem.item.effects.some((e) => e.type === "rollsagemode");
      if (hasSageRoll && !user.sageModeId) {
        const sageModePool = filterRollableSageModes({
          sageModes: allSageModes,
          user,
          previousRolls: previousSageRolls,
        });
        if (sageModePool.length === 0) {
          return errorResponse("No sage mode is available to roll");
        }
      }

      const consumeResult = await consumeUserItemAtomically({
        client: ctx.drizzle,
        userId: ctx.userId,
        userItemId: input.userItemId,
        expectedQuantity: useritem.quantity,
      });
      if (!consumeResult) {
        return errorResponse("User item not found");
      }

      // Bookkeeping
      const messages: string[] = [];
      const updates = {
        bloodlineId: user.bloodlineId,
        sageModeId: user.sageModeId,
        curHealth: user.curHealth,
        curStamina: user.curStamina,
        curChakra: user.curChakra,
        marriageSlots: user.marriageSlots,
        extraReskinSlots: user.extraReskinSlots,
      };
      const data: unknown[] = [];

      // Rewards
      const rewards: ObjectiveRewardType[] = [];

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
      const promises: Promise<any>[] = [];
      // Only set when THIS request rolls a new sage mode; used as the COALESCE fallback at the
      // flush below so the snapshot write never resurrects a mode a concurrent removal cleared.
      let grantedSageModeId: string | null = null;
      useritem.item.effects.forEach((effect) => {
        if (effect.type === "rollbloodline") {
          const bloodlinePool = filterRollableBloodlines({
            bloodlines: allBloodlines,
            user,
            previousRolls,
            rank: effect.rank,
          });
          data.push(bloodlinePool);
          const randomBloodline = getRandomElement(bloodlinePool);
          if (!randomBloodline) {
            throw serverError("NOT_FOUND", "No bloodline found");
          }
          // Success?
          const roll = Math.random() * 100;
          const success = roll < effect.power;
          data.push({ roll, success });
          // Log action
          const previousRoll = previousRolls.find((r) =>
            success
              ? r.bloodlineId === randomBloodline.id
              : r.goal === effect.rank && !r.bloodlineId,
          );
          if (previousRoll) {
            promises.push(
              ctx.drizzle
                .update(bloodlineRolls)
                .set({ used: sql`${bloodlineRolls.used} + 1`, updatedAt: new Date() })
                .where(eq(bloodlineRolls.id, previousRoll.id)),
            );
          } else {
            promises.push(
              ctx.drizzle.insert(bloodlineRolls).values({
                id: nanoid(),
                userId: ctx.userId,
                type: "ITEM",
                bloodlineId: success ? randomBloodline.id : null,
                goal: effect.rank,
                used: 1,
                pityRolls: 0,
              }),
            );
          }
          // Message
          if (success) {
            updates.bloodlineId = randomBloodline.id;
            messages.push(`You rolled a new bloodline: ${randomBloodline.name}. `);
          } else {
            messages.push(`You rolled for a new bloodline, but none was found. `);
          }
        } else if (effect.type === "rollsagemode") {
          // `updates.sageModeId` guards against a second `rollsagemode` effect on the same item
          // clobbering a grant an earlier effect in this loop already made; `user.sageModeId`
          // guards against overwriting a mode the player already owns.
          if (user.sageModeId || updates.sageModeId) {
            messages.push(
              "You already channel a sage mode; the natural energies find no room for another. ",
            );
            return;
          }
          const sageModePool = filterRollableSageModes({
            sageModes: allSageModes,
            user,
            previousRolls: previousSageRolls,
          });
          data.push(sageModePool);
          const randomSageMode = getRandomElement(sageModePool);
          if (!randomSageMode) {
            messages.push(
              "You reach for a new sage mode, but the natural energies reveal none to you. ",
            );
            return;
          }
          const roll = Math.random() * 100;
          const success = roll < effect.power;
          data.push({ roll, success });
          if (success) {
            promises.push(
              ctx.drizzle.insert(sageModeRolls).values({
                id: nanoid(),
                userId: ctx.userId,
                type: "ITEM",
                sageModeId: randomSageMode.id,
              }),
            );
            updates.sageModeId = randomSageMode.id;
            grantedSageModeId = randomSageMode.id;
            messages.push(`You rolled a new sage mode: ${randomSageMode.name}. `);
          } else {
            messages.push(`You rolled for a new sage mode, but none was found. `);
          }
        } else if (effect.type === "noncombatconsumereward") {
          rewards.push(ObjectiveReward.parse(effect));
        } else if (effect.type === "noncombatgainskill") {
          const parsedEffect = NonCombatGainSkill.parse(effect);
          if (parsedEffect.skillId) {
            const skill = userSkills.find((s) => s.skill.id === parsedEffect.skillId);
            if (!skill) {
              promises.push(
                ctx.drizzle.insert(userSkill).values({
                  id: nanoid(),
                  userId: ctx.userId,
                  skillId: parsedEffect.skillId,
                  activated: false,
                }),
              );
              messages.push("You unlocked a special skill!");
            } else {
              messages.push(`You already have the skill ${skill.skill.name}.`);
            }
          }
        } else if (effect.type === "removebloodline") {
          if (Math.random() * 100 < effect.power) {
            updates.bloodlineId = null;
            messages.push(`Your bloodline was removed. `);
          } else {
            messages.push(`Your bloodline could not be removed successfully.`);
          }
        } else if (effect.type === "marriageslotincrease") {
          if (updates.marriageSlots < MAX_MARRIAGE_SLOTS) {
            updates.marriageSlots += effect.power;
            if (updates.marriageSlots > MAX_MARRIAGE_SLOTS) {
              updates.marriageSlots = MAX_MARRIAGE_SLOTS;
            }
            messages.push(`Your marriage slots were increased! `);
          } else {
            messages.push(
              `Your marriage slots are already at max! Current Slots: ${updates.marriageSlots}`,
            );
          }
        } else if (effect.type === "noncombatincreasereskins") {
          updates.extraReskinSlots += effect.power;
          messages.push(
            `Your number of allowed reskins was increased by ${effect.power}! `,
          );
        } else if (effect.type === "heal") {
          const parsedEffect = HealTag.parse(effect);
          const poolsAffects = parsedEffect.poolsAffected || ["Health"];
          poolsAffects.forEach((pool) => {
            switch (pool) {
              case "Health": {
                const oldHp = updates.curHealth;
                updates.curHealth = Math.min(
                  user.curHealth +
                    (effect.calculation === "percentage"
                      ? user.maxHealth * (effect.power / 100)
                      : effect.power),
                  user.maxHealth,
                );
                messages.push(`You healed ${Math.ceil(updates.curHealth - oldHp)} HP`);
                break;
              }
              case "Chakra": {
                const oldCp = updates.curChakra;
                updates.curChakra = Math.min(
                  user.curChakra +
                    (effect.calculation === "percentage"
                      ? user.maxChakra * (effect.power / 100)
                      : effect.power),
                  user.maxChakra,
                );
                messages.push(`You healed ${Math.ceil(updates.curChakra - oldCp)} CP`);
                break;
              }
              case "Stamina": {
                const oldSp = updates.curStamina;
                updates.curStamina = Math.min(
                  user.curStamina +
                    (effect.calculation === "percentage"
                      ? user.maxStamina * (effect.power / 100)
                      : effect.power),
                  user.maxStamina,
                );
                messages.push(`You healed ${Math.ceil(updates.curStamina - oldSp)} SP`);
                break;
              }
            }
          });
        }
      });
      // Parse rewards
      let processedRewards: PostProcessedRewards | null = null;
      if (rewards.length > 0) {
        const collapsedRewards = collapseRewards(rewards);
        processedRewards = postProcessRewards(collapsedRewards);
      }
      // Mutate
      const [{ items, jutsus, bloodlines, badges, sageModes }] = await Promise.all([
        processedRewards
          ? updateRewards({
              client: ctx.drizzle,
              user,
              rewards: processedRewards,
              reason: "ITEM/CONSUME",
            })
          : { items: [], jutsus: [], bloodlines: [], badges: [], sageModes: [] },
        ctx.drizzle
          .update(userData)
          // Grant the sage mode atomically. The COALESCE keeps the DB's current value when it is
          // non-null so a concurrent grant (e.g. a quest reward) committing between this endpoint's
          // read and write is not clobbered; the fallback is `grantedSageModeId` (null unless THIS
          // request rolled a mode), so a no-grant flush leaves the column untouched and never
          // resurrects a mode a concurrent removal cleared to null.
          .set({
            ...updates,
            sageModeId: sql`COALESCE(${userData.sageModeId}, ${grantedSageModeId})`,
          })
          .where(eq(userData.userId, ctx.userId)),
        useritem.quantity === 1
          ? ctx.drizzle
              .delete(userItemImbuement)
              .where(eq(userItemImbuement.userItemId, input.userItemId))
          : undefined,
        ...promises,
      ]);
      // Prettify rewards
      if (processedRewards) {
        processedRewards.reward_items = items.map((i) => i.name);
        processedRewards.reward_jutsus = jutsus.map((i) => i.name);
        processedRewards.reward_bloodlines = bloodlines.map((i) => i.name);
        processedRewards.reward_sage_modes = sageModes.map((i) => i.name);
        processedRewards.reward_badges = badges.map((i) => i.name);
      }
      // Return
      return {
        success: true,
        message: `You used ${useritem.item.name}`,
        notifications: messages,
        rewards: processedRewards,
      };
    }),
  // Repair user item
  repair: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Repair an item with ryo" } })
    .input(z.object({ userItemId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, useritem] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUserItem(ctx.drizzle, ctx.userId, input.userItemId),
      ]);
      // Guard
      if (!user) return errorResponse("User not found");
      if (!useritem) return errorResponse("User item not found");
      if (useritem.userId !== user.userId) return errorResponse("Not yours to repair");
      if (user.occupation !== "CRAFTING") {
        return errorResponse("You must have the Crafting occupation to repair items");
      }
      if (user.status !== "AWAKE") {
        return errorResponse(`Cannot repair items while ${user.status.toLowerCase()}`);
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
      // Calculate repair cost
      const repairCost = calcItemRepairCost(useritem);
      if (user.money < repairCost) {
        return errorResponse(`Insufficient funds. Repair costs ${repairCost} ryo`);
      }
      // Mutate - update money with conditional guard to prevent race conditions
      const moneyUpdateResult = await ctx.drizzle
        .update(userData)
        .set({ money: sql`${userData.money} - ${repairCost}` })
        .where(and(eq(userData.userId, ctx.userId), gte(userData.money, repairCost)));
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
        return errorResponse(
          "Could not repair item — it may have been stored, auctioned, or already repaired",
        );
      }
      return {
        success: true,
        message: `Repaired ${useritem.item.name} for ${repairCost} ryo`,
      };
    }),
  // Repair all user items
  repairAll: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Repair all items with ryo" } })
    .output(baseServerResponse)
    .mutation(async ({ ctx }) => {
      // Query
      const [user, useritems] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUserItems(ctx.drizzle, ctx.userId),
      ]);
      // Guard
      if (!user) return errorResponse("User not found");
      if (user.occupation !== "CRAFTING") {
        return errorResponse("You must have the Crafting occupation to repair items");
      }
      if (user.status !== "AWAKE") {
        return errorResponse(`Cannot repair items while ${user.status.toLowerCase()}`);
      }
      // Filter items that need repair (carried inventory only — not home/auction)
      const itemsNeedingRepair = useritems.filter(needsInventoryRepair);
      if (itemsNeedingRepair.length === 0) {
        return errorResponse("No items need repair");
      }
      // Calculate total repair cost
      const totalRepairCost = itemsNeedingRepair.reduce(
        (total, useritem) => total + calcItemRepairCost(useritem),
        0,
      );
      if (user.money < totalRepairCost) {
        return errorResponse(
          `Insufficient funds. Total repair cost is ${totalRepairCost} ryo, but you only have ${user.money} ryo`,
        );
      }
      // Mutate - repair all items and update money
      // Update money with conditional guard to prevent race conditions
      const moneyUpdateResult = await ctx.drizzle
        .update(userData)
        .set({ money: sql`${userData.money} - ${totalRepairCost}` })
        .where(
          and(eq(userData.userId, ctx.userId), gte(userData.money, totalRepairCost)),
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
        return errorResponse(
          "Could not repair items — they may have been stored, auctioned, or already repaired",
        );
      }
      const charged = totalRepairCost - refundAmount;
      if (failed.length > 0) {
        return {
          success: true,
          message: `Repaired ${succeeded.length} item${succeeded.length !== 1 ? "s" : ""} for ${charged.toLocaleString()} ryo (${failed.length} skipped — stored, auctioned, or changed)`,
        };
      }
      return {
        success: true,
        message: `Repaired ${succeeded.length} item${succeeded.length !== 1 ? "s" : ""} for ${charged.toLocaleString()} ryo`,
      };
    }),
  // Use repair item on another item
  useRepairItem: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Use repair kit on an item" } })
    .input(z.object({ repairItemId: z.string(), targetItemId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, repairUserItem, targetUserItem] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUserItem(ctx.drizzle, ctx.userId, input.repairItemId),
        fetchUserItem(ctx.drizzle, ctx.userId, input.targetItemId),
      ]);
      // Guard
      if (!user) return errorResponse("User not found");
      if (!repairUserItem) return errorResponse("Repair item not found");
      if (!targetUserItem) return errorResponse("Target item not found");
      if (repairUserItem.userId !== user.userId)
        return errorResponse("Not your repair item");
      if (targetUserItem.userId !== user.userId)
        return errorResponse("Not your target item");
      if (user.status !== "AWAKE") {
        return errorResponse(`Cannot use items while ${user.status.toLowerCase()}`);
      }
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
      if (repairUserItem.quantity <= 0) {
        return errorResponse("You don't have any of this repair item");
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
      if (actualRepair <= 0) {
        return errorResponse("Item is already at full durability");
      }
      // CAS target durability first — never consume a kit if the write fails
      const repaired = await tryRepairUserItemDurability(
        ctx.drizzle,
        ctx.userId,
        targetUserItem,
        newDurability,
      );
      if (!repaired) {
        return errorResponse(
          "Could not repair item — it may have been stored, auctioned, or already repaired",
        );
      }
      // Consume repair item if it's consumable
      if (repairUserItem.item.destroyOnUse) {
        const consumed = await consumeUserItemAtomically({
          client: ctx.drizzle,
          userId: ctx.userId,
          userItemId: input.repairItemId,
          expectedQuantity: repairUserItem.quantity,
        });
        if (!consumed) {
          // Roll back durability so a kit race does not grant a free repair
          await ctx.drizzle
            .update(userItem)
            .set({ durability: targetUserItem.durability })
            .where(
              and(
                eq(userItem.id, input.targetItemId),
                eq(userItem.userId, ctx.userId),
                eq(userItem.durability, newDurability),
              ),
            );
          return errorResponse(
            "Could not consume repair kit — inventory changed, please try again",
          );
        }
      }
      return {
        success: true,
        message: `Repaired ${targetUserItem.item.name} by ${actualRepair} durability using ${repairUserItem.item.name}`,
      };
    }),
  // Use repair items to repair all items
  useRepairAll: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Use repair kits to fix all items" } })
    .output(
      baseServerResponse.extend({
        kitsUsed: z
          .array(
            z.object({
              repairItemId: z.string(),
              repairItemName: z.string(),
              quantityUsed: z.number(),
            }),
          )
          .optional(),
      }),
    )
    .mutation(async ({ ctx }) => {
      // Query
      const [user, useritems] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUserItems(ctx.drizzle, ctx.userId),
      ]);
      // Guard
      if (!user) return errorResponse("User not found");
      if (user.status !== "AWAKE") {
        return errorResponse(`Cannot use items while ${user.status.toLowerCase()}`);
      }
      // Filter items that need repair (carried inventory only — not home/auction)
      const itemsNeedingRepair = useritems.filter(needsInventoryRepair);
      if (itemsNeedingRepair.length === 0) {
        return errorResponse("No items need repair");
      }
      // Shared kit selection with the inventory preview (lowest power first)
      const repairKits = getRepairKits(useritems);
      if (repairKits.length === 0) {
        return errorResponse("You don't have any repair items in your inventory");
      }
      const { kitsToUse, totalDurabilityNeeded, canRepairAll } = calculateKitsToUse(
        itemsNeedingRepair,
        repairKits,
        useritems,
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
      const repairOutcomes = await Promise.all(
        itemsNeedingRepair.map(async (useritem) => {
          const repaired = await tryRepairUserItemDurability(
            ctx.drizzle,
            ctx.userId,
            useritem,
            useritem.item.maxDurability,
          );
          return { useritem, repaired };
        }),
      );
      const failedRepairs = repairOutcomes.filter((o) => !o.repaired);
      if (failedRepairs.length > 0) {
        await Promise.all(
          repairOutcomes
            .filter((o) => o.repaired)
            .map((o) =>
              ctx.drizzle
                .update(userItem)
                .set({ durability: o.useritem.durability })
                .where(
                  and(
                    eq(userItem.id, o.useritem.id),
                    eq(userItem.userId, ctx.userId),
                    eq(userItem.durability, o.useritem.item.maxDurability),
                  ),
                ),
            ),
        );
        return errorResponse(
          "Could not repair all items — one or more were stored, auctioned, or changed. No kits were consumed.",
        );
      }

      // Consume repair kits only after every target write succeeded. calculateKitsToUse clamps
      // quantityUsed to the stack quantity, so the helper's delete-at-zero branch covers the
      // full-stack case.
      const kitConsumeResults = await Promise.all(
        kitsToUse.map(async ({ repairItemId, quantityUsed }) => {
          const repairKitRow = useritems.find((ui) => ui.id === repairItemId);
          if (!repairKitRow || quantityUsed <= 0 || !repairKitRow.item.destroyOnUse) {
            return null;
          }
          const consumed = await updateUserItemQuantityAtomically({
            client: ctx.drizzle,
            userId: ctx.userId,
            userItemId: repairItemId,
            expectedQuantity: repairKitRow.quantity,
            nextQuantity: repairKitRow.quantity - quantityUsed,
          });
          return consumed ? { repairKitRow, quantityConsumed: quantityUsed } : false;
        }),
      );
      if (kitConsumeResults.some((result) => result === false)) {
        await Promise.all([
          ...itemsNeedingRepair.map((useritem) =>
            ctx.drizzle
              .update(userItem)
              .set({ durability: useritem.durability })
              .where(
                and(
                  eq(userItem.id, useritem.id),
                  eq(userItem.userId, ctx.userId),
                  eq(userItem.durability, useritem.item.maxDurability),
                ),
              ),
          ),
          ...kitConsumeResults.flatMap((result) =>
            result
              ? [
                  refundUserItemQuantityAtomically({
                    client: ctx.drizzle,
                    itemSnapshot: result.repairKitRow,
                    quantity: result.quantityConsumed,
                  }),
                ]
              : [],
          ),
        ]);
        return errorResponse(
          "Could not consume repair kits — inventory changed, please try again",
        );
      }

      return {
        success: true,
        message: `Repaired ${itemsNeedingRepair.length} item${itemsNeedingRepair.length !== 1 ? "s" : ""} using ${kitsUsedSummary}`,
        kitsUsed: kitsToUse,
      };
    }),
  // Buy user item
  buy: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Buy an item from shop" } })
    .input(itemBuySchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const iid = input.itemId;
      const uid = ctx.userId;
      const [user, info, useritems, structures, questState] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchItem(ctx.drizzle, iid),
        fetchUserItems(ctx.drizzle, uid),
        fetchStructures(ctx.drizzle, input.villageId),
        fetchUserQuestState(ctx.drizzle, ctx.userId),
      ]);
      // Derived
      const regularItems = useritems?.filter(
        (ui) =>
          !ui.item.isEventItem && !ui.storedAtHome && ui.item.itemType !== "MATERIAL",
      );
      const eventItems = useritems?.filter(
        (ui) => ui.item.isEventItem && !ui.storedAtHome,
      );
      const materials = useritems?.filter(
        (ui) =>
          !ui.item.isEventItem && ui.item.itemType === "MATERIAL" && !ui.storedAtHome,
      );
      const regularItemsCount = regularItems?.length || 0;
      const eventItemsCount = eventItems?.length || 0;
      const materialsCount = materials?.length || 0;
      const sDiscount = getStrucBoost("itemDiscountPerLvl", structures);
      const aDiscount = user.anbuId ? ANBU_ITEMSHOP_DISCOUNT_PERC : 0;
      const hDiscount = info?.effects.find((e) => e.type === "heal")
        ? MEDNIN_HEAL_ITEM_DISCOUNT_PERC
        : 0;
      const factor = Math.max(
        MIN_ITEM_SHOP_DISCOUNT_FACTOR,
        (100 - sDiscount - aDiscount - hDiscount) / 100,
      );
      // Guard
      if (user.villageId !== input.villageId) return errorResponse("Wrong village");
      if (!info) return errorResponse("Item not found");
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
      if (!info.isEventItem && regularItemsCount >= calcMaxItems(user)) {
        return errorResponse("Inventory is full");
      }
      if (info.isEventItem && eventItemsCount >= calcMaxEventItems(user)) {
        return errorResponse("Event item inventory is full");
      }
      if (info.itemType === "MATERIAL" && materialsCount >= calcMaxMaterials(user)) {
        return errorResponse("Materials inventory is full");
      }
      if (info.expireFromStoreAt && new Date(info.expireFromStoreAt) < new Date()) {
        return errorResponse("Item has expired");
      }
      const ryoCost = Math.ceil(info.cost * input.stack * factor);
      const repsCost = Math.ceil(info.repsCost * input.stack);
      const seichiSilverCost = Math.ceil(info.seichiSilverCost * input.stack);
      // Figure out if we equip this
      let equipped: ItemSlot = "NONE";
      const instancesEquipped = useritems.filter(
        (ui) => ui.itemId === info.id && ui.equipped !== "NONE",
      ).length;
      const canAutoEquip =
        !info.effects.find((e) => e.type.includes("bloodline")) &&
        instancesEquipped < info.maxEquips &&
        user.level >= info.requiredLevel &&
        (!info.bloodlineId || info.bloodlineId === user.bloodlineId) &&
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
        ItemSlots.forEach((slot) => {
          if (slot.includes(info.slot) && !useritems.find((i) => i.equipped === slot)) {
            equipped = slot;
          }
        });
      }
      // buy_item quest tracker. Source questData + userQuests/completedQuests together from
      // the single fetchUserQuestState read above (NOT fetchUpdatedUser, which pulls
      // achievements/wars/raids and runs regen writes) — one snapshot keeps the tracker read
      // internally consistent, instead of pairing questData from one fetch with userQuests
      // from another. If that fetch failed (null), SKIP tracking entirely — writing an empty
      // questData would wipe the user's existing quest progress. NPC item shop only; auction
      // buyouts are a separate, out-of-scope path.
      // Only touch questData when the purchase can actually advance a buy_item
      // objective for this item: buy_item is content-gated (unlike the always-on
      // counters in craft/train), so any other purchase would re-serialize an
      // unchanged snapshot — and since this read-modify-write has no CAS on
      // questData, that write could clobber a concurrent tracker update for no
      // benefit. Objectives already marked done are skipped for the same reason:
      // completed achievements stay in fetchUserQuestState's result forever, so
      // without the done-check every later matching purchase would re-open the
      // redundant-write window. When it does advance, the full-snapshot write
      // matches every other tracker path (hospital/jutsu/occupation), which all
      // accept that same window.
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
          // Source questData + userQuests + completedQuests from the SAME fetchUserQuestState
          // snapshot so the tracker read is internally consistent. Drop orphaned rows (quest
          // deleted → `quest` is null) to match the convention fetchUpdatedUser applies; this
          // bespoke fetch is the one caller that otherwise leaks nulls into the tracker/persist
          // path. (The scalar fields getNewTrackers' "every time" block reads still come from
          // fetchUser — a pre-existing, accepted torn-read this consolidation does not widen.)
          questData: questState.questData,
          userQuests: questState.userQuests.filter((q) => q.quest),
          completedQuests: questState.completedQuests,
        } as unknown as Parameters<typeof getNewTrackers>[0];
        const { trackers } = getNewTrackers(buyer, [
          { task: "buy_item", increment: input.stack, contentId: iid },
        ]);
        questDataUpdate = {
          questData: filterQuestTrackersForDbPersist(trackers, buyer),
        };
      }
      // Mutate — fold questData into the same CAS UPDATE so it only persists when the
      // fund deduction succeeds (one UPDATE per row, no separate questData write).
      const result = await ctx.drizzle
        .update(userData)
        .set({
          money: sql`${userData.money} - ${ryoCost}`,
          reputationPoints: sql`${userData.reputationPoints} - ${repsCost}`,
          seichiSilver: sql`${userData.seichiSilver} - ${seichiSilverCost}`,
          ...questDataUpdate,
        })
        .where(
          and(
            eq(userData.userId, uid),
            gte(userData.money, ryoCost),
            gte(userData.reputationPoints, repsCost),
            gte(userData.seichiSilver, seichiSilverCost),
          ),
        );
      if (result.rowsAffected !== 1) {
        return { success: false, message: "Insufficient funds for this purchase" };
      }
      await ctx.drizzle.insert(userItem).values({
        id: nanoid(),
        userId: uid,
        itemId: iid,
        quantity: input.stack,
        equipped: equipped,
      });
      return { success: true, message: `You bought ${info.name}` };
    }),
  // Auto-equip optimal items based on cost
  autoEquipOptimal: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Auto-equip best items by cost" } })
    .output(baseServerResponse)
    .mutation(async ({ ctx }) => {
      // Fetch user items
      const [fetchedItems, user] = await Promise.all([
        fetchUserItems(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, ctx.userId),
      ]);
      // Mutable inventory snapshot so each successful equip is visible to the next
      // toggleEquipItem call (canEquipAdditional category limits).
      let useritems = fetchedItems;

      // Get unequipped items that are not stored at home, sorted by cost (descending)
      const unequippedItems = useritems
        .filter(
          (ui) =>
            ui.equipped === "NONE" &&
            !ui.storedAtHome &&
            !ui.isInAuction &&
            (!ui.craftingFinishedAt || ui.craftingFinishedAt < new Date()),
        )
        .sort((a, b) => b.item.cost - a.item.cost);
      let availableSlots = ItemSlots.filter(
        (slot) => !useritems.find((ui) => ui.equipped === slot),
      );

      // Guard
      if (unequippedItems.length === 0) {
        return errorResponse("No unequipped items available");
      }
      if (availableSlots.length === 0) {
        return errorResponse("No available slots to equip items");
      }

      // Try to equip each unequipped item
      const updatePromises = [];
      let nEquipped = 0;
      for (const useritem of unequippedItems) {
        const slot = availableSlots.find((slot) => slot.includes(useritem.item.slot));
        if (slot) {
          const result = await toggleEquipItem(
            ctx.drizzle,
            useritem.id,
            useritems,
            user,
            slot,
          );
          if (result.success && "promises" in result && result.promises.length > 0) {
            nEquipped++;
            updatePromises.push(...result.promises);
            availableSlots = availableSlots.filter((s) => s !== slot);
            useritems = result.newUserItems;
          }
        }
      }

      // Execute all updates
      if (updatePromises.length > 0) {
        await Promise.all(updatePromises);
      }

      return {
        success: true,
        message: `Equipped ${nEquipped} item${nEquipped === 1 ? "" : "s"}`,
      };
    }),
  getItemLoadouts: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Get user's item loadouts" } })
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
        { itemData: [] as ItemLoadout["itemData"] },
        new Date(),
      );
      return backfillLoadouts<ItemLoadout>({
        loadouts,
        missing,
        maxLoadouts,
        currentPointer: user?.itemLoadout ?? null,
        insertMissing: (rows) =>
          ctx.drizzle
            .insert(itemLoadout)
            .values(rows)
            .onDuplicateKeyUpdate({ set: { id: sql`id` } }),
        writeDefaultPointer: (id) =>
          // Compare-and-swap: only set the default when no pointer exists yet, so
          // a concurrent select that set it first is not overwritten.
          ctx.drizzle
            .update(userData)
            .set({ itemLoadout: id })
            .where(and(eq(userData.userId, ctx.userId), isNull(userData.itemLoadout))),
      });
    }),
  selectItemLoadout: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Select an item loadout" } })
    .input(z.object({ id: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [loadouts, user, useritems] = await Promise.all([
        fetchItemLoadouts(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUserItems(ctx.drizzle, ctx.userId, { includeHidden: true }),
      ]);
      // Mutate & return result
      const id = input.id;
      return await selectItemLoadout(ctx.drizzle, id, loadouts, useritems, user);
    }),

  renameLoadout: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Rename an item loadout" } })
    .input(renameLoadoutSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [loadouts, user] = await Promise.all([
        fetchItemLoadouts(ctx.drizzle, ctx.userId),
        fetchLoadoutUser(ctx.drizzle, ctx.userId),
      ]);
      return applyLoadoutRename(
        decideRename(loadouts, fedItemLoadouts(user), input),
        (name) =>
          ctx.drizzle
            .update(itemLoadout)
            .set({ name })
            .where(
              and(eq(itemLoadout.id, input.id), eq(itemLoadout.userId, ctx.userId)),
            ),
        () =>
          ctx.drizzle.query.itemLoadout
            .findFirst({
              columns: { id: true },
              where: and(
                eq(itemLoadout.id, input.id),
                eq(itemLoadout.userId, ctx.userId),
              ),
            })
            .then((row) => !!row),
      );
    }),
});

/**
 * COMMON QUERIES WHICH ARE REUSED
 */

/**
 * @param client - The database client
 * @param loadoutId - The ID of the loadout to select
 * @param loadouts - The loadouts to select from
 * @param useritems - The user items to select from
 * @param user - The user data
 * @returns A promise that resolves to the result of the select
 */
export const selectItemLoadout = async (
  client: DrizzleClient,
  loadoutId: string,
  loadouts: ItemLoadout[],
  useritems: UserItemWithRelations[],
  user: Pick<
    UserData,
    "userId" | "federalStatus" | "staffAccount" | "level" | "bloodlineId"
  >,
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
  if (assignments.length === 0) {
    await client
      .update(userItem)
      .set({ equipped: "NONE" })
      .where(eq(userItem.userId, user.userId));
  } else {
    const sqlChunks: SQL[] = [sql`(case`];
    for (const a of assignments) {
      // Re-check availability inside the atomic update (mirrors
      // getEquipBlockReason + isImbuing): if a row was moved home/auction/crafting
      // or began imbuing between the snapshot and now, its arm no longer matches
      // and it falls to 'NONE' instead of being equipped while ineligible.
      // Imbuement lives on a separate table, so it needs a correlated NOT EXISTS.
      sqlChunks.push(
        sql`when ${userItem.id} = ${a.userItemId} and ${userItem.storedAtHome} = false and ${userItem.isInAuction} = false and (${userItem.craftingFinishedAt} is null or ${userItem.craftingFinishedAt} <= ${now}) and not exists (select 1 from ${userItemImbuement} where ${userItemImbuement.userItemId} = ${a.userItemId} and ${userItemImbuement.craftingFinishedAt} > ${now}) then ${a.slot}`,
      );
    }
    sqlChunks.push(sql`else 'NONE' end)`);
    // Drizzle narrows `equipped` to the enum union in set(); cast the raw CASE
    // expression to that type so it is accepted as the column value.
    const equippedCase = sql.join(sqlChunks, sql.raw(" ")) as unknown as ItemSlot;
    await client
      .update(userItem)
      .set({ equipped: equippedCase })
      .where(eq(userItem.userId, user.userId));
  }

  // The equip above is one atomic statement, so it never half-applies. Advance
  // the active-loadout pointer only AFTER it succeeds (one extra round-trip, not
  // a parallel Promise.all) so the pointer can never race ahead of the equip and
  // point at a loadout that was not actually applied.
  await client
    .update(userData)
    .set({ itemLoadout: loadout.id })
    .where(eq(userData.userId, user.userId));

  // The CASE can legitimately drop an assignment to 'NONE' when the row became
  // unavailable (home/auction/crafting/imbue) between the snapshot and the
  // UPDATE. Re-read the committed equipped state for the assigned rows so the
  // in-memory list, the returned items and the warnings reflect what was
  // actually equipped — not merely what we intended to equip.
  const assignmentIds = assignments.map((a) => a.userItemId);
  const committedRows =
    assignmentIds.length > 0
      ? await client
          .select({ id: userItem.id, equipped: userItem.equipped })
          .from(userItem)
          .where(
            and(eq(userItem.userId, user.userId), inArray(userItem.id, assignmentIds)),
          )
      : [];
  const committedSlot = new Map(
    committedRows.filter((r) => r.equipped !== "NONE").map((r) => [r.id, r.equipped]),
  );
  useritems.forEach((ui) => {
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
    items: useritems.filter((ui) => committedSlot.has(ui.id)),
  };
};

/**
 * Return AI and quest relations for an item
 */
export const getItemRelations = async (client: DrizzleClient, itemId: string) => {
  const [aiEquippedItem, questsUsingItem] = await Promise.all([
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
      ),
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
    }),
  ]);

  return { aiEquippedItem, questsUsingItem };
};
export type ItemRelations = Awaited<ReturnType<typeof getItemRelations>>;

// Currency types whose cost is drawn from a user balance (excludes VARIANT_TOKEN,
// which is gated by consuming a Variant Token item instead).
type VariantCurrencyType =
  | "MONEY"
  | "REPUTATION"
  | "SEICHI_SILVER"
  | "VILLAGE_PRESTIGE";

// Single source of truth for variant currency handling: the user's current balance,
// the CAS guard for an atomic deduct, and the decrement/increment update sets.
// Adding a new currency only requires extending the map below in one place.
const getVariantCurrencyOps = (
  costType: VariantCurrencyType,
  cost: number,
  user: {
    money: number;
    reputationPoints: number;
    seichiSilver: number;
    villagePrestige: number;
  },
) => {
  const ops = {
    MONEY: {
      label: "Ryo",
      balance: user.money,
      where: gte(userData.money, cost),
      decrementSet: { money: sql`${userData.money} - ${cost}` },
      incrementSet: { money: sql`${userData.money} + ${cost}` },
    },
    REPUTATION: {
      label: "Reputation",
      balance: user.reputationPoints,
      where: gte(userData.reputationPoints, cost),
      decrementSet: { reputationPoints: sql`${userData.reputationPoints} - ${cost}` },
      incrementSet: { reputationPoints: sql`${userData.reputationPoints} + ${cost}` },
    },
    SEICHI_SILVER: {
      label: "Seichi Silver",
      balance: user.seichiSilver,
      where: gte(userData.seichiSilver, cost),
      decrementSet: { seichiSilver: sql`${userData.seichiSilver} - ${cost}` },
      incrementSet: { seichiSilver: sql`${userData.seichiSilver} + ${cost}` },
    },
    VILLAGE_PRESTIGE: {
      label: "Prestige",
      balance: user.villagePrestige,
      where: gte(userData.villagePrestige, cost),
      decrementSet: { villagePrestige: sql`${userData.villagePrestige} - ${cost}` },
      incrementSet: { villagePrestige: sql`${userData.villagePrestige} + ${cost}` },
    },
  };
  return ops[costType];
};

/**
 * Thin quest-state fetch for tracker emits: only the relations getNewTrackers needs
 * (active + achievement userQuests, plus completedQuests for availability checks).
 * Avoids fetchUpdatedUser's fat row and its regen side-writes.
 */
const fetchUserQuestState = async (client: DrizzleClient, userId: string) => {
  return await client.query.userData.findFirst({
    where: eq(userData.userId, userId),
    columns: { userId: true, questData: true },
    with: {
      userQuests: {
        where: or(
          and(isNull(questHistory.endAt), eq(questHistory.completed, 0)),
          eq(questHistory.questType, "achievement"),
        ),
        with: { quest: true },
      },
      completedQuests: {
        columns: { id: true, questId: true, completed: true },
        where: gte(questHistory.completed, 1),
      },
    },
  });
};

export const fetchItem = async (client: DrizzleClient, id: string) => {
  return await client.query.item.findFirst({
    where: eq(item.id, id),
  });
};

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
): Promise<T[]> => {
  let rows = await fetchRows();
  const staleBefore = new Date(Date.now() - MERGE_STACK_CLAIM_TIMEOUT_MS);
  if (rows.some((row) => row.quantity <= 0 && row.updatedAt <= staleBefore)) {
    await restoreStaleUserItemMergeClaims({ client, userId, staleBefore });
    rows = await fetchRows();
  }
  return rows.filter((row) => row.quantity > 0);
};

export const fetchUserItems = async (
  client: DrizzleClient,
  userId: string,
  options?: { includeHidden?: boolean },
) => {
  const useritems = await withStaleMergeClaimRecovery(client, userId, () =>
    client.query.userItem.findMany({
      where: eq(userItem.userId, userId),
      with: {
        item: true,
        imbuements: { with: { item: true } },
      },
    }),
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
    client.query.userItem.findMany({
      where: eq(userItem.userId, userId),
      with: {
        item: { with: { variants: { orderBy: (v, { asc }) => [asc(v.order)] } } },
        imbuements: { with: { item: true } },
      },
    }),
  );
  return useritems.filter((ui) => ui.item && !ui.item.hidden);
};

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

/**
 * @param client - The database client
 * @param userItemId - The ID of the user item to toggle
 * @param useritems - The user items to toggle
 * @param user - The user data
 * @param slot - The slot to toggle (optional)
 * @returns A promise that resolves to the result of the toggle
 */
export const toggleEquipItem = async (
  client: DrizzleClient,
  userItemId: string,
  useritems: UserItemWithRelations[],
  user: UserData,
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
    const currentlyImbuing = useritem.imbuements.filter(
      (imbuement) =>
        imbuement.craftingFinishedAt && imbuement.craftingFinishedAt > new Date(),
    );
    if (currentlyImbuing.length > 0) {
      return errorResponse("Cannot equip item because it is being imbued");
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
  let newEquipSlot = slot;
  if (newEquipSlot === undefined) {
    ItemSlots.forEach((slot) => {
      if (slot.includes(info.slot) && !newUserItems.find((i) => i.equipped === slot)) {
        newEquipSlot = slot;
      }
    });
    if (newEquipSlot === undefined) {
      ItemSlots.forEach((slot) => {
        if (slot.includes(info.slot)) {
          newEquipSlot = slot;
        }
      });
    }
  }
  // We need to have a slot
  if (!newEquipSlot) return errorResponse("No slot found");
  // Response info
  let message = "";
  let promises: Promise<{ rowsAffected: number }>[] = [];
  // Mutate
  if (doEquip) {
    const userItemInSlot = newUserItems.find(
      (ui) => ui.equipped === newEquipSlot && ui.id !== useritem.id,
    );
    // Optimistic update
    useritem.equipped = newEquipSlot;
    if (userItemInSlot) {
      userItemInSlot.equipped = "NONE";
    }
    // Promises
    promises = [
      client
        .update(userItem)
        .set({ equipped: newEquipSlot })
        .where(
          and(
            eq(userItem.id, useritem.id),
            eq(userItem.userId, user.userId),
            gt(userItem.quantity, 0),
          ),
        ),
      ...(userItemInSlot
        ? [
            client
              .update(userItem)
              .set({ equipped: "NONE" })
              .where(
                and(
                  eq(userItem.id, userItemInSlot.id),
                  eq(userItem.userId, user.userId),
                  gt(userItem.quantity, 0),
                ),
              ),
          ]
        : []),
    ];
    message = `Equipped ${info.name}`;
  } else {
    useritem.equipped = "NONE";
    promises = [
      client
        .update(userItem)
        .set({ equipped: "NONE" })
        .where(
          and(
            eq(userItem.id, useritem.id),
            eq(userItem.userId, user.userId),
            gt(userItem.quantity, 0),
          ),
        ),
    ];
    message = `Unequipped ${info.name}`;
  }
  // Return information
  return {
    success: true,
    message,
    promises,
    newUserItems,
  };
};

export const fetchItemLoadouts = async (client: DrizzleClient, userId: string) => {
  return await client.query.itemLoadout.findMany({
    where: eq(itemLoadout.userId, userId),
    // id is the deterministic tie-breaker so ties on createdAt (possible after a
    // batched backfill) keep a stable order across reads.
    orderBy: (table) => [asc(table.createdAt), asc(table.id)],
  });
};

/**
 * Build database filters for item queries based on filtering schema
 */
export const itemDatabaseFilter = (
  input?: Partial<ItemFilteringSchema>,
): QueryCondition[] => {
  return [
    // Name filter
    ...(input?.name ? [like(item.name, `%${input.name}%`)] : []),

    // Item type filter
    ...(input?.itemType ? [eq(item.itemType, input.itemType)] : []),

    // Rarity filter
    ...(input?.itemRarity ? [eq(item.rarity, input.itemRarity)] : []),

    // Slot filter
    ...(input?.slot ? [eq(item.slot, input.slot)] : []),

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
 * @returns A response with success status, message, and new stack info on success
 */
export const splitItemStack = async (
  client: DrizzleClient,
  userItemId: string,
  userId: string,
  quantityToKeep: number,
): Promise<
  | { success: true; message: string; newUserItemId: string; quantityToSplit: number }
  | { success: false; message: string }
> => {
  // Fetch the user item to verify ownership
  const currentUserItem = await client.query.userItem.findFirst({
    where: and(
      eq(userItem.id, userItemId),
      eq(userItem.userId, userId),
      gt(userItem.quantity, 0),
    ),
    with: { item: true, imbuements: true },
  });

  if (!currentUserItem) {
    return { success: false, message: "Item not found" };
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
  const updateResult = await client
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
  if (updateResult.rowsAffected !== 1) {
    return { success: false, message: "Inventory changed, please try again" };
  }

  try {
    await client.insert(userItem).values({
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
  } catch {
    // A thrown insert is ambiguous on PlanetScale's HTTP driver (the row may have committed
    // before the response was lost), so verify before compensating — restoring the source while
    // the new row exists would duplicate the split quantity.
    const inserted = await client.query.userItem.findFirst({
      where: eq(userItem.id, newUserItemId),
      columns: { id: true },
    });
    if (!inserted) {
      const restored = await client
        .update(userItem)
        .set({ quantity: currentUserItem.quantity })
        .where(
          and(
            eq(userItem.id, userItemId),
            eq(userItem.userId, userId),
            eq(userItem.quantity, quantityToKeep),
          ),
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
 * owned, carried (not home), not auctioned, and at the expected durability.
 */
const tryRepairUserItemDurability = async (
  drizzle: DrizzleClient,
  userId: string,
  target: { id: string; durability: number },
  newDurability: number,
) => {
  const result = await drizzle
    .update(userItem)
    .set({ durability: newDurability })
    .where(
      and(
        eq(userItem.id, target.id),
        eq(userItem.userId, userId),
        eq(userItem.storedAtHome, false),
        eq(userItem.isInAuction, false),
        gt(userItem.quantity, 0),
        eq(userItem.durability, target.durability),
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
  await drizzle
    .update(userData)
    .set({ money: sql`${userData.money} + ${amount}` })
    .where(eq(userData.userId, userId));
};

// --- Stack merge (used by mergeStacks / mergeAllStacks; kept at bottom with other helpers)

type ItemRowForMerge = NonNullable<Awaited<ReturnType<typeof fetchItem>>>;

type MergeEligibleUserItemForStackMerge = UserItem & {
  imbuements: readonly unknown[];
};

type PreloadedStackMergePayload = {
  userItems: MergeEligibleUserItemForStackMerge[];
  item: ItemRowForMerge | undefined;
};

type MergeStacksExecutionResult =
  | { success: true; didMerge: boolean; message: string }
  | { success: false; didMerge: false; message: string };

type UserItemMergeBucketRow = Pick<
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

// activeVariantId is part of the bucket key so two stacks of the same item with
// different selected cosmetics never merge into one (which would silently drop
// one variant). Same-variant stacks share a bucket, so the merged row keeps the
// correct variant and the per-bucket UPDATE/DELETE need not guard on it.
// level is part of the key for the same reason: merging a leveled stack into a
// lower-level one would silently drop its ownership progression.
// Note: a selectVariant call racing between bucket construction and the writes
// could move a row to a different variant after bucketing — an accepted,
// pre-existing PlanetScale limitation (no transactions), not a regression here.
const mergeStacksBucketKey = (
  row: Pick<UserItem, "storedAtHome" | "equipped" | "activeVariantId" | "level">,
) =>
  `${row.storedAtHome ? "home" : "carry"}:${row.equipped}:${row.activeVariantId ?? "none"}:${row.level}`;

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

/**
 * Merges stacks only within the same inventory bucket (`storedAtHome` + `equipped`) so
 * merge never deletes an equipped row while keeping a backpack copy (or mixes home vs carried).
 *
 * Protocol (PlanetScale has no transactions): claim every row in the bucket by negating its
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
): Promise<MergeStacksExecutionResult> {
  if (stackSize <= 1) {
    return { success: true, didMerge: false, message: "" };
  }

  const totalQuantity = bucketItems.reduce((acc, i) => acc + i.quantity, 0);
  const numFullStacks = Math.floor(totalQuantity / stackSize);
  const remainder = totalQuantity % stackSize;
  const targetStacks = numFullStacks + (remainder > 0 ? 1 : 0);

  const sortedItems = [...bucketItems].sort((a, b) => a.id.localeCompare(b.id));
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
    return { success: true, didMerge: false, message: "" };
  }

  const conflictMessage = `Failed to merge stacks of ${itemName} — inventory changed, please try again`;

  const claimedAt = new Date();
  const publishTargets = sortedItems.map((item, index) => ({
    id: item.id,
    quantity: index < targetStacks ? targetQuantityForKeepIndex(index) : 0,
  }));

  // Restores every row this attempt touched back to its original quantity in one UPDATE. The
  // `updatedAt = claimedAt` stamp scopes the write to our own claims/publishes, and the per-row
  // quantity guard matches both a still-claimed row (-q) and an already-published one (its
  // target), so even a partially applied publish is fully undone. `updatedAt` intentionally stays
  // at `claimedAt`: positive rows are never touched by the stale-claim reaper, and the tombstone
  // delete additionally guards on quantity 0.
  const restoreOriginalQuantities = () =>
    drizzle
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

  let publishedRows = 0;
  try {
    // Phase 1: claim every row (qty → -qty) in ONE statement so a partial claim volley cannot
    // exist, while retaining enough information to recover an abandoned claim.
    const claimResult = await drizzle
      .update(userItem)
      .set({
        quantity: userItemMergeQuantityCase(
          sortedItems.map((item) => ({ id: item.id, quantity: -item.quantity })),
        ),
        updatedAt: claimedAt,
      })
      .where(
        or(
          ...sortedItems.map((item) => mergeStackRowGuard(userId, item, item.quantity)),
        ),
      );

    if (claimResult.rowsAffected !== sortedItems.length) {
      await restoreOriginalQuantities();
      return { success: false, didMerge: false, message: conflictMessage };
    }

    // Phase 2: atomically publish every keeper and convert extras to hidden tombstones in one
    // UPDATE, so a process crash cannot commit only a subset of the target quantities/deletions.
    const publishResult = await drizzle
      .update(userItem)
      .set({ quantity: userItemMergeQuantityCase(publishTargets) })
      .where(
        or(
          ...sortedItems.map((item) =>
            mergeStackRowGuard(userId, item, -item.quantity),
          ),
        ),
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
      await drizzle.delete(userItem).where(
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
    } catch {
      // The logical merge already committed; stale cleanup will retry this tombstone deletion.
    }
  }

  return {
    success: true,
    didMerge: true,
    message: `Merged stacks of ${itemName}`,
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
 * **mergeAllStacks** passes `preloaded` rows already limited to the requested scope
 * (carried or home), non-auction stacks.
 */
async function executeMergeStacksForItem(
  drizzle: DrizzleClient,
  userId: string,
  itemId: string,
  preloaded?: PreloadedStackMergePayload,
): Promise<MergeStacksExecutionResult> {
  let info: ItemRowForMerge | undefined;
  let userItems: MergeEligibleUserItemForStackMerge[];

  if (preloaded) {
    info = preloaded.item;
    userItems = preloaded.userItems.filter(
      (r) => r.userId === userId && r.itemId === itemId && r.quantity > 0,
    );
  } else {
    // fetchItem is independent of the user's claim state, so it runs in parallel with the
    // reaper → items chain instead of serializing behind it.
    const [fetchedInfo, fetchedUserItems] = await Promise.all([
      fetchItem(drizzle, itemId),
      restoreStaleMergeStackClaims(drizzle, userId).then(() =>
        drizzle.query.userItem.findMany({
          where: and(
            eq(userItem.userId, userId),
            eq(userItem.itemId, itemId),
            gt(userItem.quantity, 0),
            eq(userItem.storedAtHome, false),
            eq(userItem.isInAuction, false),
          ),
          with: { imbuements: true },
        }),
      ),
    ]);
    info = fetchedInfo ?? undefined;
    userItems = fetchedUserItems;
  }
  const filteredUserItems = userItems.filter(
    (i) =>
      i.imbuements.length === 0 &&
      (!i.craftingFinishedAt || i.craftingFinishedAt < new Date()) &&
      !i.isInAuction,
  );
  if (!info || filteredUserItems.length === 0) {
    return { success: true, didMerge: false, message: "" };
  }

  const buckets = new Map<string, UserItemMergeBucketRow[]>();
  for (const row of filteredUserItems) {
    const key = mergeStacksBucketKey(row);
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
      ),
    ),
  );

  const failed = bucketResults.find((r) => !r.success);
  if (failed) {
    return failed;
  }

  const didMerge = bucketResults.some((r) => r.didMerge);
  if (!didMerge) {
    return { success: true, didMerge: false, message: "" };
  }
  return {
    success: true,
    didMerge: true,
    message: `Merged stacks of ${info.name}`,
  };
}
