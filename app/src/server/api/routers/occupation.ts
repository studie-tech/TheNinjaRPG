import { and, asc, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
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
import {
  item,
  userCraftingQueue,
  userCraftingQueueMaterial,
  userData,
  userItem,
  userItemImbuement,
} from "@/drizzle/schema";
import {
  calculateItemConsumption,
  getCraftingRank,
  getEffectiveMaxImbuements,
  getTotalItemQuantity,
} from "@/libs/crafting";
import { filterQuestTrackersForDbPersist, getNewTrackers } from "@/libs/quest";
import { getNextQueueSchedule, rescheduleQueue } from "@/libs/queue";
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
import type { DrizzleClient } from "@/server/db";
import {
  claimUserSnapshot,
  updateUserItemQuantityAtomically,
} from "@/server/utils/concurrency";
import { getCraftingQueue, settleCraftingQueue } from "@/server/utils/queue";
import { getQueueTotalCapacity } from "@/utils/paypal";
import { canChangeContent } from "@/utils/permissions";
import { formatSecondsToTimeDisplay } from "@/utils/time";
import { getShrineBoost } from "@/utils/village";

const rescheduleCraftingJobs = async (
  client: DrizzleClient,
  userId: string,
  now = new Date(),
) => {
  const remaining = await client.query.userCraftingQueue.findMany({
    where: and(
      eq(userCraftingQueue.userId, userId),
      isNull(userCraftingQueue.completedAt),
      isNull(userCraftingQueue.cancelledAt),
    ),
    orderBy: asc(userCraftingQueue.startsAt),
  });
  const active = remaining.find(
    (entry) => entry.startsAt <= now && entry.finishesAt > now,
  );
  const waiting = remaining.filter((entry) => entry.startsAt > now);
  for (const scheduled of rescheduleQueue(waiting, active?.finishesAt ?? now)) {
    await client
      .update(userCraftingQueue)
      .set({ startsAt: scheduled.startsAt, finishesAt: scheduled.finishesAt })
      .where(eq(userCraftingQueue.id, scheduled.entry.id));
  }
};

/** Backfill the legacy future-dated output rows. outputCreatedAt marks these as
 * already rewarded so settlement only unlocks the linked inventory stacks. */
const prepareCraftingQueue = async (client: DrizzleClient, userId: string) => {
  const now = new Date();
  const legacyOutputs = (await fetchUserItems(client, userId)).filter(
    (entry) => entry.craftingFinishedAt && entry.craftingFinishedAt > now,
  );
  const groups = new Map<
    string,
    {
      itemId: string;
      quantity: number;
      startsAt: Date;
      finishesAt: Date;
    }
  >();
  for (const output of legacyOutputs) {
    if (!output.craftingFinishedAt) continue;
    const finishesAt = output.craftingFinishedAt;
    const key = `${output.itemId}:${finishesAt.getTime()}`;
    const current = groups.get(key);
    if (current) {
      current.quantity += output.quantity;
      if (output.createdAt < current.startsAt) current.startsAt = output.createdAt;
    } else {
      groups.set(key, {
        itemId: output.itemId,
        quantity: output.quantity,
        startsAt: output.createdAt,
        finishesAt,
      });
    }
  }
  if (groups.size > 0) {
    await client.transaction(async (tx) => {
      await tx
        .update(userData)
        .set({ updatedAt: sql`${userData.updatedAt}` })
        .where(eq(userData.userId, userId));
      for (const group of groups.values()) {
        const exists = await tx.query.userCraftingQueue.findFirst({
          where: and(
            eq(userCraftingQueue.userId, userId),
            eq(userCraftingQueue.itemId, group.itemId),
            eq(userCraftingQueue.finishesAt, group.finishesAt),
            isNull(userCraftingQueue.completedAt),
            isNull(userCraftingQueue.cancelledAt),
          ),
        });
        if (exists) continue;
        await tx.insert(userCraftingQueue).values({
          id: nanoid(),
          userId,
          itemId: group.itemId,
          quantity: group.quantity,
          durationSeconds: Math.max(
            1,
            Math.round((group.finishesAt.getTime() - group.startsAt.getTime()) / 1000),
          ),
          craftingExperience: 0,
          startsAt: group.startsAt,
          finishesAt: group.finishesAt,
          outputCreatedAt: group.startsAt,
        });
      }
    });
  }
  await settleCraftingQueue(client, userId, now);
};

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

  getCraftingQueue: protectedProcedure.query(async ({ ctx }) => {
    await prepareCraftingQueue(ctx.drizzle, ctx.userId);
    return getCraftingQueue(ctx.drizzle, ctx.userId);
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
      await prepareCraftingQueue(ctx.drizzle, ctx.userId);
      // Run all initial queries in parallel
      const [{ user }, itemWithRequirements, useritems] = await Promise.all([
        // Get user data
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        // Get item to craft with its requirements
        fetchItemWithCraftingRequirements(ctx.drizzle, input.itemId),
        // Check if user is already crafting something
        fetchUserItems(ctx.drizzle, ctx.userId),
      ]);
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

      // Snapshot the exact source stacks. Output, EXP, and quests are awarded
      // only when this job settles.
      const allConsumptions: Array<{
        userItemId: string;
        consumeQuantity: number;
        newQuantity: number;
      }> = [];
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

      const clanCraftingExpBoost = user.isOutlaw
        ? 0
        : (user.clan?.craftingExpBoost ?? 0) / 100;
      const baseExpGain =
        (itemWithRequirements.craftingExperience ?? 0) * input.quantity;
      const expGain = Math.floor(baseExpGain * (1 + clanCraftingExpBoost));
      const queueId = nanoid();
      const enqueueResult = await ctx.drizzle.transaction(async (tx) => {
        const lock = await tx
          .update(userData)
          .set({ updatedAt: sql`${userData.updatedAt}` })
          .where(
            and(
              eq(userData.userId, ctx.userId),
              eq(userData.status, "AWAKE"),
              or(isNull(userData.sector), ne(userData.sector, MAP_WAKE_ISLAND_SECTOR)),
            ),
          );
        if (lock.rowsAffected !== 1) return "STATE_CHANGED" as const;
        const [currentUser, currentQueue, materialRows] = await Promise.all([
          tx.query.userData.findFirst({ where: eq(userData.userId, ctx.userId) }),
          tx.query.userCraftingQueue.findMany({
            where: and(
              eq(userCraftingQueue.userId, ctx.userId),
              isNull(userCraftingQueue.completedAt),
              isNull(userCraftingQueue.cancelledAt),
            ),
            orderBy: asc(userCraftingQueue.startsAt),
          }),
          tx.query.userItem.findMany({
            where: and(
              eq(userItem.userId, ctx.userId),
              inArray(
                userItem.id,
                allConsumptions.map((consumption) => consumption.userItemId),
              ),
            ),
          }),
        ]);
        if (!currentUser) return "STATE_CHANGED" as const;
        if (currentQueue.length >= getQueueTotalCapacity(currentUser)) {
          return "FULL" as const;
        }
        const reservations: (typeof userCraftingQueueMaterial.$inferInsert)[] = [];
        for (const consumption of allConsumptions) {
          const source = materialRows.find((row) => row.id === consumption.userItemId);
          if (!source) return "MATERIALS" as const;
          const update = await tx
            .update(userItem)
            .set({ quantity: consumption.newQuantity })
            .where(
              and(
                eq(userItem.id, source.id),
                eq(userItem.userId, ctx.userId),
                eq(
                  userItem.quantity,
                  consumption.consumeQuantity + consumption.newQuantity,
                ),
                eq(userItem.isInAuction, false),
              ),
            );
          if (update.rowsAffected !== 1) return "MATERIALS" as const;
          reservations.push({
            id: nanoid(),
            queueId,
            itemId: source.itemId,
            quantity: consumption.consumeQuantity,
            sourceUserItemId: source.id,
            sourceEquipped: source.equipped,
            sourceDurability: source.durability,
            sourceStoredAtHome: source.storedAtHome,
            sourceActiveVariantId: source.activeVariantId,
            sourceDropChancePerc: source.dropChancePerc,
          });
        }
        const schedule = getNextQueueSchedule(
          craftSeconds,
          currentQueue.at(-1)?.finishesAt,
        );
        await tx.insert(userCraftingQueue).values({
          id: queueId,
          userId: ctx.userId,
          itemId: input.itemId,
          quantity: input.quantity,
          durationSeconds: craftSeconds,
          craftingExperience: expGain,
          ...schedule,
        });
        if (reservations.length > 0) {
          await tx.insert(userCraftingQueueMaterial).values(reservations);
        }
        return "OK" as const;
      });
      if (enqueueResult === "FULL") return errorResponse("Crafting queue is full");
      if (enqueueResult === "MATERIALS") {
        return errorResponse("Materials changed, please try again");
      }
      if (enqueueResult !== "OK")
        return errorResponse("State changed, please try again");
      const queue = await getCraftingQueue(ctx.drizzle, ctx.userId);
      const queued = [...(queue.active ? [queue.active] : []), ...queue.waiting].find(
        (entry) => entry.id === queueId,
      );
      return {
        success: true,
        message: `Queued ${input.quantity}x ${itemWithRequirements.name}. Ready in ${formatSecondsToTimeDisplay(craftSeconds)}.`,
        finishTime: queued?.finishesAt.toISOString(),
        queue,
      };
    }),

  cancelQueuedCraft: protectedProcedure
    .input(z.object({ queueId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await prepareCraftingQueue(ctx.drizzle, ctx.userId);
      const now = new Date();
      const refunded = await ctx.drizzle.transaction(async (tx) => {
        await tx
          .update(userData)
          .set({ updatedAt: sql`${userData.updatedAt}` })
          .where(eq(userData.userId, ctx.userId));
        const target = await tx.query.userCraftingQueue.findFirst({
          where: and(
            eq(userCraftingQueue.id, input.queueId),
            eq(userCraftingQueue.userId, ctx.userId),
            isNull(userCraftingQueue.completedAt),
            isNull(userCraftingQueue.cancelledAt),
            gt(userCraftingQueue.startsAt, now),
          ),
          with: { materials: true },
        });
        if (!target) return null;
        const claim = await tx
          .update(userCraftingQueue)
          .set({ cancelledAt: now })
          .where(
            and(
              eq(userCraftingQueue.id, target.id),
              isNull(userCraftingQueue.cancelledAt),
              isNull(userCraftingQueue.completedAt),
            ),
          );
        if (claim.rowsAffected !== 1) return null;
        for (const material of target.materials) {
          const restored = await tx
            .update(userItem)
            .set({ quantity: sql`${userItem.quantity} + ${material.quantity}` })
            .where(
              and(
                eq(userItem.id, material.sourceUserItemId),
                eq(userItem.userId, ctx.userId),
              ),
            );
          if (restored.rowsAffected === 0) {
            await tx.insert(userItem).values({
              id: material.sourceUserItemId,
              userId: ctx.userId,
              itemId: material.itemId,
              quantity: material.quantity,
              equipped: material.sourceEquipped,
              durability: material.sourceDurability,
              storedAtHome: material.sourceStoredAtHome,
              activeVariantId: material.sourceActiveVariantId,
              dropChancePerc: material.sourceDropChancePerc,
            });
          }
        }
        await rescheduleCraftingJobs(tx as DrizzleClient, ctx.userId, now);
        return target.materials.reduce((sum, material) => sum + material.quantity, 0);
      });
      if (refunded === null)
        return errorResponse("Only waiting crafts can be cancelled");
      return {
        success: true,
        message: "Queued craft cancelled and reserved materials restored",
        refundedMaterials: refunded,
        queue: await getCraftingQueue(ctx.drizzle, ctx.userId),
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
      if (expResult?.rowsAffected !== 1) {
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
      const ownedUserItem = userItems.find((ui) => ui.id === imbuement.userItemId);
      if (!ownedUserItem) {
        return errorResponse("You don't own this item");
      }

      // Check if item is equipped
      if (ownedUserItem.equipped !== "NONE") {
        return errorResponse("Cannot remove imbuement from equipped item");
      }

      // Check if imbuement is still being crafted
      if (imbuement.craftingFinishedAt && imbuement.craftingFinishedAt > new Date()) {
        return errorResponse("Cannot remove imbuement that is still being crafted");
      }

      // When imbuing is disabled on the item, refund the crystal to inventory
      const returnsCrystal = !ownedUserItem.item.canBeImbued;

      const deleteResult = await ctx.drizzle
        .delete(userItemImbuement)
        .where(
          and(
            eq(userItemImbuement.id, input.userItemImbuementId),
            eq(userItemImbuement.userItemId, ownedUserItem.id),
          ),
        );
      if (deleteResult.rowsAffected === 0) {
        return errorResponse("Imbuement already removed");
      }

      if (returnsCrystal) {
        await ctx.drizzle.insert(userItem).values({
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
    }),
});
