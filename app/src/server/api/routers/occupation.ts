import { and, eq, gt, isNull, ne, or, sql } from "drizzle-orm";
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
import {
  getInventoryBucket,
  getInventoryBucketCapacity,
  getInventoryBucketFullMessage,
} from "@/libs/item";
import { filterQuestTrackersForDbPersist, getNewTrackers } from "@/libs/quest";
import { fetchUpdatedUser, fetchUser } from "@/routers/profile";
import {
  fetchItemWithCraftingRequirements,
  fetchUserItems,
} from "@/server/api/routers/item";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
} from "@/server/api/trpc";
import { getNextUserSnapshotAt } from "@/server/utils/concurrency";
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
      // Read userData before inventory. Every capacity mutation commits both rows
      // atomically and bumps updatedAt, so this ordering gives the later CAS a
      // consistent boundary even when another request commits between the reads.
      const { user } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
      });
      const [itemWithRequirements, useritems] = await Promise.all([
        fetchItemWithCraftingRequirements(ctx.drizzle, input.itemId),
        fetchUserItems(ctx.drizzle, ctx.userId),
      ]);
      // Derived
      const currentlyCrafting = useritems.find(
        (item) => item.craftingFinishedAt && item.craftingFinishedAt > new Date(),
      );
      // Guards
      if (!user) return errorResponse("User not found");
      if (user.status !== "AWAKE") {
        return errorResponse("User is not awake");
      }
      if (user.sector === MAP_WAKE_ISLAND_SECTOR) {
        return errorResponse("Cannot craft items on Wake Island");
      }
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
      if (itemWithRequirements.parentItemId) {
        return errorResponse("Evolution items cannot be crafted; they must be evolved");
      }
      if (itemWithRequirements.craftingRequirements.length === 0) {
        return errorResponse("This item cannot be crafted (no requirements defined)");
      }
      // Crafted output is added as new carried stacks, so reserve enough room in
      // the dedicated cooking bucket before consuming any materials. The user
      // snapshot claim below serializes this check with other capacity-changing
      // mutations.
      const outputBucket = getInventoryBucket(itemWithRequirements);
      if (outputBucket === "cooking") {
        const carriedCookingStacks = useritems.filter(
          (ui) => !ui.storedAtHome && getInventoryBucket(ui.item) === "cooking",
        ).length;
        const newStacksRequired = Math.ceil(
          input.quantity / Math.max(1, itemWithRequirements.stackSize),
        );
        if (
          carriedCookingStacks + newStacksRequired >
          getInventoryBucketCapacity(outputBucket, user)
        ) {
          return errorResponse(getInventoryBucketFullMessage(outputBucket));
        }
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
      const allConsumptions: ReturnType<
        typeof calculateItemConsumption
      >["consumptions"] = [];
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

      // Create crafting item entry/entries
      // Respect stackSize limit when creating items
      const craftingItemValues: (typeof userItem.$inferInsert)[] = [];
      if (itemWithRequirements.stackSize === 1) {
        // Create separate items for non-stackable items
        for (let i = 0; i < input.quantity; i++) {
          craftingItemValues.push({
            id: nanoid(),
            userId: ctx.userId,
            itemId: input.itemId,
            quantity: 1,
            craftingFinishedAt: finishTime,
          });
        }
      } else {
        // Create stacked items respecting stackSize limit
        let remainingQuantity = input.quantity;
        while (remainingQuantity > 0) {
          const stackQuantity = Math.min(
            remainingQuantity,
            itemWithRequirements.stackSize,
          );
          craftingItemValues.push({
            id: nanoid(),
            userId: ctx.userId,
            itemId: input.itemId,
            quantity: stackQuantity,
            craftingFinishedAt: finishTime,
          });
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
      // Update trackers: crafting experience, total items crafted, and any
      // craft-this-specific-item objectives. Emitted here (behind the transaction's
      // craft CAS below) — NOT from the quest-reward EXP path
      // (quest.ts:367-377), which must stay experience-only to avoid double-counting.
      const { trackers } = getNewTrackers(user, [
        { task: "crafting_experience_gained", increment: expGain },
        { task: "items_crafted", increment: input.quantity },
        {
          task: "craft_specific_item",
          increment: input.quantity,
          contentId: input.itemId,
        },
      ]);
      const questDataForDb = filterQuestTrackersForDbPersist(trackers, user);
      const materialConflict = Symbol("materialConflict");
      try {
        const craftCommitted = await ctx.drizzle.transaction(async (tx) => {
          const claimResult = await tx
            .update(userData)
            .set({
              updatedAt: getNextUserSnapshotAt(user.updatedAt),
              craftingExperience: sql`${userData.craftingExperience} + ${expGain}`,
              questData: questDataForDb,
            })
            .where(
              and(
                eq(userData.userId, ctx.userId),
                eq(userData.updatedAt, user.updatedAt),
                eq(userData.status, "AWAKE"),
                or(
                  isNull(userData.sector),
                  ne(userData.sector, MAP_WAKE_ISLAND_SECTOR),
                ),
              ),
            );
          if (claimResult.rowsAffected !== 1) return false;

          for (const consumption of allConsumptions) {
            const expectedQuantity =
              consumption.consumeQuantity + consumption.newQuantity;
            const itemWhere = and(
              eq(userItem.id, consumption.userItemId),
              eq(userItem.userId, ctx.userId),
              eq(userItem.quantity, expectedQuantity),
            );
            const materialResult =
              consumption.newQuantity > 0
                ? await tx
                    .update(userItem)
                    .set({ quantity: consumption.newQuantity })
                    .where(itemWhere)
                : await tx.delete(userItem).where(itemWhere);
            if (materialResult.rowsAffected !== 1) throw materialConflict;
          }

          await tx.insert(userItem).values(craftingItemValues);
          return true;
        });
        if (!craftCommitted) {
          return errorResponse(
            "Could not start crafting — state changed, please try again",
          );
        }
      } catch (error) {
        if (error === materialConflict) {
          return errorResponse(
            "Could not start crafting — materials changed, please try again",
          );
        }
        throw error;
      }

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
      if (user.isBanned) return errorResponse("You are banned");
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
      if (targetUserItem.id === crystalUserItem.id) {
        return errorResponse("A crystal cannot be used to imbue itself");
      }
      if (crystalUserItem.quantity <= 0) {
        return errorResponse("You don't have this crystal");
      }
      if (crystalUserItem.isInAuction) {
        return errorResponse("You cannot use a crystal listed for auction");
      }
      if (crystalUserItem.storedAtHome) {
        return errorResponse("You must carry the crystal before using it");
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
      const targetConflict = Symbol("targetConflict");
      const crystalConflict = Symbol("crystalConflict");
      try {
        const imbueCommitted = await ctx.drizzle.transaction(async (tx) => {
          // This whole-user CAS serializes parallel imbuements on the account and commits the
          // experience/tracker update in the same transaction as inventory consumption.
          const claimResult = await tx
            .update(userData)
            .set({
              updatedAt: getNextUserSnapshotAt(user.updatedAt),
              craftingExperience: sql`${userData.craftingExperience} + ${expGain}`,
              questData: questDataForDb,
            })
            .where(
              and(
                eq(userData.userId, ctx.userId),
                eq(userData.updatedAt, user.updatedAt),
                eq(userData.status, "AWAKE"),
                or(
                  isNull(userData.sector),
                  ne(userData.sector, MAP_WAKE_ISLAND_SECTOR),
                ),
              ),
            );
          if (claimResult.rowsAffected !== 1) return false;

          // Recheck ownership, carried quantity, equipment and sale status at write time. This
          // also refuses stack-merge claims/tombstones before an imbuement can attach to the row.
          const targetResult = await tx
            .update(userItem)
            .set({ updatedAt: new Date() })
            .where(
              and(
                eq(userItem.id, input.userItemId),
                eq(userItem.userId, ctx.userId),
                gt(userItem.quantity, 0),
                eq(userItem.equipped, "NONE"),
                eq(userItem.isInAuction, false),
              ),
            );
          if (targetResult.rowsAffected !== 1) throw targetConflict;

          const crystalWhere = and(
            eq(userItem.id, crystalUserItem.id),
            eq(userItem.userId, ctx.userId),
            eq(userItem.quantity, crystalUserItem.quantity),
            eq(userItem.isInAuction, false),
            eq(userItem.storedAtHome, false),
          );
          const crystalResult =
            crystalUserItem.quantity > 1
              ? await tx
                  .update(userItem)
                  .set({ quantity: crystalUserItem.quantity - 1 })
                  .where(crystalWhere)
              : await tx.delete(userItem).where(crystalWhere);
          if (crystalResult.rowsAffected !== 1) throw crystalConflict;

          await tx.insert(userItemImbuement).values({
            id: nanoid(),
            userItemId: input.userItemId,
            imbuementItemId: crystalItem.id,
            craftingFinishedAt: finishTime,
          });
          return true;
        });
        if (!imbueCommitted) {
          return errorResponse(
            "Could not start imbuing — state changed, please try again",
          );
        }
      } catch (error) {
        if (error === targetConflict) {
          return errorResponse(
            "Target item changed, is equipped, or is listed for sale. Please try again.",
          );
        }
        if (error === crystalConflict) {
          return errorResponse("Crystal no longer available");
        }
        throw error;
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
      // Resolve only the parent identity before the transaction. All mutable authorization and
      // imbuement state is re-read under row locks below.
      const initialImbuement = await ctx.drizzle.query.userItemImbuement.findFirst({
        where: eq(userItemImbuement.id, input.userItemImbuementId),
        columns: { userItemId: true },
      });
      if (!initialImbuement) return errorResponse("Imbuement not found");

      return ctx.drizzle.transaction(async (tx) => {
        // Lock in user -> inventory row -> imbuement order, matching the account/inventory order
        // used by crafting writes. This serializes duplicate removals and prevents an equip or
        // auction transition from changing the parent between validation and deletion.
        await tx.execute(
          sql`SELECT ${userData.userId} FROM ${userData} WHERE ${userData.userId} = ${ctx.userId} FOR UPDATE`,
        );
        const user = await tx.query.userData.findFirst({
          where: eq(userData.userId, ctx.userId),
          columns: { isBanned: true, occupation: true, status: true },
        });
        if (!user) return errorResponse("User not found");
        if (user.isBanned) return errorResponse("You are banned");
        if (user.status !== "AWAKE") {
          return errorResponse("User is not awake");
        }
        if (user.occupation !== "CRAFTING") {
          return errorResponse(
            "You must have the Crafting occupation to remove imbuements",
          );
        }

        await tx.execute(
          sql`SELECT ${userItem.id} FROM ${userItem} WHERE ${userItem.id} = ${initialImbuement.userItemId} AND ${userItem.userId} = ${ctx.userId} FOR UPDATE`,
        );
        const ownedUserItem = await tx.query.userItem.findFirst({
          where: and(
            eq(userItem.id, initialImbuement.userItemId),
            eq(userItem.userId, ctx.userId),
          ),
          with: { item: true },
        });
        if (!ownedUserItem) return errorResponse("You don't own this item");
        if (ownedUserItem.equipped !== "NONE") {
          return errorResponse("Cannot remove imbuement from equipped item");
        }
        if (ownedUserItem.isInAuction) {
          return errorResponse("Cannot remove imbuement from an item in an auction");
        }

        await tx.execute(
          sql`SELECT ${userItemImbuement.id} FROM ${userItemImbuement} WHERE ${userItemImbuement.id} = ${input.userItemImbuementId} AND ${userItemImbuement.userItemId} = ${ownedUserItem.id} FOR UPDATE`,
        );
        const imbuement = await tx.query.userItemImbuement.findFirst({
          where: and(
            eq(userItemImbuement.id, input.userItemImbuementId),
            eq(userItemImbuement.userItemId, ownedUserItem.id),
          ),
          with: { item: true },
        });
        if (!imbuement) return errorResponse("Imbuement already removed");
        if (imbuement.craftingFinishedAt > new Date()) {
          return errorResponse("Cannot remove imbuement that is still being crafted");
        }

        // Legacy/content changes can make an item non-imbuable after a crystal was attached. In
        // that case removal refunds exactly one fresh carried crystal. Delete and refund are one
        // transaction so neither a failure nor a concurrent retry can lose or duplicate it.
        const returnsCrystal = !ownedUserItem.item.canBeImbued;
        const deleteResult = await tx
          .delete(userItemImbuement)
          .where(
            and(
              eq(userItemImbuement.id, input.userItemImbuementId),
              eq(userItemImbuement.userItemId, ownedUserItem.id),
            ),
          );
        if (deleteResult.rowsAffected !== 1) {
          return errorResponse("Imbuement already removed");
        }

        if (returnsCrystal) {
          await tx.insert(userItem).values({
            id: nanoid(),
            userId: ctx.userId,
            itemId: imbuement.imbuementItemId,
            quantity: 1,
            equipped: "NONE",
            storedAtHome: false,
            isInAuction: false,
            craftingFinishedAt: null,
          });
        }

        return {
          success: true,
          message: returnsCrystal
            ? `Removed ${imbuement.item.name} from ${ownedUserItem.item.name} and returned the crystal to your inventory`
            : `Removed ${imbuement.item.name} from ${ownedUserItem.item.name}`,
        };
      });
    }),
});
