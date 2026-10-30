import { eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import type { ElementName } from "@/drizzle/constants";
import {
  BasicElementName,
  COST_CHANGE_GENDER,
  COST_EXTRA_ITEM_SLOT,
  COST_EXTRA_JUTSU_SLOT,
  COST_REROLL_ELEMENT,
  COST_RESET_STATS,
  CombatStatNames,
  ElementNames,
  getUserCaps,
  REP_TRADE_MIN_LEVEL,
  RYO_CAP,
  RYO_FOR_REP_DAYS_FROZEN,
  RYO_FOR_REP_MAX_LISTINGS,
  RYO_FOR_REP_MIN_REPS,
  repTradeLevelMessage,
} from "@/drizzle/constants";
import { userData } from "@/drizzle/schema";
import { getJutsuSlotIncreaseError } from "@/libs/jutsuSlots";
import {
  getAssignedCombatStatTotal,
  getRedistributableStatTotal,
} from "@/libs/profile";
import { hasEnergyQueue } from "@/libs/queue";
import { filterValidElementsTypeguard } from "@/libs/train";
import { getBloodlineElements } from "@/libs/userElements";
import {
  addElementRoll,
  deleteRyoTradeForDelistOffer,
  fetchActiveUserOffers,
  fetchOffer,
  findUserDataForTakeOffer,
  insertActionLogForBuyItemSlot,
  insertActionLogForBuyJutsuSlot,
  insertActionLogForRerollElement,
  insertActionLogForTakeOffer,
  insertActionLogForTakeOffer2,
  insertActionLogForUpdateStats,
  insertRyoTradeForCreateOffer,
  selectActionLogForGetRolledElements,
  selectRyoTradeForGetGraph,
  selectRyoTradeForGetRyoOffers,
  updateRyoTradeForTakeOffer,
  updateRyoTradeForTakeOffer2,
  updateUserDataForBuyItemSlot,
  updateUserDataForBuyJutsuSlot,
  updateUserDataForChangeUserGender,
  updateUserDataForCreateOffer,
  updateUserDataForRerollElement,
  updateUserDataForTakeOffer,
  updateUserDataForTakeOffer2,
  updateUserDataForTakeOffer3,
  updateUserDataForTakeOffer4,
} from "@/queries/blackmarket";
import {
  fetchUser,
  findUserWithBloodline,
  refundUserReputationPoints,
} from "@/queries/profile";

import { createTRPCRouter, errorResponse, protectedProcedure } from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { claimUserSnapshot } from "@/server/utils/concurrency";
import { getRandomElement } from "@/utils/array";
import { round } from "@/utils/math";
import {
  canChangeContent,
  canRollPrimaryElement,
  canRollSecondaryElement,
} from "@/utils/permissions";
import { secondsFromDate } from "@/utils/time";
import type { DatabasePromiseReturn } from "@/utils/typeutils";
import { rerollElementSchema } from "@/validators/blackmarket";
import { statSchema } from "@/validators/combat";
import { genders } from "@/validators/register";
import { userDeltaResponseSchema } from "@/validators/userCache";

export const blackMarketRouter = createTRPCRouter({
  getRyoOffers: protectedProcedure
    .meta({ mcp: { description: "Get ryo trade offers" } })
    .input(
      z.object({
        cursor: z.number().nullish(),
        limit: z.number().min(1).max(100).nullish(),
        activeToggle: z.boolean().nullish(),
        creator: z.string().nullish(),
        buyer: z.string().nullish(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const currentCursor = input?.cursor ? input.cursor : 0;
      const limit = input?.limit ? input.limit : 100;
      const skip = currentCursor * limit;

      const results = await selectRyoTradeForGetRyoOffers(
        ctx.drizzle,
        input,
        limit,
        skip,
      );
      const nextCursor = results.length < limit ? null : currentCursor + 1;
      return { data: results, nextCursor };
    }),
  getGraph: protectedProcedure
    .meta({ mcp: { description: "Get ryo trade graph data" } })
    .query(async ({ ctx }) => {
      const transfers = await selectRyoTradeForGetGraph(ctx.drizzle);
      return transfers;
    }),
  createOffer: protectedProcedure
    .meta({ mcp: { description: "Create a ryo trade offer" } })
    .input(
      z.object({
        reps: z.coerce.number().int().min(1),
        ryo: z.coerce.number().int().min(1),
        allowedUser: z.string().nullish(),
      }),
    )
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, offers] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchActiveUserOffers(ctx.drizzle, ctx.userId),
      ]);
      // Guard
      if (user.reputationPoints - 5 < input.reps) {
        return errorResponse("Not enough reputation points");
      }
      if (input.reps < RYO_FOR_REP_MIN_REPS) {
        return errorResponse(
          `Reputation points must be at least ${RYO_FOR_REP_MIN_REPS}`,
        );
      }
      if (offers.length >= RYO_FOR_REP_MAX_LISTINGS) {
        return errorResponse(`You can only have ${RYO_FOR_REP_MAX_LISTINGS} offers`);
      }
      if (user.isBanned) return errorResponse("You are banned");
      if (user.isTradeBanned) return errorResponse("You are banned from trading");
      if (user.level < REP_TRADE_MIN_LEVEL) {
        return errorResponse(repTradeLevelMessage);
      }
      if (input.reps <= 0) return errorResponse("Reps must be greater than 0");
      if (input.ryo <= 0) return errorResponse("Ryo must be greater than 0");
      if (input.ryo < input.reps) return errorResponse("Ryo must be greater than reps");
      // Deduce reputation points first
      const result = await updateUserDataForCreateOffer(ctx.drizzle, input, ctx);
      if (result.rowsAffected === 0) {
        return errorResponse("Not enough reputation points");
      }
      // Add in the offer
      await insertRyoTradeForCreateOffer(ctx.drizzle, ctx, input);
      // Response
      return {
        success: true,
        message: "Offer created",
        userDelta: hasEnergyQueue(user) ? undefined : { reputationPoints: -input.reps },
      };
    }),
  delistOffer: protectedProcedure
    .meta({ mcp: { description: "Remove a ryo trade offer" } })
    .input(z.object({ offerId: z.string() }))
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, offer] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchOffer(ctx.drizzle, input.offerId),
      ]);
      if (!offer) return errorResponse("Offer not found");
      // Derived
      const isTerr = user.username === "Terriator";
      const creatorId = offer?.creatorUserId;
      // Guard
      if (creatorId !== ctx.userId && !isTerr) return errorResponse("Not yours");
      // Check time
      const delistSeconds = 3600 * 24 * RYO_FOR_REP_DAYS_FROZEN;
      const delistDate = secondsFromDate(delistSeconds, offer.createdAt);
      const canDelist = new Date() >= delistDate || isTerr;
      if (!canDelist) return errorResponse("Offer is frozen");
      // Mutate
      await Promise.all([
        deleteRyoTradeForDelistOffer(ctx.drizzle, input),
        refundUserReputationPoints(ctx.drizzle, offer.repsForSale, creatorId),
      ]);
      // Response
      return {
        success: true,
        message: "Offer delisted",
        userDelta: hasEnergyQueue(user)
          ? undefined
          : creatorId === ctx.userId
            ? { reputationPoints: offer.repsForSale }
            : {},
      };
    }),
  takeOffer: protectedProcedure
    .meta({ mcp: { description: "Purchase a ryo trade offer" } })
    .input(z.object({ offerId: z.string() }))
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Fetch the offer, user, and seller data simultaneously
      const [offer, user] = await Promise.all([
        fetchOffer(ctx.drizzle, input.offerId),
        fetchUser(ctx.drizzle, ctx.userId),
      ]);

      // Validate offer
      if (!offer) return errorResponse("Offer not found");
      if (offer.purchaserUserId) return errorResponse("Offer already taken");
      if (offer.creatorUserId === ctx.userId) return errorResponse("Your own offer");
      if (offer.allowedPurchaserId && offer.allowedPurchaserId !== ctx.userId) {
        return errorResponse("You are not allowed to purchase this offer");
      }
      if (user.isBanned) return errorResponse("You are banned");
      if (user.isTradeBanned) return errorResponse("You are banned from trading");
      if (user.level < REP_TRADE_MIN_LEVEL) {
        return errorResponse(repTradeLevelMessage);
      }
      if (user.money < offer.requestedRyo) {
        return errorResponse("Insufficient funds");
      }

      // Verify seller still exists and can receive payment
      const seller = await findUserDataForTakeOffer(ctx.drizzle, offer);
      if (!seller) {
        return errorResponse("Seller account no longer exists");
      }
      // Reject trade if seller's bank would exceed RYO_CAP (prevents silent ryo loss)
      if (seller.bank + offer.requestedRyo > RYO_CAP) {
        return errorResponse("Seller's bank is at capacity - trade cannot proceed");
      }

      // Mark the offer as taken first - this will fail if someone else has taken it
      const offerResult = await updateRyoTradeForTakeOffer(ctx.drizzle, ctx, input);
      if (offerResult.rowsAffected === 0) {
        return errorResponse("Offer no longer available");
      }

      // Perform both updates simultaneously
      const [buyerResult, sellerResult] = await Promise.all([
        // Update buyer's money and reputation points
        updateUserDataForTakeOffer(ctx.drizzle, offer, ctx),
        // Update seller's bank - add the full requested ryo (validated to fit under RYO_CAP)
        updateUserDataForTakeOffer2(ctx.drizzle, offer),
      ]);

      // Verify BOTH buyer and seller updates succeeded
      const buyerFailed = buyerResult.rowsAffected === 0;
      const sellerFailed = sellerResult.rowsAffected === 0;

      if (buyerFailed || sellerFailed) {
        // Rollback: reset offer status and any successful updates
        await Promise.all([
          // Always reset the offer status
          updateRyoTradeForTakeOffer2(ctx.drizzle, input),
          // Roll back seller's bank if only buyer failed (seller succeeded)
          ...(sellerFailed === false && buyerFailed
            ? [updateUserDataForTakeOffer3(ctx.drizzle, offer)]
            : []),
          // Roll back buyer if only seller failed (buyer succeeded)
          ...(buyerFailed === false && sellerFailed
            ? [updateUserDataForTakeOffer4(ctx.drizzle, offer, ctx)]
            : []),
          // Log the failure for debugging
          insertActionLogForTakeOffer(
            ctx.drizzle,
            ctx,
            input,
            buyerFailed,
            sellerFailed,
          ),
        ]);

        return errorResponse(
          buyerFailed
            ? "Failed to update buyer - transaction reverted"
            : "Failed to update seller - transaction reverted",
        );
      }

      // Log successful trade for audit trail
      await insertActionLogForTakeOffer2(ctx.drizzle, ctx, offer, input);

      return {
        success: true,
        message: `Bought ${offer.repsForSale} reputation points for ${offer.requestedRyo} ryo.`,
        userDelta: hasEnergyQueue(user)
          ? undefined
          : { money: -offer.requestedRyo, reputationPoints: offer.repsForSale },
      };
    }),
  changeUserGender: protectedProcedure
    .meta({ mcp: { description: "Change user's gender" } })
    .input(z.object({ gender: z.enum(genders) }))
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard
      if (user.reputationPoints < COST_CHANGE_GENDER) {
        return errorResponse("Not enough reputation points");
      }
      // Mutate
      const result = await updateUserDataForChangeUserGender(
        ctx.drizzle,
        input,
        ctx,
        user,
      );
      // Return message
      if (result.rowsAffected === 0) {
        return errorResponse("Your profile or reputation changed. Please try again");
      } else {
        const userPatch = {
          gender: input.gender,
          reputationPoints: user.reputationPoints - COST_CHANGE_GENDER,
        };
        return {
          success: true,
          message: `Change gender in ${input.gender}`,
          userPatch,
        };
      }
    }),
  buyItemSlot: protectedProcedure
    .meta({ mcp: { description: "Purchase an extra item slot" } })
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx }) => {
      // Fetch
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard
      if (user.reputationPoints < COST_EXTRA_ITEM_SLOT) {
        return errorResponse("Not enough reputation points");
      }
      // Mutate
      const result = await updateUserDataForBuyItemSlot(ctx.drizzle, ctx);
      if (result.rowsAffected === 0) {
        return { success: false, message: "Could not update user" };
      } else {
        await insertActionLogForBuyItemSlot(ctx.drizzle, ctx, user);
        return {
          success: true,
          message: "Item slot purchased",
          userDelta: hasEnergyQueue(user)
            ? undefined
            : { reputationPoints: -COST_EXTRA_ITEM_SLOT, extraItemSlots: 1 },
        };
      }
    }),
  buyJutsuSlot: protectedProcedure
    .meta({ mcp: { description: "Purchase an extra jutsu slot" } })
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx }) => {
      // Fetch
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard
      if (user.reputationPoints < COST_EXTRA_JUTSU_SLOT) {
        return errorResponse("Not enough reputation points");
      }
      const slotError = getJutsuSlotIncreaseError(user.extraJutsuSlots);
      if (slotError) return errorResponse(slotError);
      // Mutate
      const result = await updateUserDataForBuyJutsuSlot(ctx.drizzle, ctx);
      if (result.rowsAffected === 0) {
        return { success: false, message: "Could not update user" };
      } else {
        await insertActionLogForBuyJutsuSlot(ctx.drizzle, ctx, user);
        return {
          success: true,
          message: "Jutsu slot purchased",
          userDelta: hasEnergyQueue(user)
            ? undefined
            : { reputationPoints: -COST_EXTRA_JUTSU_SLOT, extraJutsuSlots: 1 },
        };
      }
    }),
  rerollElement: protectedProcedure
    .meta({
      mcp: { description: "Reroll primary or secondary element" },
    })
    .input(rerollElementSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Load bloodline eligibility and roll history together before any writes.
      const [user, rollHistory] = await Promise.all([
        findUserWithBloodline(ctx.drizzle, ctx),
        getRolledElements(ctx.drizzle, ctx.userId),
      ]);

      // Reject overridden rolls before recording history or spending reputation.
      if (!user) return errorResponse("User not found");
      if (getBloodlineElements(user).length > 0) {
        return errorResponse("Your bloodline overrides both innate elements");
      }
      if (user.reputationPoints < COST_REROLL_ELEMENT) {
        return errorResponse("Not enough reputation points");
      }
      if (input.elementType === "primary" && !canRollPrimaryElement(user)) {
        return errorResponse("Must be at least a genin to reroll primary elements");
      }
      if (input.elementType === "secondary" && !canRollSecondaryElement(user)) {
        return errorResponse("Must be at least a chunin to reroll secondary elements");
      }

      // All the promises to be executed at the end
      const mutations: Promise<DatabasePromiseReturn>[] = [];

      // Concurrent attempts may repeat existing history; getRolledElements deduplicates it.
      if (user.primaryElement && !rollHistory.primary.includes(user.primaryElement)) {
        mutations.push(
          addElementRoll(ctx.drizzle, ctx.userId, "primary", user.primaryElement),
        );
        rollHistory.primary.push(user.primaryElement);
      }
      if (
        user.secondaryElement &&
        !rollHistory.secondary.includes(user.secondaryElement)
      ) {
        mutations.push(
          addElementRoll(ctx.drizzle, ctx.userId, "secondary", user.secondaryElement),
        );
        rollHistory.secondary.push(user.secondaryElement);
      }

      // Execute all addElementRoll operations in parallel, then reset the
      // accumulator; drizzle builders re-run their query on every await
      if (mutations.length > 0) {
        await Promise.all(mutations);
        mutations.length = 0;
      }

      // Get the new element
      const result = rerollElementType(
        input.elementType,
        input.elementType === "primary" ? user.primaryElement : user.secondaryElement,
        input.elementType === "primary" ? user.secondaryElement : user.primaryElement,
        input.elementType === "primary" ? rollHistory.primary : rollHistory.secondary,
      );
      if (!result.element) {
        return errorResponse("No element found");
      }

      // Add promises to the mutations
      if (result.reset) {
        mutations.push(insertActionLogForRerollElement(ctx.drizzle, ctx, input));
      }

      // Charge and replace the roll atomically; balance, bloodline and innate-slot
      // guards below reject stale snapshots without a transaction or locking read.
      const updateData: Record<string, unknown> = {
        reputationPoints: sql`reputationPoints - ${COST_REROLL_ELEMENT}`,
      };
      if (input.elementType === "primary") {
        updateData.primaryElement = result.element;
      } else {
        updateData.secondaryElement = result.element;
      }
      const update = await updateUserDataForRerollElement(
        ctx.drizzle,
        updateData,
        ctx,
        user,
      );
      if (update.rowsAffected === 0)
        return errorResponse("Your balance or elements changed. Please try again.");

      // Add element roll to actionLog for the new element
      mutations.push(
        addElementRoll(ctx.drizzle, ctx.userId, input.elementType, result.element),
      );

      // Run all the mutations in parallel
      await Promise.all(mutations);

      return {
        success: true,
        message: `Element rerolled successfully. ${result.changes.join(", ")}`,
        userPatch: {
          primaryElement:
            input.elementType === "primary" ? result.element : user.primaryElement,
          secondaryElement:
            input.elementType === "secondary" ? result.element : user.secondaryElement,
        },
        userDelta: hasEnergyQueue(user)
          ? undefined
          : { reputationPoints: -COST_REROLL_ELEMENT },
      };
    }),
  // Update stats
  updateStats: protectedProcedure
    .meta({ mcp: { description: "Redistribute user stats" } })
    .input(statSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      const cost = canChangeContent(user.role) ? 0 : COST_RESET_STATS;
      if (user.reputationPoints < cost) {
        return errorResponse("Not enough reputation points");
      }
      const { stats_cap, gens_cap } = getUserCaps(user.rank);
      if (getAssignedCombatStatTotal(user) > getRedistributableStatTotal(user)) {
        return errorResponse(
          "Your stored stats exceed your rank's redistribution capacity. Resetting is unavailable until your rank caps can hold all your points; your stored stats are preserved.",
        );
      }
      if (input.offence > stats_cap || input.defence > stats_cap) {
        return errorResponse(
          `Offence and defence cannot exceed ${stats_cap.toLocaleString()} at your rank`,
        );
      }
      const generals = [
        input.strength,
        input.speed,
        input.intelligence,
        input.willpower,
      ];
      if (generals.some((value) => value > gens_cap)) {
        return errorResponse(
          `General stats cannot exceed ${gens_cap.toLocaleString()} at your rank`,
        );
      }
      const inputSum = round(Object.values(input).reduce((a, b) => a + b, 0));
      const availableStats = round(getRedistributableStatTotal(user));
      if (inputSum !== availableStats) {
        return errorResponse(
          `Requested points ${inputSum} do not match your ${availableStats} assigned combat stat points`,
        );
      }
      const result = await claimUserSnapshot({
        client: ctx.drizzle,
        userId: ctx.userId,
        updatedAt: user.updatedAt,
        set: {
          offence: input.offence,
          defence: input.defence,
          strength: input.strength,
          speed: input.speed,
          intelligence: input.intelligence,
          willpower: input.willpower,
          reputationPoints: sql`reputationPoints - ${cost}`,
        },
        where: [
          eq(userData.rank, user.rank),
          ...CombatStatNames.map((stat) => eq(userData[stat], user[stat])),
          gte(userData.reputationPoints, cost),
        ],
      });
      if (!result.success) {
        return errorResponse(
          "Stats or balance changed while resetting. Please try again",
        );
      } else {
        await insertActionLogForUpdateStats(ctx.drizzle, ctx, user);
        return {
          success: true,
          message: `User stats updated for ${cost} reputation points`,
          userPatch: input,
          userDelta: hasEnergyQueue(user) ? undefined : { reputationPoints: -cost },
        };
      }
    }),
});

/**
 * Gets the rolled elements from actionLog.
 *
 * @param {DrizzleClient} client - The Drizzle client used to make the query.
 * @param {string} userId - The ID of the user who rolled the element.
 * @param {string} elementType - The type of element rolled (primary or secondary).
 * @returns {Promise<{primary: string[], secondary: string[]}>} A promise that resolves to an object containing the rolled elements.
 */
export const getRolledElements = async (client: DrizzleClient, userId: string) => {
  // Get all relevant logs (resets and element rolls) in a single query
  const allLogs = await selectActionLogForGetRolledElements(client, userId);

  // Find the latest reset times
  const resetLogs = allLogs.filter((log) => log.relatedMsg?.startsWith("RESET:"));
  const primaryResetLogs = resetLogs.filter(
    (log) => log.relatedMsg === "RESET: primary",
  );
  const secondaryResetLogs = resetLogs.filter(
    (log) => log.relatedMsg === "RESET: secondary",
  );
  const lastPrimaryReset =
    primaryResetLogs.length > 0
      ? (primaryResetLogs[primaryResetLogs.length - 1]?.createdAt.getTime() ?? 0)
      : 0;
  const lastSecondaryReset =
    secondaryResetLogs.length > 0
      ? (secondaryResetLogs[secondaryResetLogs.length - 1]?.createdAt.getTime() ?? 0)
      : 0;

  // Filter element rolls that occurred after their respective resets
  const elementRolls = allLogs.filter((log) => {
    if (!log.relatedMsg || log.relatedMsg.startsWith("RESET:")) return false;

    if (log.relatedMsg.startsWith("Primary: ")) {
      return log.createdAt.getTime() > lastPrimaryReset;
    }
    if (log.relatedMsg.startsWith("Secondary: ")) {
      return log.createdAt.getTime() > lastSecondaryReset;
    }
    return false;
  });

  // Process the rolls and separate by type
  const primaryElements: string[] = [];
  const secondaryElements: string[] = [];
  for (const log of elementRolls) {
    if (!log.relatedMsg) continue;

    if (log.relatedMsg.startsWith("Primary: ")) {
      const element = log.relatedMsg.replace("Primary: ", "").trim();
      if (
        element &&
        ElementNames.includes(element as ElementName) &&
        !primaryElements.includes(element)
      ) {
        primaryElements.push(element);
      }
    } else if (log.relatedMsg.startsWith("Secondary: ")) {
      const element = log.relatedMsg.replace("Secondary: ", "").trim();
      if (
        element &&
        ElementNames.includes(element as ElementName) &&
        !secondaryElements.includes(element)
      ) {
        secondaryElements.push(element);
      }
    }
  }

  // Return elements
  return {
    primary: filterValidElementsTypeguard(primaryElements),
    secondary: filterValidElementsTypeguard(secondaryElements),
  };
};

/**
 * Rerolls an element type.
 *
 * @param {DrizzleClient} client - The Drizzle client used to make the query.
 * @param {string} userId - The ID of the user who rolled the element.
 * @param {string} elementType - The type of element rolled (primary or secondary).
 * @param currentElement
 * @param oppositeElement
 * @param rolledElements
 * @returns
 */
const rerollElementType = (
  elementType: "primary" | "secondary",
  currentElement: ElementName | null,
  oppositeElement: ElementName | null,
  rolledElements: ElementName[],
) => {
  // Exclude the opposite element, and current element if it's not already in rolledElements, and previously rolled elements
  const excludedElements = oppositeElement ? [oppositeElement] : [];
  if (currentElement && !rolledElements.includes(currentElement)) {
    excludedElements.push(currentElement);
  }
  excludedElements.push(...rolledElements);

  // Get available elements (only basic types)
  const elementsLeft = BasicElementName.filter((e) => !excludedElements.includes(e));
  const shouldReset = elementsLeft.length === 0;
  const available = shouldReset
    ? BasicElementName.filter((e) => e !== oppositeElement)
    : elementsLeft;

  return {
    element: getRandomElement(available) ?? null,
    reset: shouldReset,
    changes: [`${elementType} element rerolled ${shouldReset ? "(reset)" : ""}`],
  };
};
