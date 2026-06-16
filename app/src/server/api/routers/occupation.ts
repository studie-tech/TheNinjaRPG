import { and, eq, isNull, ne, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  CLAN_BOOST_MAX_LEVEL,
  CLAN_BOOST_PERCENT_PER_LEVEL,
  CONSUMABLE_CRAFTING_TIMES_MINS,
  CRAFTING_TIMES_MINS,
  MAP_WAKE_ISLAND_SECTOR,
  OCCUPATION_CHANGE_COOLDOWN_DAYS,
  OCCUPATIONS,
} from "@/drizzle/constants";
import { item, userData, userItem, userItemImbuement } from "@/drizzle/schema";
import {
  calculateItemConsumption,
  getCraftingRank,
  getEffectiveMaxImbuements,
  getTotalItemQuantity,
} from "@/libs/crafting";
import { filterQuestTrackersForDbPersist, getNewTrackers } from "@/libs/quest";
import { cancelCraftQueueEntry, enqueueCraft, getCraftQueueStatus } from "@/libs/queue";
import {
  fetchItemWithCraftingRequirements,
  fetchUserItems,
} from "@/server/api/routers/item";
import { fetchUpdatedUser, fetchUser } from "@/server/api/routers/profile";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  serverError,
} from "@/server/api/trpc";
import {
  claimUserSnapshot,
  updateUserItemQuantityAtomically,
} from "@/server/utils/concurrency";
import { canChangeContent } from "@/utils/permissions";
import { formatSecondsToTimeDisplay } from "@/utils/time";
import { getShrineBoost } from "@/utils/village";
import { activityQueueStatusSchema } from "@/validators/queue";

export const occupationRouter = createTRPCRouter({
  getCraftQueue: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Get crafting queue status" } })
    .output(activityQueueStatusSchema)
    .query(async ({ ctx }) => {
      const { user } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
      });
      if (!user) throw serverError("NOT_FOUND", "User not found");
      return getCraftQueueStatus(ctx.drizzle, user);
    }),

  enqueueCraft: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Start or queue crafting an item" } })
    .input(
      z.object({
        itemId: z.string(),
        quantity: z.int().min(1).max(10).prefault(1),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const result = await enqueueCraft(
        ctx.drizzle,
        ctx.userId,
        input.itemId,
        input.quantity,
      );
      if (!result.success) return errorResponse(result.message);
      return { success: true, message: result.message };
    }),

  cancelCraftQueueEntry: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Cancel a queued craft entry" } })
    .input(z.object({ queueId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const result = await cancelCraftQueueEntry(
        ctx.drizzle,
        ctx.userId,
        input.queueId,
      );
      if (!result.success) return errorResponse(result.message);
      return { success: true, message: result.message };
    }),

  getCraftableItems: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Get all craftable items" } })
    .query(async ({ ctx }) => {
      return await ctx.drizzle.query.item.findMany({
        where: sql`${item.canBeCrafted} = true AND ${item.hidden} = false`,
        with: {
          craftingRequirements: {
            with: {
              requirementItem: true,
            },
          },
        },
      });
    }),

  selectOccupation: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Select a crafting occupation" } })
    .input(z.object({ occupation: z.enum(OCCUPATIONS) }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);

      // Guard
      if (user.occupation && user.occupationSignupAt) {
        const daysSinceSignup = Math.floor(
          (Date.now() - user.occupationSignupAt.getTime()) / (1000 * 60 * 60 * 24),
        );

        if (
          daysSinceSignup < OCCUPATION_CHANGE_COOLDOWN_DAYS &&
          !canChangeContent(user.role)
        ) {
          const daysRemaining = OCCUPATION_CHANGE_COOLDOWN_DAYS - daysSinceSignup;
          return errorResponse(
            `You must wait ${daysRemaining} more day(s) before changing occupations`,
          );
        }
      }

      // Update user occupation
      await ctx.drizzle
        .update(userData)
        .set({ occupation: input.occupation, occupationSignupAt: sql`NOW()` })
        .where(eq(userData.userId, ctx.userId));

      return { success: true, message: "Occupation selected successfully!" };
    }),

  craftItem: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Craft an item using materials" } })
    .input(
      z.object({
        itemId: z.string(),
        quantity: z.int().min(1).max(10).prefault(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await enqueueCraft(
        ctx.drizzle,
        ctx.userId,
        input.itemId,
        input.quantity,
      );
      if (!result.success) return errorResponse(result.message);
      return { success: true, message: result.message };
    }),

  imbueItem: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Imbue an item with a crystal" } })
    .input(
      z.object({
        userItemId: z.string(),
        userCrystalItemId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Run all initial queries in parallel
      const [updatedUserResult, userItems] = await Promise.all([
        // Get user data
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        // Get all user items (like in crafting)
        fetchUserItems(ctx.drizzle, ctx.userId),
      ]);

      // Guards
      const user = updatedUserResult.user;
      if (!user) return errorResponse("User not found");
      if (user.status !== "AWAKE") {
        return errorResponse("User is not awake");
      }
      if (user.sector === MAP_WAKE_ISLAND_SECTOR) {
        return errorResponse("Cannot imbue items on Wake Island");
      }

      // Find target item and crystal from user items
      const targetUserItem = userItems.find((ui) => ui.id === input.userItemId);
      const crystalUserItem = userItems.find((ui) => ui.id === input.userCrystalItemId);
      const crystalItem = crystalUserItem?.item;

      // Derived
      const userCraftingRank = getCraftingRank(user.craftingExperience);
      const maxImbuedItems = getEffectiveMaxImbuements(
        userCraftingRank,
        targetUserItem?.item?.maxImbueNumber || 1,
      );
      const curImbuingItemsCount = userItems.filter(
        (ui) =>
          ui.imbuements.length > 0 &&
          ui.imbuements.some(
            (imbuement) =>
              imbuement.craftingFinishedAt &&
              new Date(imbuement.craftingFinishedAt) > new Date(),
          ),
      ).length;

      // Guards
      if (user.occupation !== "CRAFTING") {
        return errorResponse("You must have the Crafting occupation to imbue items");
      }
      if (!targetUserItem) {
        return errorResponse("Target item not found");
      }
      if (!crystalUserItem) {
        return errorResponse("Crystal not found");
      }
      if (!crystalItem) {
        return errorResponse("Crystal item data not found");
      }
      if (crystalUserItem.quantity <= 0) {
        return errorResponse("You don't have this crystal");
      }
      if (
        crystalUserItem.craftingFinishedAt &&
        new Date(crystalUserItem.craftingFinishedAt) > new Date()
      ) {
        return errorResponse("You cannot use a crystal that is still being crafted");
      }
      if (crystalItem.itemType !== "CRYSTAL") {
        return errorResponse("Selected item is not a crystal");
      }
      if (crystalItem.crystalTargetTypes) {
        if (crystalItem.crystalTargetTypes !== targetUserItem.item?.itemType) {
          return errorResponse(
            `This crystal can only be applied to ${crystalItem.crystalTargetTypes} items`,
          );
        }
      }
      if (!targetUserItem.item?.canBeImbued) {
        return errorResponse("This item cannot be imbued");
      }
      if (targetUserItem.equipped !== "NONE") {
        return errorResponse("You cannot imbue an equipped item");
      }
      if (curImbuingItemsCount > 0) {
        return errorResponse(
          "You are already imbuing an item. Please wait for it to finish.",
        );
      }
      if (targetUserItem.imbuements.length >= maxImbuedItems) {
        return errorResponse(
          `You have reached the maximum number of crystals for this item (${maxImbuedItems})`,
        );
      }
      if (
        targetUserItem.imbuements.some((imb) => imb.imbuementItemId === crystalItem.id)
      ) {
        return errorResponse(`This item already has a ${crystalItem.name} imbuement`);
      }
      // Derived
      const imbuingTime = CRAFTING_TIMES_MINS[userCraftingRank][crystalItem.rarity];
      const finishTime = new Date(Date.now() + imbuingTime * 60 * 1000);

      // Check rarity
      if (imbuingTime === 0) {
        return errorResponse(
          `You need to be at least ${crystalItem.rarity === "EPIC" ? "Apprentice" : "Master"} rank to imbue ${crystalItem.rarity} crystals`,
        );
      }

      // CAS + atomic crystal consume serialize parallel imbues on the same account.
      const imbueClaimResult = await claimUserSnapshot({
        client: ctx.drizzle,
        userId: ctx.userId,
        updatedAt: user.updatedAt,
        where: [
          eq(userData.status, "AWAKE"),
          or(isNull(userData.sector), ne(userData.sector, MAP_WAKE_ISLAND_SECTOR)),
        ],
      });
      if (!imbueClaimResult.success) {
        return errorResponse(
          "Could not start imbuing — state changed, please try again",
        );
      }

      // Write-time guard: only proceed if item is still not in auction (atomic)
      const notInAuctionGuard = await ctx.drizzle
        .update(userItem)
        .set({ updatedAt: new Date() })
        .where(
          and(
            eq(userItem.id, input.userItemId),
            eq(userItem.userId, ctx.userId),
            eq(userItem.isInAuction, false),
          ),
        );
      if (notInAuctionGuard.rowsAffected === 0) {
        return errorResponse(
          "You cannot imbue an item that is listed for auction or direct sale",
        );
      }

      const consumeCrystal = await updateUserItemQuantityAtomically({
        client: ctx.drizzle,
        userId: ctx.userId,
        userItemId: crystalUserItem.id,
        expectedQuantity: crystalUserItem.quantity,
        nextQuantity: crystalUserItem.quantity - 1,
      });
      if (!consumeCrystal) {
        return errorResponse("Crystal no longer available");
      }

      const createImbuement = ctx.drizzle.insert(userItemImbuement).values({
        id: nanoid(),
        userItemId: input.userItemId,
        imbuementItemId: crystalItem.id,
        craftingFinishedAt: finishTime,
      });

      // Award small amount of crafting experience (half of crystal's crafting experience, or 0 if not set)
      // Apply clan crafting experience boost (only for real clans, not outlaw factions/towns)
      const clanCraftingExpBoost = user.isOutlaw
        ? 0
        : (user.clan?.craftingExpBoost ?? 0) / 100;
      const baseExpGain = Math.floor((crystalItem.craftingExperience ?? 0) / 2);
      const expGain = Math.floor(baseExpGain * (1 + clanCraftingExpBoost));
      // Update trackers with crafting experience gained
      const { trackers } = getNewTrackers(user, [
        { task: "crafting_experience_gained", increment: expGain },
      ]);
      const questDataForDb = filterQuestTrackersForDbPersist(trackers, user);
      const expUpdate = ctx.drizzle
        .update(userData)
        .set({
          craftingExperience: sql`${userData.craftingExperience} + ${expGain}`,
          questData: questDataForDb,
        })
        .where(
          and(
            eq(userData.userId, ctx.userId),
            eq(userData.status, "AWAKE"),
            or(isNull(userData.sector), ne(userData.sector, MAP_WAKE_ISLAND_SECTOR)),
          ),
        );

      const [, expResult] = await Promise.all([createImbuement, expUpdate]);
      if (!expResult || expResult.rowsAffected !== 1) {
        return errorResponse(
          "Could not start imbuing — you must be awake and not on Wake Island",
        );
      }

      return {
        success: true,
        message: `Started imbuing ${targetUserItem.item.name} with ${crystalItem.name}. It will be ready in ${imbuingTime} minutes.`,
        finishTime: finishTime.toISOString(),
      };
    }),

  finishCraftingImmediately: protectedProcedure
    .input(z.object({ userItemId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Queries
      const [user, userItems] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUserItems(ctx.drizzle, ctx.userId),
      ]);
      // Find the crafting item
      const craftingItem = userItems.find((ui) => ui.id === input.userItemId);
      // Guards
      if (!canChangeContent(user.role)) {
        return errorResponse(
          "You do not have permission to finish crafting immediately",
        );
      }
      if (!craftingItem) {
        return errorResponse("Crafting item not found");
      }
      if (!craftingItem.craftingFinishedAt) {
        return errorResponse("This item is not being crafted");
      }
      if (craftingItem.craftingFinishedAt <= new Date()) {
        return errorResponse("This item has already finished crafting");
      }
      // Immediately finish the crafting by setting the finish time to now
      await ctx.drizzle
        .update(userItem)
        .set({ craftingFinishedAt: new Date() })
        .where(eq(userItem.id, input.userItemId));
      return {
        success: true,
        message: `Immediately finished crafting ${craftingItem.item.name}`,
      };
    }),

  finishImbuingImmediately: protectedProcedure
    .input(z.object({ userItemImbuementId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Queries
      const [user, userItems] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUserItems(ctx.drizzle, ctx.userId),
      ]);
      // Find the imbuing item
      const imbuingItem = userItems.find((ui) =>
        ui.imbuements.some((imbuement) => imbuement.id === input.userItemImbuementId),
      );
      const imbuingImbuement = imbuingItem?.imbuements.find(
        (imbuement) => imbuement.id === input.userItemImbuementId,
      );
      // Guards
      if (!canChangeContent(user.role)) {
        return errorResponse(
          "You do not have permission to finish imbuing immediately",
        );
      }
      if (!imbuingItem || !imbuingImbuement) {
        return errorResponse("Imbuing item not found");
      }
      if (!imbuingImbuement.craftingFinishedAt) {
        return errorResponse("This item is not being imbued");
      }
      if (imbuingImbuement.craftingFinishedAt <= new Date()) {
        return errorResponse("This item has already finished imbuing");
      }
      // Immediately finish the imbuing by setting the finish time to now
      await ctx.drizzle
        .update(userItemImbuement)
        .set({ craftingFinishedAt: new Date() })
        .where(eq(userItemImbuement.id, input.userItemImbuementId));
      return {
        success: true,
        message: `Immediately finished imbuing ${imbuingItem.item.name}`,
      };
    }),

  removeImbuement: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Remove an imbuement from an item" } })
    .input(z.object({ userItemImbuementId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Queries
      const [userItems, imbuement] = await Promise.all([
        fetchUserItems(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.userItemImbuement.findFirst({
          where: eq(userItemImbuement.id, input.userItemImbuementId),
          with: {
            userItem: {
              with: { item: true },
            },
            item: true,
          },
        }),
      ]);

      // Guards
      if (!imbuement) {
        return errorResponse("Imbuement not found");
      }

      // Check if the user owns this item
      const userItem = userItems.find((ui) => ui.id === imbuement.userItemId);
      if (!userItem) {
        return errorResponse("You don't own this item");
      }

      // Check if item is equipped
      if (userItem.equipped !== "NONE") {
        return errorResponse("Cannot remove imbuement from equipped item");
      }

      // Check if imbuement is still being crafted
      if (imbuement.craftingFinishedAt && imbuement.craftingFinishedAt > new Date()) {
        return errorResponse("Cannot remove imbuement that is still being crafted");
      }

      // Remove the imbuement
      await ctx.drizzle
        .delete(userItemImbuement)
        .where(eq(userItemImbuement.id, input.userItemImbuementId));

      return {
        success: true,
        message: `Removed ${imbuement.item.name} from ${userItem.item.name}`,
      };
    }),
});
