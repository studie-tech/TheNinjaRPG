import { and, desc, eq, gte, isNull, like, lte, ne, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  publicProcedure,
  serverError,
} from "@/api/trpc";
import type { ItemSlot } from "@/drizzle/constants";
import {
  ANBU_ITEMSHOP_DISCOUNT_PERC,
  IMG_AVATAR_DEFAULT,
  ItemSlots,
  ItemTypes,
  MAX_EXTRA_RESKIN_SLOTS,
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
  quest,
  userData,
  userItem,
  userItemImbuement,
  userSkill,
} from "@/drizzle/schema";
import { filterRollableBloodlines } from "@/libs/bloodline";
import {
  calcItemRepairCost,
  calcItemSellingPrice,
  calcMaxEventItems,
  calcMaxItems,
  calcMaxMaterials,
  nonCombatConsume,
} from "@/libs/item";
import { collapseRewards, postProcessRewards } from "@/libs/quest";
import { callDiscordContent } from "@/libs/socials";
import { fetchBloodlines, fetchItemBloodlineRolls } from "@/routers/bloodline";
import { fetchUpdatedUser, fetchUser } from "@/routers/profile";
import { fetchUserSkills } from "@/routers/skillTree";
import { fetchStructures } from "@/routers/village";
import type { DrizzleClient } from "@/server/db";
import { getRandomElement } from "@/utils/array";
import { calculateContentDiff } from "@/utils/diff";
import { fedItemLoadouts } from "@/utils/paypal";
import { canAwardReputation, canChangeContent } from "@/utils/permissions";
import type { QueryCondition } from "@/utils/typeutils";
import { setEmptyStringsToNulls } from "@/utils/typeutils";
import { getStrucBoost } from "@/utils/village";
import type { ZodAllTags } from "@/validators/combat";
import { HealTag, ItemValidator, NonCombatGainSkill } from "@/validators/combat";
import type { ItemFilteringSchema } from "@/validators/item";
import { itemFilteringSchema } from "@/validators/item";
import type { PostProcessedRewards } from "@/validators/rewards";
import { ObjectiveReward, type ObjectiveRewardType } from "@/validators/rewards";
import { updateRewards } from "./quests";

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
  get: publicProcedure
    .meta({ mcp: { enabled: true, description: "Get a specific item by ID" } })
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await fetchItem(ctx.drizzle, input.id);
      if (!result) {
        throw serverError("NOT_FOUND", "Item not found");
      }
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
      // Query
      const [user, entry] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchItem(ctx.drizzle, input.id),
      ]);
      // Guard
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (!entry) return errorResponse("Item not found");
      if (entry.id === TUTORIAL_ITEM_ID)
        return errorResponse("Cannot delete tutorial item");
      if (entry && canChangeContent(user.role)) {
        await Promise.all([
          ctx.drizzle.delete(item).where(eq(item.id, input.id)),
          ctx.drizzle.delete(userItem).where(eq(userItem.itemId, input.id)),
          ctx.drizzle
            .delete(userItemImbuement)
            .where(eq(userItemImbuement.imbuementItemId, input.id)),
          ctx.drizzle.insert(actionLog).values({
            id: nanoid(),
            userId: ctx.userId,
            tableName: "item",
            changes: [`Deleted: ${entry.name}`],
            relatedId: entry.id,
            relatedMsg: `Delete: ${entry.name}`,
            relatedImage: entry.image,
          }),
        ]);
        return { success: true, message: `Item deleted` };
      } else {
        return { success: false, message: `Not allowed to delete item` };
      }
    }),
  // Update an item
  update: protectedProcedure
    .input(z.object({ id: z.string(), data: ItemValidator }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      setEmptyStringsToNulls(input.data);
      // Query
      const [user, entry, itemWithName] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchItemWithCraftingRequirements(ctx.drizzle, input.id),
        ctx.drizzle.query.item.findFirst({
          columns: { name: true, id: true },
          where: eq(item.name, input.data.name),
        }),
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
      // Update crafting requirements
      const newRequirements = input.data.craftingRequirements;
      await ctx.drizzle
        .delete(craftingRequirement)
        .where(eq(craftingRequirement.craftItemId, input.id));

      // Update database
      await Promise.all([
        ctx.drizzle.update(item).set(input.data).where(eq(item.id, input.id)),
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
        ...(newRequirements && newRequirements?.length > 0
          ? [
              ctx.drizzle.insert(craftingRequirement).values(
                newRequirements.flatMap((req) =>
                  req.ids?.map((id) => ({
                    id: nanoid(),
                    craftItemId: input.id,
                    requirementItemId: id,
                    quantity: req.number,
                  })),
                ),
              ),
            ]
          : []),
      ]);
      if (process.env.NODE_ENV !== "development") {
        await callDiscordContent(user.username, entry.name, diff, entry.image);
      }
      return { success: true, message: `Data updated: ${diff.join(". ")}` };
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
        .where(eq(userItem.userId, ctx.userId))
        .groupBy(userItem.itemId);
      return counts.map((c) => ({ id: c.itemId, quantity: c.quantity ?? 0 }));
    }),
  // Get user items
  getUserItems: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Get all user items" } })
    .query(async ({ ctx }) => {
      return await fetchUserItems(ctx.drizzle, ctx.userId);
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
          "Merge all mergeable item stacks in carried inventory (excludes home storage)",
      },
    })
    .output(baseServerResponse)
    .mutation(async ({ ctx }) => {
      const userItemsAll = await ctx.drizzle.query.userItem.findMany({
        where: and(
          eq(userItem.userId, ctx.userId),
          eq(userItem.storedAtHome, false),
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
      // Mutate
      await Promise.all([
        ctx.drizzle.delete(userItem).where(eq(userItem.id, input.userItemId)),
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
            const newItemData = result.newUserItems
              .filter((ui) => ui.equipped !== "NONE")
              .map((ui) => ({ itemId: ui.itemId, slot: ui.equipped }));
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

  // Consume item
  consume: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Consume a consumable item" } })
    .input(z.object({ userItemId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Query
      const [updatedUser, useritem, allBloodlines, previousRolls, userSkills] =
        await Promise.all([
          fetchUpdatedUser({
            client: ctx.drizzle,
            userId: ctx.userId,
            forceRegen: true,
          }),
          fetchUserItem(ctx.drizzle, ctx.userId, input.userItemId),
          fetchBloodlines(ctx.drizzle),
          fetchItemBloodlineRolls(ctx.drizzle, ctx.userId),
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

      // Bookkeeping
      const messages: string[] = [];
      const updates = {
        bloodlineId: user.bloodlineId,
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
          if (!randomBloodline) throw serverError("NOT_FOUND", "No bloodline found");
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
      const [{ items, jutsus, bloodlines, badges }] = await Promise.all([
        processedRewards
          ? updateRewards({
              client: ctx.drizzle,
              user,
              rewards: processedRewards,
              reason: "ITEM/CONSUME",
            })
          : { items: [], jutsus: [], bloodlines: [], badges: [] },
        ctx.drizzle
          .update(userData)
          .set(updates)
          .where(eq(userData.userId, ctx.userId)),
        useritem.quantity > 1
          ? ctx.drizzle
              .update(userItem)
              .set({ quantity: sql`${userItem.quantity} - 1` })
              .where(eq(userItem.id, input.userItemId))
          : Promise.all([
              ctx.drizzle.delete(userItem).where(eq(userItem.id, input.userItemId)),
              ctx.drizzle
                .delete(userItemImbuement)
                .where(eq(userItemImbuement.userItemId, input.userItemId)),
            ]),
        ...promises,
      ]);
      // Prettify rewards
      if (processedRewards) {
        processedRewards.reward_items = items.map((i) => i.name);
        processedRewards.reward_jutsus = jutsus.map((i) => i.name);
        processedRewards.reward_bloodlines = bloodlines.map((i) => i.name);
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
      // Update item durability
      await ctx.drizzle
        .update(userItem)
        .set({ durability: useritem.item.maxDurability })
        .where(eq(userItem.id, input.userItemId));
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
      // Filter items that need repair
      const itemsNeedingRepair = useritems.filter(
        (useritem) =>
          useritem.durability < useritem.item.maxDurability &&
          useritem.item.maxDurability > 0,
      );
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
      // Update item durabilities
      await Promise.all(
        itemsNeedingRepair.map((useritem) =>
          ctx.drizzle
            .update(userItem)
            .set({ durability: useritem.item.maxDurability })
            .where(eq(userItem.id, useritem.id)),
        ),
      );
      return {
        success: true,
        message: `Repaired ${itemsNeedingRepair.length} item${itemsNeedingRepair.length !== 1 ? "s" : ""} for ${totalRepairCost.toLocaleString()} ryo`,
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
      // Mutate
      const promises: Promise<any>[] = [
        ctx.drizzle
          .update(userItem)
          .set({ durability: newDurability })
          .where(eq(userItem.id, input.targetItemId)),
      ];
      // Consume repair item if it's consumable
      if (repairUserItem.item.destroyOnUse) {
        if (repairUserItem.quantity <= 1) {
          promises.push(
            ctx.drizzle.delete(userItem).where(eq(userItem.id, input.repairItemId)),
          );
        } else {
          promises.push(
            ctx.drizzle
              .update(userItem)
              .set({ quantity: sql`${userItem.quantity} - 1` })
              .where(eq(userItem.id, input.repairItemId)),
          );
        }
      }
      await Promise.all(promises);
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
      // Filter items that need repair
      const itemsNeedingRepair = useritems.filter(
        (useritem) =>
          useritem.durability < useritem.item.maxDurability &&
          useritem.item.maxDurability > 0,
      );
      if (itemsNeedingRepair.length === 0) {
        return errorResponse("No items need repair");
      }
      // Get all available repair kits (excluding items being crafted)
      const repairKits = useritems
        .filter(
          (userItem) =>
            userItem.item?.effects?.some(
              (e: { type: string }) => e.type === "repair",
            ) &&
            userItem.quantity > 0 &&
            (!userItem.craftingFinishedAt || userItem.craftingFinishedAt < new Date()),
        )
        .map((userItem) => {
          const repairEffect = userItem.item.effects.find(
            (e: { type: string }) => e.type === "repair",
          );
          return {
            userItem,
            repairAmount: Math.floor(repairEffect?.power || 0),
            repairEffect,
          };
        })
        .filter((kit) => kit.repairAmount > 0)
        .sort((a, b) => a.repairAmount - b.repairAmount); // Sort by repair power (smallest first) to minimize waste

      if (repairKits.length === 0) {
        return errorResponse("You don't have any repair items in your inventory");
      }

      // Calculate total durability needed (pool all together)
      const totalDurabilityNeeded = itemsNeedingRepair.reduce(
        (total, useritem) =>
          total + (useritem.item.maxDurability - useritem.durability),
        0,
      );

      // Track kit usage and available quantities
      const kitUsage: Map<string, number> = new Map(); // Map of userItemId -> quantity used
      const kitAvailability: Map<string, number> = new Map(); // Map of userItemId -> available quantity
      for (const kit of repairKits) {
        kitAvailability.set(kit.userItem.id, kit.userItem.quantity);
      }

      // Group kits by power level and aggregate quantities
      const kitsByPower = new Map<
        number,
        Array<{ kitId: string; available: number; power: number }>
      >();
      for (const kit of repairKits) {
        const available = kitAvailability.get(kit.userItem.id) || 0;
        if (available <= 0) continue;

        if (!kitsByPower.has(kit.repairAmount)) {
          kitsByPower.set(kit.repairAmount, []);
        }
        kitsByPower.get(kit.repairAmount)?.push({
          kitId: kit.userItem.id,
          available,
          power: kit.repairAmount,
        });
      }

      // Sort by power (smallest first)
      const sortedPowers = Array.from(kitsByPower.keys()).sort((a, b) => a - b);

      // Use kits starting with lowest power first until all durability is covered
      let remainingDurability = totalDurabilityNeeded;
      for (const power of sortedPowers) {
        if (remainingDurability <= 0) break;

        const kitsWithThisPower = kitsByPower.get(power);
        if (!kitsWithThisPower) continue;
        const totalAvailable = kitsWithThisPower.reduce(
          (sum, k) => sum + k.available,
          0,
        );

        if (totalAvailable <= 0) continue;

        const kitsNeeded = Math.ceil(remainingDurability / power);
        let kitsToUse = Math.min(kitsNeeded, totalAvailable);

        // Distribute across all stacks of this power level
        for (const { kitId, available } of kitsWithThisPower) {
          if (kitsToUse <= 0) break;
          const useFromThisStack = Math.min(kitsToUse, available);
          if (useFromThisStack > 0) {
            const currentUsage = kitUsage.get(kitId) || 0;
            kitUsage.set(kitId, currentUsage + useFromThisStack);
            const currentAvailable = kitAvailability.get(kitId) || 0;
            kitAvailability.set(kitId, currentAvailable - useFromThisStack);
            kitsToUse -= useFromThisStack;
            remainingDurability -= useFromThisStack * power;
          }
        }
      }

      if (remainingDurability > 0) {
        return errorResponse(
          `Insufficient repair kits. Need ${totalDurabilityNeeded} durability total, but only have enough for ${totalDurabilityNeeded - remainingDurability} durability`,
        );
      }

      // All items will be repaired to full durability
      const itemRepairs: Array<{ userItemId: string; newDurability: number }> =
        itemsNeedingRepair.map((useritem) => ({
          userItemId: useritem.id,
          newDurability: useritem.item.maxDurability,
        }));

      // Build kits used summary
      const kitsToUse: Array<{
        repairItemId: string;
        repairItemName: string;
        quantityUsed: number;
      }> = [];
      for (const [repairItemId, quantityUsed] of kitUsage.entries()) {
        const repairUserItem = useritems.find((ui) => ui.id === repairItemId);
        if (repairUserItem && quantityUsed > 0) {
          kitsToUse.push({
            repairItemId,
            repairItemName: repairUserItem.item.name,
            quantityUsed,
          });
        }
      }

      // Apply repairs to all items
      const repairPromises: Promise<any>[] = itemRepairs.map((repair) =>
        ctx.drizzle
          .update(userItem)
          .set({ durability: repair.newDurability })
          .where(eq(userItem.id, repair.userItemId)),
      );

      // Consume repair kits
      for (const [repairItemId, quantityUsed] of kitUsage.entries()) {
        const repairUserItem = useritems.find((ui) => ui.id === repairItemId);
        if (!repairUserItem) continue;

        if (repairUserItem.item.destroyOnUse) {
          if (repairUserItem.quantity <= quantityUsed) {
            repairPromises.push(
              ctx.drizzle.delete(userItem).where(eq(userItem.id, repairItemId)),
            );
          } else {
            repairPromises.push(
              ctx.drizzle
                .update(userItem)
                .set({ quantity: sql`${userItem.quantity} - ${quantityUsed}` })
                .where(eq(userItem.id, repairItemId)),
            );
          }
        }
      }

      await Promise.all(repairPromises);

      const kitsUsedSummary = kitsToUse
        .map((kit) => `${kit.quantityUsed}x ${kit.repairItemName}`)
        .join(", ");

      return {
        success: true,
        message: `Repaired ${itemsNeedingRepair.length} item${itemsNeedingRepair.length !== 1 ? "s" : ""} using ${kitsUsedSummary}`,
        kitsUsed: kitsToUse,
      };
    }),
  // Buy user item
  buy: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Buy an item from shop" } })
    .input(
      z.object({
        itemId: z.string(),
        stack: z.number().min(1).max(50),
        villageId: z.string().nullish(),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const iid = input.itemId;
      const uid = ctx.userId;
      const [user, info, useritems, structures] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchItem(ctx.drizzle, iid),
        fetchUserItems(ctx.drizzle, uid),
        fetchStructures(ctx.drizzle, input.villageId),
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
      const factor = (100 - sDiscount - aDiscount - hDiscount) / 100;
      // Guard
      if (user.villageId !== input.villageId) return errorResponse("Wrong village");
      if (!info) return errorResponse("Item not found");
      if (input.stack > 1 && !info.canStack) return errorResponse("Item cannot stack");
      if (input.stack > 1 && input.stack > info.stackSize)
        return errorResponse("You can not buy a stack with this many items");
      if (!info.inShop) return errorResponse("Item is not for sale");
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
      const hasBloodlineItemEquipped = useritems.some(
        (ui) => ui.equipped !== "NONE" && ui.item.bloodlineId,
      );
      const canAutoEquip =
        !info.effects.find((e) => e.type.includes("bloodline")) &&
        instancesEquipped < info.maxEquips &&
        user.level >= info.requiredLevel &&
        (!info.bloodlineId || info.bloodlineId === user.bloodlineId) &&
        (!info.bloodlineId || !hasBloodlineItemEquipped);

      if (canAutoEquip) {
        // Check if hand armor restriction applies
        const isHandArmor = info.itemType === "ARMOR" && info.slot === "HAND";
        const hasHandArmorEquipped = useritems.some(
          (ui) =>
            (ui.equipped === "HAND_1" || ui.equipped === "HAND_2") &&
            ui.item.itemType === "ARMOR",
        );

        ItemSlots.forEach((slot) => {
          if (slot.includes(info.slot) && !useritems.find((i) => i.equipped === slot)) {
            // Skip auto-equip for hand armors if one is already equipped
            if (isHandArmor && hasHandArmorEquipped) {
              return;
            }
            equipped = slot;
          }
        });
      }
      // Mutate
      const result = await ctx.drizzle
        .update(userData)
        .set({
          money: sql`${userData.money} - ${ryoCost}`,
          reputationPoints: sql`${userData.reputationPoints} - ${repsCost}`,
          seichiSilver: sql`${userData.seichiSilver} - ${seichiSilverCost}`,
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
      const [useritems, user] = await Promise.all([
        fetchUserItems(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, ctx.userId),
      ]);

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
        fetchUser(ctx.drizzle, ctx.userId),
      ]);
      // Derived
      const maxLoadouts = fedItemLoadouts(user);
      // Create missing loadouts if needed
      if (loadouts.length < maxLoadouts) {
        for (let i = loadouts.length; i < maxLoadouts; i++) {
          const loadout = {
            id: nanoid(),
            userId: ctx.userId,
            itemData: [],
            createdAt: new Date(),
          };
          await ctx.drizzle.insert(itemLoadout).values(loadout);
          loadouts.push(loadout);
        }
      }
      return maxLoadouts < loadouts.length ? loadouts.slice(0, maxLoadouts) : loadouts;
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
        fetchUserItems(ctx.drizzle, ctx.userId),
      ]);
      // Mutate & return result
      const id = input.id;
      return await selectItemLoadout(ctx.drizzle, id, loadouts, useritems, user);
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
  // First unequip all items
  // Derived
  const loadout = loadouts.find((l) => l.id === loadoutId);
  const maxLoadouts = fedItemLoadouts(user);
  // Guard
  if (!loadout) return errorResponse("Loadout not found");
  if (maxLoadouts <= 0) return errorResponse("Loadouts not available");

  // Validate items in loadout
  const validItemData: Array<{ itemId: string; slot: ItemSlot }> = [];
  const invalidItems = [];
  for (const itemEntry of loadout.itemData) {
    const useritem = useritems.find((ui) => ui.itemId === itemEntry.itemId);
    if (!useritem) {
      invalidItems.push(`Item not found`);
      continue;
    }
    if (useritem.storedAtHome) {
      invalidItems.push(`${useritem.item.name} is stored at home`);
      continue;
    }
    if (useritem.item.requiredLevel > user.level) {
      invalidItems.push(
        `${useritem.item.name} requires level ${useritem.item.requiredLevel}`,
      );
      continue;
    }
    if (useritem.item.bloodlineId && useritem.item.bloodlineId !== user.bloodlineId) {
      invalidItems.push(`${useritem.item.name} requires a specific bloodline to equip`);
      continue;
    }
    if (useritem.craftingFinishedAt && useritem.craftingFinishedAt > new Date()) {
      invalidItems.push(`${useritem.item.name} is being crafted`);
      continue;
    }
    if (useritem.isInAuction) {
      invalidItems.push(`${useritem.item.name} is in auction`);
      continue;
    }
    const currentlyImbuing = useritem.imbuements.filter(
      (imbuement) =>
        imbuement.craftingFinishedAt && imbuement.craftingFinishedAt > new Date(),
    );
    if (currentlyImbuing.length > 0) {
      invalidItems.push(`${useritem.item.name} is being imbued`);
      continue;
    }
    // Validate slot is still valid (handles legacy data like ITEM_7)
    const validSlots = ItemSlots as readonly string[];
    if (!validSlots.includes(itemEntry.slot)) {
      // Try to find a valid slot for this item type
      const itemSlotType = useritem.item.slot;
      const matchingSlot = ItemSlots.find(
        (slot) =>
          slot.includes(itemSlotType) && !validItemData.find((v) => v.slot === slot),
      );
      if (matchingSlot) {
        validItemData.push({ itemId: itemEntry.itemId, slot: matchingSlot });
      } else {
        invalidItems.push(`${useritem.item.name} has invalid slot`);
      }
      continue;
    }
    validItemData.push(itemEntry);
  }

  // Get valid item ids
  const validItemIds = validItemData.map((i) => i.itemId);

  // First unequip all items
  await client
    .update(userItem)
    .set({ equipped: "NONE" })
    .where(eq(userItem.userId, user.userId));
  useritems.forEach((ui) => {
    ui.equipped = "NONE";
  });

  // Then equip valid items from loadout
  const equipPromises = [];
  for (const itemEntry of validItemData) {
    // Find the first available item with this itemId
    const userItemToEquip =
      useritems.find(
        (ui) => ui.itemId === itemEntry.itemId && ui.equipped === "NONE",
      ) || useritems.find((ui) => ui.itemId === itemEntry.itemId);

    if (userItemToEquip) {
      equipPromises.push(
        client
          .update(userItem)
          .set({ equipped: itemEntry.slot })
          .where(eq(userItem.id, userItemToEquip.id)),
      );
      userItemToEquip.equipped = itemEntry.slot;
    }
  }
  // Execute all updates
  await Promise.all([
    client
      .update(userData)
      .set({ itemLoadout: loadout.id })
      .where(eq(userData.userId, user.userId)),
    ...equipPromises,
  ]);
  // Return
  const message =
    invalidItems.length > 0
      ? `Loadout selected. Warnings: ${invalidItems.join(", ")}`
      : "Loadout selected";

  return {
    success: true,
    message,
    items: useritems.filter((ui) => validItemIds.includes(ui.itemId)),
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

export const fetchUserItems = async (client: DrizzleClient, userId: string) => {
  const useritems = await client.query.userItem.findMany({
    where: and(eq(userItem.userId, userId)),
    with: { item: true, imbuements: { with: { item: true } } },
  });
  return useritems.filter((ui) => ui.item && !ui.item.hidden);
};

export const fetchUserItem = async (
  client: DrizzleClient,
  userId: string,
  userItemId: string,
) => {
  return await client.query.userItem.findFirst({
    where: and(eq(userItem.userId, userId), eq(userItem.id, userItemId)),
    with: { item: true },
  });
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
  // Check bloodline item limit - only one item with a bloodline can be equipped
  if (doEquip && info.bloodlineId) {
    const equippedBloodlineItems = newUserItems.filter(
      (ui) => ui.equipped !== "NONE" && ui.id !== useritem.id && ui.item.bloodlineId,
    );
    if (equippedBloodlineItems.length > 0) {
      return errorResponse("You can only equip one item with a bloodline requirement");
    }
  }
  // Check hand slot armor limit - only one armor item can be equipped in hand slots
  if (doEquip && info.itemType === "ARMOR" && info.slot === "HAND") {
    const equippedHandArmors = newUserItems.filter(
      (ui) =>
        ui.equipped !== "NONE" &&
        ui.id !== useritem.id &&
        (ui.equipped === "HAND_1" || ui.equipped === "HAND_2") &&
        ui.item.itemType === "ARMOR",
    );
    if (equippedHandArmors.length > 0) {
      return errorResponse("You can only equip one armor item in your hand slots");
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
        .where(eq(userItem.id, useritem.id)),
      ...(userItemInSlot
        ? [
            client
              .update(userItem)
              .set({ equipped: "NONE" })
              .where(eq(userItem.id, userItemInSlot.id)),
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
        .where(eq(userItem.id, useritem.id)),
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
    orderBy: (table) => desc(table.createdAt),
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
    where: and(eq(userItem.id, userItemId), eq(userItem.userId, userId)),
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

  // Update current stack and create new stack in parallel
  await Promise.all([
    client
      .update(userItem)
      .set({ quantity: quantityToKeep })
      .where(eq(userItem.id, userItemId)),
    client.insert(userItem).values({
      id: newUserItemId,
      userId: currentUserItem.userId,
      itemId: currentUserItem.itemId,
      quantity: quantityToSplit,
      durability: currentUserItem.durability,
      equipped: "NONE",
      storedAtHome: currentUserItem.storedAtHome,
      isInAuction: false,
      craftingFinishedAt: currentUserItem.craftingFinishedAt,
      dropChancePerc: currentUserItem.dropChancePerc,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  ]);

  return {
    success: true,
    message: `Split stack: kept ${quantityToKeep}, created new stack with ${quantityToSplit}`,
    newUserItemId,
    quantityToSplit,
  };
};

// --- Stack merge (used by mergeStacks / mergeAllStacks; kept at bottom with other helpers)

type ItemRowForMerge = NonNullable<Awaited<ReturnType<typeof fetchItem>>>;

type MergeEligibleUserItemForStackMerge = Pick<
  UserItem,
  | "id"
  | "itemId"
  | "userId"
  | "quantity"
  | "equipped"
  | "storedAtHome"
  | "craftingFinishedAt"
  | "isInAuction"
> & { imbuements: readonly unknown[] };

type PreloadedStackMergePayload = {
  userItems: MergeEligibleUserItemForStackMerge[];
  item: ItemRowForMerge | undefined;
};

type MergeStacksExecutionResult =
  | { success: true; didMerge: boolean; message: string }
  | { success: false; didMerge: false; message: string };

type UserItemMergeBucketRow = Pick<
  UserItem,
  "id" | "quantity" | "equipped" | "storedAtHome"
>;

const mergeStacksBucketKey = (row: Pick<UserItem, "storedAtHome" | "equipped">) =>
  `${row.storedAtHome ? "home" : "carry"}:${row.equipped}`;

/**
 * Merges stacks only within the same inventory bucket (`storedAtHome` + `equipped`) so
 * merge never deletes an equipped row while keeping a backpack copy (or mixes home vs carried).
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

  const updatePromises = itemsToKeep.flatMap((item, index) => {
    const targetQuantity = targetQuantityForKeepIndex(index);
    if (item.quantity === targetQuantity) {
      return [];
    }
    return [
      drizzle
        .update(userItem)
        .set({ quantity: targetQuantity })
        .where(
          and(
            eq(userItem.id, item.id),
            eq(userItem.userId, userId),
            eq(userItem.isInAuction, false),
            eq(userItem.quantity, item.quantity),
            eq(userItem.equipped, item.equipped),
            eq(userItem.storedAtHome, item.storedAtHome),
          ),
        ),
    ];
  });

  const deletePromises = itemsToDelete.map((item) =>
    drizzle
      .delete(userItem)
      .where(
        and(
          eq(userItem.id, item.id),
          eq(userItem.userId, userId),
          eq(userItem.isInAuction, false),
          eq(userItem.quantity, item.quantity),
          eq(userItem.equipped, item.equipped),
          eq(userItem.storedAtHome, item.storedAtHome),
        ),
      ),
  );

  // rowsAffected may be 0 if another request already merged (same guarded WHERE); still success.
  try {
    await Promise.all([...updatePromises, ...deletePromises]);
  } catch (err: unknown) {
    if (err instanceof TypeError || err instanceof ReferenceError) {
      throw err;
    }
    if (err instanceof Error) {
      return {
        success: false,
        didMerge: false,
        message: `Failed to merge stacks of ${itemName}`,
      };
    }
    throw err;
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
 * Home storage is not merged here; players move items to carried first.
 *
 * **Buckets:** Each `(storedAtHome, equipped)` group merges separately so equipped and
 * backpack rows are never consolidated into one row.
 *
 * **mergeAllStacks** passes `preloaded` rows already limited to carried, non-auction stacks.
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
      (r) => r.userId === userId && r.itemId === itemId,
    );
  } else {
    const [fetchedInfo, fetchedUserItems] = await Promise.all([
      fetchItem(drizzle, itemId),
      drizzle.query.userItem.findMany({
        where: and(
          eq(userItem.userId, userId),
          eq(userItem.itemId, itemId),
          eq(userItem.storedAtHome, false),
          eq(userItem.isInAuction, false),
        ),
        with: { imbuements: true },
      }),
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
