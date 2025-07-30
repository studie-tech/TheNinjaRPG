import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { createTRPCRouter, protectedProcedure, errorResponse } from "@/server/api/trpc";
import { userData, userItem, item, userItemImbuement } from "@/drizzle/schema";
import { fetchUser, fetchUpdatedUser } from "@/server/api/routers/profile";
import { getShrineBoost } from "@/utils/village";
import {
  fetchItemWithCraftingRequirements,
  fetchUserItems,
} from "@/server/api/routers/item";
import {
  OCCUPATIONS,
  OCCUPATION_CHANGE_COOLDOWN_DAYS,
  CRAFTING_TIMES_MINS,
  CRAFTING_EXP_GAIN,
} from "@/drizzle/constants";
import {
  getCraftingRank,
  getTotalItemQuantity,
  calculateItemConsumption,
  getEffectiveMaxImbuements,
} from "@/libs/crafting";
import { nanoid } from "nanoid";
import { baseServerResponse } from "@/server/api/trpc";
import { canChangeContent } from "@/utils/permissions";

export const occupationRouter = createTRPCRouter({
  getCraftableItems: protectedProcedure.query(async ({ ctx }) => {
    return await ctx.drizzle.query.item.findMany({
      where: eq(item.canBeCrafted, true),
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
    .input(z.object({ occupation: z.enum(OCCUPATIONS) }))
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
    .input(z.object({ itemId: z.string() }))
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
        (item) =>
          item.itemId === input.itemId &&
          item.craftingFinishedAt &&
          item.craftingFinishedAt > new Date(),
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
      const craftingTime =
        CRAFTING_TIMES_MINS[userCraftingRank][itemWithRequirements.rarity];
      // Guards
      if (craftingTime === 0) {
        return errorResponse(
          `You need to be at least ${itemWithRequirements.rarity === "EPIC" ? "Apprentice" : "Master"} rank to craft ${itemWithRequirements.rarity} items`,
        );
      }
      // Validate user has enough materials using collapsed quantities
      for (const requirement of itemWithRequirements.craftingRequirements) {
        const totalQuantity = getTotalItemQuantity(
          useritems,
          requirement.requirementItemId,
        );
        if (totalQuantity < requirement.quantity) {
          const itemName = requirement.requirementItem?.name || "Unknown item";
          return errorResponse(
            `You need ${requirement.quantity} ${itemName} (you have ${totalQuantity})`,
          );
        }
      }

      // See if we have a shrine boost, add it to crafting time in case
      const sectors = user.village?.sectors?.length || 0;
      const shrineBoost = getShrineBoost(sectors, "Crafting", user.village);
      const shrineBoostFactor = shrineBoost ? 1 - shrineBoost : 1;
      const craftSeconds = craftingTime * 60 * shrineBoostFactor;

      // Calculate crafting finish time
      const finishTime = new Date(Date.now() + craftSeconds * 1000);

      // Execute crafting: consume materials and create crafting item
      // Calculate consumption for each requirement
      const allConsumptions = [];
      for (const requirement of itemWithRequirements.craftingRequirements) {
        const consumption = calculateItemConsumption(
          useritems,
          requirement.requirementItemId,
          requirement.quantity,
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

      // Create crafting item entry (quantity 0 initially, will be 1 when finished)
      const craftingItemInsert = ctx.drizzle.insert(userItem).values({
        id: nanoid(),
        userId: ctx.userId,
        itemId: input.itemId,
        quantity: 1,
        craftingFinishedAt: finishTime,
      });

      // Award crafting experience (small amount when starting)
      const expUpdate = ctx.drizzle
        .update(userData)
        .set({
          craftingExperience: sql`${userData.craftingExperience} + ${CRAFTING_EXP_GAIN[userCraftingRank]}`,
        })
        .where(eq(userData.userId, ctx.userId));

      await Promise.all([...materialUpdates, craftingItemInsert, expUpdate]);

      return {
        success: true,
        message: `Started crafting ${itemWithRequirements.name}. It will be ready in ${craftSeconds} seconds.`,
        finishTime: finishTime.toISOString(),
      };
    }),

  imbueItem: protectedProcedure
    .input(
      z.object({
        userItemId: z.string(),
        userCrystalItemId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Run all initial queries in parallel
      const [user, userItems] = await Promise.all([
        // Get user data
        fetchUser(ctx.drizzle, ctx.userId),
        // Get all user items (like in crafting)
        fetchUserItems(ctx.drizzle, ctx.userId),
      ]);

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
      if (crystalItem.itemType !== "CRYSTAL") {
        return errorResponse("Selected item is not a crystal");
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

      // Award small amount of crafting experience
      const expUpdate = ctx.drizzle
        .update(userData)
        .set({
          craftingExperience: sql`${userData.craftingExperience} + ${CRAFTING_EXP_GAIN[userCraftingRank] / 2}`,
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
});
