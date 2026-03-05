import { eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  CLAN_BOOST_MAX_LEVEL,
  CLAN_BOOST_PERCENT_PER_LEVEL,
  CONSUMABLE_CRAFTING_TIMES_MINS,
  CRAFTING_TIMES_MINS,
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
import { getNewTrackers } from "@/libs/quest";
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
} from "@/server/api/trpc";
import { canChangeContent } from "@/utils/permissions";
import { formatSecondsToTimeDisplay } from "@/utils/time";
import { getShrineBoost } from "@/utils/village";

export const occupationRouter = createTRPCRouter({
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
      // Run all initial queries in parallel
      const [{ user }, itemWithRequirements, useritems] = await Promise.all([
        // Get user data
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        // Get item to craft with its requirements
        fetchItemWithCraftingRequirements(ctx.drizzle, input.itemId),
        // Check if user is already crafting something
        fetchUserItems(ctx.drizzle, ctx.userId),
      ]);
      // Derived
      const currentlyCrafting = useritems.find(
        (item) => item.craftingFinishedAt && item.craftingFinishedAt > new Date(),
      );
      // Guards
      if (!user) return errorResponse("User not found");
      if (user.occupation !== "CRAFTING") {
        return errorResponse("You must have the Crafting occupation to craft items");
      }
      if (!itemWithRequirements) {
        return errorResponse("Item not found");
      }
      if (currentlyCrafting) {
        return errorResponse(
          "You are already crafting an item. Please wait for it to finish.",
        );
      }
      if (itemWithRequirements.hidden) {
        return errorResponse("This item is hidden and cannot be crafted");
      }
      if (!itemWithRequirements.canBeCrafted) {
        return errorResponse("This item is not craftable");
      }
      if (itemWithRequirements.craftingRequirements.length === 0) {
        return errorResponse("This item cannot be crafted (no requirements defined)");
      }
      // Derived
      const userCraftingRank = getCraftingRank(user.craftingExperience);
      // Check rank eligibility using rank-based crafting times
      const rankCraftingTime =
        CRAFTING_TIMES_MINS[userCraftingRank][itemWithRequirements.rarity];
      // Consumables have static crafting times that don't scale with rank
      const craftingTime =
        itemWithRequirements.itemType === "CONSUMABLE"
          ? CONSUMABLE_CRAFTING_TIMES_MINS[itemWithRequirements.rarity]
          : rankCraftingTime;
      // Guards - check rank eligibility regardless of item type
      if (rankCraftingTime === 0) {
        const requiredRank =
          itemWithRequirements.rarity === "RARE"
            ? "Apprentice"
            : itemWithRequirements.rarity === "EPIC"
              ? "Master"
              : itemWithRequirements.rarity === "LEGENDARY"
                ? "Forgemaster"
                : "Unknown";
        return errorResponse(
          `You need to be at least ${requiredRank} rank to craft ${itemWithRequirements.rarity} items`,
        );
      }
      // Validate user has enough materials using collapsed quantities
      for (const requirement of itemWithRequirements.craftingRequirements) {
        const totalQuantity = getTotalItemQuantity(
          useritems,
          requirement.requirementItemId,
        );
        const requiredQuantity = requirement.quantity * input.quantity;
        if (totalQuantity < requiredQuantity) {
          const itemName = requirement.requirementItem?.name || "Unknown item";
          return errorResponse(
            `You need ${requiredQuantity} ${itemName} (you have ${totalQuantity})`,
          );
        }
      }

      // See if we have a shrine boost, add it to crafting time in case
      const sectors = user.village?.sectors?.length || 0;
      const shrineBoost = getShrineBoost(sectors, "Crafting", user.village);
      const shrineBoostFactor = shrineBoost ? 1 - shrineBoost : 1;
      // Clan crafting time reduction (percentage stored in clan object)
      // Max boost is 20% (10 levels × 2%), clamp as safety guard
      // Only apply for real clans, not outlaw factions/towns
      const clanCraftingTimeBoostCap =
        (CLAN_BOOST_MAX_LEVEL * CLAN_BOOST_PERCENT_PER_LEVEL) / 100;
      const clanCraftingTimeBoost = user.isOutlaw
        ? 0
        : Math.min((user.clan?.craftingTimeBoost ?? 0) / 100, clanCraftingTimeBoostCap);
      const clanCraftingTimeFactor = 1 - clanCraftingTimeBoost;
      const craftSeconds = Math.round(
        craftingTime * 60 * shrineBoostFactor * clanCraftingTimeFactor * input.quantity,
      );

      // Calculate crafting finish time
      const finishTime = new Date(Date.now() + craftSeconds * 1000);

      // Execute crafting: consume materials and create crafting item
      // Calculate consumption for each requirement
      const allConsumptions = [];
      for (const requirement of itemWithRequirements.craftingRequirements) {
        const requiredQuantity = requirement.quantity * input.quantity;
        const consumption = calculateItemConsumption(
          useritems,
          requirement.requirementItemId,
          requiredQuantity,
        );
        if (!consumption.hasEnough) {
          const itemName = requirement.requirementItem?.name || "Unknown item";
          return errorResponse(`Insufficient ${itemName} for crafting`);
        }
        allConsumptions.push(...consumption.consumptions);
      }

      // Create database operations for consuming materials
      const materialUpdates = allConsumptions.map((consumption) => {
        if (consumption.newQuantity <= 0) {
          return ctx.drizzle
            .delete(userItem)
            .where(eq(userItem.id, consumption.userItemId));
        } else {
          return ctx.drizzle
            .update(userItem)
            .set({ quantity: consumption.newQuantity })
            .where(eq(userItem.id, consumption.userItemId));
        }
      });

      // Create crafting item entry/entries
      // Respect stackSize limit when creating items
      const craftingItemInserts = [];
      if (itemWithRequirements.stackSize === 1) {
        // Create separate items for non-stackable items
        for (let i = 0; i < input.quantity; i++) {
          craftingItemInserts.push(
            ctx.drizzle.insert(userItem).values({
              id: nanoid(),
              userId: ctx.userId,
              itemId: input.itemId,
              quantity: 1,
              craftingFinishedAt: finishTime,
            }),
          );
        }
      } else {
        // Create stacked items respecting stackSize limit
        let remainingQuantity = input.quantity;
        while (remainingQuantity > 0) {
          const stackQuantity = Math.min(
            remainingQuantity,
            itemWithRequirements.stackSize,
          );
          craftingItemInserts.push(
            ctx.drizzle.insert(userItem).values({
              id: nanoid(),
              userId: ctx.userId,
              itemId: input.itemId,
              quantity: stackQuantity,
              craftingFinishedAt: finishTime,
            }),
          );
          remainingQuantity -= stackQuantity;
        }
      }

      // Award crafting experience (from item config, or 0 if not set)
      // Apply clan crafting experience boost (only for real clans, not outlaw factions/towns)
      const clanCraftingExpBoost = user.isOutlaw
        ? 0
        : (user.clan?.craftingExpBoost ?? 0) / 100;
      const baseExpGain =
        (itemWithRequirements.craftingExperience ?? 0) * input.quantity;
      const expGain = Math.floor(baseExpGain * (1 + clanCraftingExpBoost));
      // Update trackers with crafting experience gained
      const { trackers } = getNewTrackers(user, [
        { task: "crafting_experience_gained", increment: expGain },
      ]);
      const expUpdate = ctx.drizzle
        .update(userData)
        .set({
          craftingExperience: sql`${userData.craftingExperience} + ${expGain}`,
          questData: trackers,
        })
        .where(eq(userData.userId, ctx.userId));

      await Promise.all([...materialUpdates, ...craftingItemInserts, expUpdate]);

      return {
        success: true,
        message: `Started crafting ${input.quantity}x ${itemWithRequirements.name}. ${expGain > 0 ? `+${expGain} EXP.` : ""} Ready in ${formatSecondsToTimeDisplay(craftSeconds)}.`,
        finishTime: finishTime.toISOString(),
      };
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
      if (targetUserItem.isInAuction) {
        return errorResponse(
          "You cannot imbue an item that is listed for auction or direct sale",
        );
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
      // Derived
      const imbuingTime = CRAFTING_TIMES_MINS[userCraftingRank][crystalItem.rarity];
      const finishTime = new Date(Date.now() + imbuingTime * 60 * 1000);

      // Check rarity
      if (imbuingTime === 0) {
        return errorResponse(
          `You need to be at least ${crystalItem.rarity === "EPIC" ? "Apprentice" : "Master"} rank to imbue ${crystalItem.rarity} crystals`,
        );
      }

      // Consume the crystal and create the imbuement
      const consumeCrystal =
        crystalUserItem.quantity > 1
          ? ctx.drizzle
              .update(userItem)
              .set({ quantity: crystalUserItem.quantity - 1 })
              .where(eq(userItem.id, crystalUserItem.id))
          : ctx.drizzle.delete(userItem).where(eq(userItem.id, crystalUserItem.id));

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
      const expUpdate = ctx.drizzle
        .update(userData)
        .set({
          craftingExperience: sql`${userData.craftingExperience} + ${expGain}`,
          questData: trackers,
        })
        .where(eq(userData.userId, ctx.userId));

      await Promise.all([consumeCrystal, createImbuement, expUpdate]);

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
