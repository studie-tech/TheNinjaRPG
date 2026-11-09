import { eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import {
  getBuySlotUserUpdate,
  getChangedGenderUserPatch,
  getCreateOfferUserUpdate,
  getDelistOfferUserUpdate,
  getRerollElementUserUpdate,
  getTakeOfferUserUpdate,
  getUpdateStatsUserUpdate,
} from "@/deltas/blackmarket";
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
  RYO_FOR_REP_MAX_LISTINGS,
  RYO_FOR_REP_MIN_REPS,
  RYO_FOR_REP_RESERVE,
  repTradeLevelMessage,
} from "@/drizzle/constants";
import { userData } from "@/drizzle/schema";
import { getRyoOfferUnfreezeDate } from "@/libs/blackmarket";
import {
  getJutsuSlotIncreaseError,
  getJutsuSlotIncreaseLimit,
} from "@/libs/jutsuSlots";
import {
  getAssignedCombatStatTotal,
  getRedistributableStatTotal,
} from "@/libs/profile";
import { getBloodlineElements } from "@/libs/userElements";
import {
  addElementRoll,
  deleteRyoTradeForDelistOffer,
  type ExtraSlotPurchase,
  executeResultForTakeOffer,
  fetchActiveUserOffers,
  fetchOffer,
  findRyoTradeForTakeOffer,
  insertActionLogForBuySlot,
  insertActionLogForRerollElement,
  insertActionLogForTakeOffer2,
  insertActionLogForUpdateStats,
  insertRyoTradeForCreateOffer,
  selectActionLogForGetRolledElements,
  selectRyoTradeForGetGraph,
  selectRyoTradeForGetRyoOffers,
  updateUserDataForBuySlot,
  updateUserDataForChangeUserGender,
  updateUserDataForCreateOffer,
  updateUserDataForRerollElement,
} from "@/queries/blackmarket";
import {
  fetchUser,
  findUserWithBloodline,
  refundUserReputationPoints,
} from "@/queries/profile";

import { createTRPCRouter, errorResponse, protectedProcedure } from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { claimUserSnapshot } from "@/server/utils/concurrency";
import { offsetPage } from "@/server/utils/pagination";
import { getRandomElement } from "@/utils/array";
import { round } from "@/utils/math";
import {
  canChangeContent,
  canRollPrimaryElement,
  canRollSecondaryElement,
  isSiteOwnerAccount,
} from "@/utils/permissions";
import type { DatabasePromiseReturn } from "@/utils/typeutils";
import { blackMarketOfferSchema } from "@/validators/blackmarket";
import { statSchema } from "@/validators/combat";
import { genders } from "@/validators/register";
import { userDeltaResponseSchema } from "@/validators/userCache";

/** Selects a stored innate slot; the mutation checks whether it can be rerolled. */
const rerollElementSchema = z.object({
  elementType: z.enum(["primary", "secondary"]),
});

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
      const limit = input?.limit ? input.limit : 100;
      const { skip, cursorAfter } = offsetPage({ cursor: input.cursor, limit });

      const results = await selectRyoTradeForGetRyoOffers(
        ctx.drizzle,
        input,
        limit,
        skip,
      );
      const nextCursor = cursorAfter(results);
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
    .input(blackMarketOfferSchema.extend({ allowedUser: z.string().nullish() }))
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, offers] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchActiveUserOffers(ctx.drizzle, ctx.userId),
      ]);
      // Guard
      if (user.reputationPoints - RYO_FOR_REP_RESERVE < input.reps) {
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
        ...getCreateOfferUserUpdate({ user, inputReps: input.reps }),
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
      const isOwner = isSiteOwnerAccount(user);
      const creatorId = offer.creatorUserId;
      // Guard
      if (creatorId !== ctx.userId && !isOwner) return errorResponse("Not yours");
      // Check time
      const canDelist =
        new Date() >= getRyoOfferUnfreezeDate(offer.createdAt) || isOwner;
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
        ...getDelistOfferUserUpdate({
          user,
          creatorId,
          ctxUserId: ctx.userId,
          offerRepsForSale: offer.repsForSale,
        }),
      };
    }),
  takeOffer: protectedProcedure
    .meta({ mcp: { description: "Purchase a ryo trade offer" } })
    .input(z.object({ offerId: z.string() }))
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Fetch the offer with its seller's bank, and the buyer, simultaneously
      const [offer, user] = await Promise.all([
        findRyoTradeForTakeOffer(ctx.drizzle, input),
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
      if (!offer.creator) {
        return errorResponse("Seller account no longer exists");
      }
      // Reject trade if seller's bank would exceed RYO_CAP (prevents silent ryo loss)
      if (offer.creator.bank + offer.requestedRyo > RYO_CAP) {
        return errorResponse("Seller's bank is at capacity - trade cannot proceed");
      }

      // Claim the offer and move the ryo and reputation in one guarded statement
      const result = await executeResultForTakeOffer(ctx.drizzle, offer, ctx.userId);
      if (result.rowsAffected === 0) {
        return errorResponse(
          "The offer was taken or a balance changed. Please try again",
        );
      }

      // Log successful trade for audit trail
      await insertActionLogForTakeOffer2(ctx.drizzle, ctx, offer, input);

      return {
        success: true,
        message: `Bought ${offer.repsForSale} reputation points for ${offer.requestedRyo} ryo.`,
        ...getTakeOfferUserUpdate({
          user,
          offerRequestedRyo: offer.requestedRyo,
          offerRepsForSale: offer.repsForSale,
        }),
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
        const userPatch = getChangedGenderUserPatch(
          input.gender,
          user.reputationPoints,
        );
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
    .mutation(({ ctx }) =>
      buyExtraSlot(ctx, {
        column: "extraItemSlots",
        cost: COST_EXTRA_ITEM_SLOT,
        label: "Item",
      }),
    ),
  buyJutsuSlot: protectedProcedure
    .meta({ mcp: { description: "Purchase an extra jutsu slot" } })
    .output(userDeltaResponseSchema)
    .mutation(({ ctx }) =>
      buyExtraSlot(
        ctx,
        {
          column: "extraJutsuSlots",
          cost: COST_EXTRA_JUTSU_SLOT,
          label: "Jutsu",
          maxCurrentSlots: getJutsuSlotIncreaseLimit(),
        },
        getJutsuSlotIncreaseError,
      ),
    ),
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

      // Concurrent attempts may repeat existing history; getRolledElements deduplicates it.
      const historyWrites: Promise<DatabasePromiseReturn>[] = [];
      if (user.primaryElement && !rollHistory.primary.includes(user.primaryElement)) {
        historyWrites.push(
          addElementRoll(ctx.drizzle, ctx.userId, "primary", user.primaryElement),
        );
        rollHistory.primary.push(user.primaryElement);
      }
      if (
        user.secondaryElement &&
        !rollHistory.secondary.includes(user.secondaryElement)
      ) {
        historyWrites.push(
          addElementRoll(ctx.drizzle, ctx.userId, "secondary", user.secondaryElement),
        );
        rollHistory.secondary.push(user.secondaryElement);
      }
      await Promise.all(historyWrites);

      // Get the new element
      const isPrimary = input.elementType === "primary";
      const result = rerollElementType(
        input.elementType,
        isPrimary ? user.primaryElement : user.secondaryElement,
        isPrimary ? user.secondaryElement : user.primaryElement,
        isPrimary ? rollHistory.primary : rollHistory.secondary,
      );
      if (!result.element) {
        return errorResponse("No element found");
      }

      // Charge and replace the roll atomically; balance, bloodline and innate-slot
      // guards below reject stale snapshots without a transaction or locking read.
      const update = await updateUserDataForRerollElement(
        ctx.drizzle,
        isPrimary
          ? { primaryElement: result.element }
          : { secondaryElement: result.element },
        ctx,
        user,
      );
      if (update.rowsAffected === 0)
        return errorResponse("Your balance or elements changed. Please try again.");

      // Log the new element, and the reset when it restarted the history.
      await Promise.all([
        ...(result.reset
          ? [insertActionLogForRerollElement(ctx.drizzle, ctx, input)]
          : []),
        addElementRoll(ctx.drizzle, ctx.userId, input.elementType, result.element),
      ]);

      return {
        success: true,
        message: `Element rerolled successfully. ${result.changes.join(", ")}`,
        ...getRerollElementUserUpdate({
          inputElementType: input.elementType,
          resultElement: result.element,
          user,
        }),
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
          ...getUpdateStatsUserUpdate({ input, user, cost }),
        };
      }
    }),
});

/**
 * Gets the rolled elements from actionLog.
 *
 * @param {DrizzleClient} client - The Drizzle client used to make the query.
 * @param {string} userId - The ID of the user who rolled the element.
 * @returns {Promise<{primary: string[], secondary: string[]}>} A promise that resolves to an object containing the rolled elements.
 */
export const getRolledElements = async (client: DrizzleClient, userId: string) => {
  // Get all relevant logs (resets and element rolls) in a single query
  const allLogs = await selectActionLogForGetRolledElements(client, userId);

  // Logs run oldest first, so the last reset of each type is its latest.
  const lastReset = { primary: 0, secondary: 0 };
  for (const { relatedMsg, createdAt } of allLogs) {
    if (relatedMsg === "RESET: primary") lastReset.primary = createdAt.getTime();
    if (relatedMsg === "RESET: secondary") lastReset.secondary = createdAt.getTime();
  }

  // Sets keep first-rolled order and drop repeats from concurrent attempts.
  const rolled = { primary: new Set<ElementName>(), secondary: new Set<ElementName>() };
  for (const { relatedMsg, createdAt } of allLogs) {
    const type = relatedMsg?.startsWith("Primary: ")
      ? "primary"
      : relatedMsg?.startsWith("Secondary: ")
        ? "secondary"
        : null;
    if (!relatedMsg || !type || createdAt.getTime() <= lastReset[type]) continue;
    const element = relatedMsg.slice(relatedMsg.indexOf(": ") + 2).trim();
    if (ElementNames.includes(element as ElementName)) {
      rolled[type].add(element as ElementName);
    }
  }
  return { primary: [...rolled.primary], secondary: [...rolled.secondary] };
};

/**
 * Picks a new basic element for the `elementType` slot, excluding the opposite slot's
 * element, the current element and every element rolled since the last reset. When none
 * remain, the rolls reset and any basic element except the opposite one can be picked.
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

/** Trade reputation for one extra slot; `getSlotError` rejects a slot count at its cap. */
const buyExtraSlot = async (
  ctx: { drizzle: DrizzleClient; userId: string },
  slot: ExtraSlotPurchase,
  getSlotError?: (currentSlots: number) => string | null,
) => {
  // Fetch
  const user = await fetchUser(ctx.drizzle, ctx.userId);
  // Guard
  if (user.reputationPoints < slot.cost) {
    return errorResponse("Not enough reputation points");
  }
  const slotError = getSlotError?.(user[slot.column]);
  if (slotError) return errorResponse(slotError);
  // Mutate
  const result = await updateUserDataForBuySlot(ctx.drizzle, ctx, slot);
  if (result.rowsAffected === 0) return errorResponse("Could not update user");
  await insertActionLogForBuySlot(ctx.drizzle, ctx, user, slot);
  return {
    success: true,
    message: `${slot.label} slot purchased`,
    ...getBuySlotUserUpdate({ user, column: slot.column, cost: slot.cost }),
  };
};
