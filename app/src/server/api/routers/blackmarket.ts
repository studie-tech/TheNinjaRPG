import { z } from "zod";
import { nanoid } from "nanoid";
import { eq, sql, gte, gt, and, asc, desc, isNull, isNotNull } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { fetchUser } from "./profile";
import { round } from "@/utils/math";
import { userData, ryoTrade, actionLog } from "@/drizzle/schema";
import { secondsFromDate } from "@/utils/time";
import { statSchema } from "@/libs/combat/types";
import { COST_RESET_STATS } from "@/drizzle/constants";
import { RYO_FOR_REP_DAYS_FROZEN } from "@/drizzle/constants";
import { COST_CUSTOM_TITLE } from "@/drizzle/constants";
import { COST_EXTRA_ITEM_SLOT } from "@/drizzle/constants";
import { COST_CHANGE_GENDER } from "@/drizzle/constants";
import { COST_EXTRA_JUTSU_SLOT } from "@/drizzle/constants";
import { MAX_EXTRA_JUTSU_SLOTS } from "@/drizzle/constants";
import { COST_REROLL_ELEMENT } from "@/drizzle/constants";
import { RYO_FOR_REP_MAX_LISTINGS } from "@/drizzle/constants";
import { RYO_FOR_REP_MIN_REPS } from "@/drizzle/constants";
import { BasicElementName, ElementNames } from "@/drizzle/constants";
import { RYO_CAP } from "@/drizzle/constants";
import { getRandomElement } from "@/utils/array";
import { genders } from "@/validators/register";
import { baseServerResponse, errorResponse } from "../trpc";
import { canRollPrimaryElement, canRollSecondaryElement } from "@/utils/permissions";
import { filterValidElementsTypeguard } from "@/libs/train";
import type { DrizzleClient } from "@/server/db";
import type { ElementName } from "@/drizzle/constants";
import type { DatabasePromiseReturn } from "@/utils/typeutils";

import { canChangeContent } from "@/utils/permissions";

export const blackMarketRouter = createTRPCRouter({
  getRyoOffers: protectedProcedure
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
      const creator = alias(userData, "creator");
      const buyer = alias(userData, "buyer");
      const allowed = alias(userData, "allowed");
      const results = await ctx.drizzle
        .select({
          id: ryoTrade.id,
          creatorUserId: ryoTrade.creatorUserId,
          repsForSale: ryoTrade.repsForSale,
          requestedRyo: ryoTrade.requestedRyo,
          createdAt: ryoTrade.createdAt,
          ryoPerRep: ryoTrade.ryoPerRep,
          creatorUsername: creator.username,
          creatorAvatar: creator.avatar,
          purchaserUsername: buyer.username,
          purchaserAvatar: buyer.avatar,
          allowedUsername: allowed.username,
          allowedAvatar: allowed.avatar,
        })
        .from(ryoTrade)
        .innerJoin(creator, eq(ryoTrade.creatorUserId, creator.userId))
        .leftJoin(buyer, eq(ryoTrade.purchaserUserId, buyer.userId))
        .leftJoin(allowed, eq(ryoTrade.allowedPurchaserId, allowed.userId))
        .where(
          and(
            input.activeToggle
              ? isNull(ryoTrade.purchaserUserId)
              : isNotNull(ryoTrade.purchaserUserId),
            ...(input.creator ? [eq(creator.username, input.creator)] : []),
            ...(input.buyer ? [eq(buyer.username, input.buyer)] : []),
          ),
        )
        .orderBy((table) => [
          input.activeToggle ? asc(table.ryoPerRep) : desc(table.createdAt),
        ])
        .limit(limit)
        .offset(skip);
      const nextCursor = results.length < limit ? null : currentCursor + 1;
      return { data: results, nextCursor };
    }),
  getGraph: protectedProcedure.query(async ({ ctx }) => {
    const sender = alias(userData, "sender");
    const receiver = alias(userData, "receiver");
    const transfers = await ctx.drizzle
      .select({
        senderId: sender.userId,
        receiverId: receiver.userId,
        senderUsername: sender.username,
        receiverUsername: receiver.username,
        senderAvatar: sender.avatar,
        receiverAvatar: receiver.avatar,
        totalReps: sql<number>`SUM(${ryoTrade.repsForSale})`,
        totalRyo: sql<number>`SUM(${ryoTrade.requestedRyo})`,
      })
      .from(ryoTrade)
      .innerJoin(sender, eq(ryoTrade.creatorUserId, sender.userId))
      .innerJoin(receiver, eq(ryoTrade.purchaserUserId, receiver.userId))
      .where(isNotNull(ryoTrade.purchaserUserId))
      .groupBy(ryoTrade.creatorUserId, ryoTrade.purchaserUserId);
    return transfers;
  }),
  createOffer: protectedProcedure
    .input(
      z.object({
        reps: z.coerce.number().int().min(1),
        ryo: z.coerce.number().int().min(1),
        allowedUser: z.string().nullish(),
      }),
    )
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
      if (input.reps <= 0) return errorResponse("Reps must be greater than 0");
      if (input.ryo <= 0) return errorResponse("Ryo must be greater than 0");
      if (input.ryo < input.reps) return errorResponse("Ryo must be greater than reps");
      // Deduce reputation points first
      const result = await ctx.drizzle
        .update(userData)
        .set({ reputationPoints: sql`${userData.reputationPoints} - ${input.reps}` })
        .where(
          and(
            eq(userData.userId, ctx.userId),
            gt(userData.reputationPoints, input.reps),
          ),
        );
      if (result.rowsAffected === 0) {
        return errorResponse("Not enough reputation points");
      }
      // Add in the offer
      await ctx.drizzle.insert(ryoTrade).values({
        id: nanoid(),
        creatorUserId: ctx.userId,
        repsForSale: input.reps,
        requestedRyo: input.ryo,
        ryoPerRep: input.ryo / input.reps,
        allowedPurchaserId: input.allowedUser,
      });
      // Response
      return { success: true, message: "Offer created" };
    }),
  delistOffer: protectedProcedure
    .input(z.object({ offerId: z.string() }))
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
        ctx.drizzle.delete(ryoTrade).where(eq(ryoTrade.id, input.offerId)),
        ctx.drizzle
          .update(userData)
          .set({
            reputationPoints: sql`${userData.reputationPoints} + ${offer.repsForSale}`,
          })
          .where(eq(userData.userId, creatorId)),
      ]);
      // Response
      return { success: true, message: "Offer delisted" };
    }),
  takeOffer: protectedProcedure
    .input(z.object({ offerId: z.string() }))
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
      if (user.money < offer.requestedRyo) {
        return errorResponse("Insufficient funds");
      }

      // Verify seller still exists and can receive payment
      const seller = await ctx.drizzle.query.userData.findFirst({
        where: eq(userData.userId, offer.creatorUserId),
        columns: { userId: true, bank: true },
      });
      if (!seller) {
        return errorResponse("Seller account no longer exists");
      }
      // Reject trade if seller's bank would exceed RYO_CAP (prevents silent ryo loss)
      if (seller.bank + offer.requestedRyo > RYO_CAP) {
        return errorResponse("Seller's bank is at capacity - trade cannot proceed");
      }

      // Mark the offer as taken first - this will fail if someone else has taken it
      const offerResult = await ctx.drizzle
        .update(ryoTrade)
        .set({ purchaserUserId: ctx.userId })
        .where(and(eq(ryoTrade.id, input.offerId), isNull(ryoTrade.purchaserUserId)));
      if (offerResult.rowsAffected === 0) {
        return errorResponse("Offer no longer available");
      }

      // Perform both updates simultaneously
      const [buyerResult, sellerResult] = await Promise.all([
        // Update buyer's money and reputation points
        ctx.drizzle
          .update(userData)
          .set({
            money: sql`${userData.money} - ${offer.requestedRyo}`,
            reputationPoints: sql`${userData.reputationPoints} + ${offer.repsForSale}`,
          })
          .where(
            and(
              eq(userData.userId, ctx.userId),
              gte(userData.money, offer.requestedRyo),
            ),
          ),
        // Update seller's bank - add the full requested ryo (validated to fit under RYO_CAP)
        ctx.drizzle
          .update(userData)
          .set({ bank: sql`${userData.bank} + ${offer.requestedRyo}` })
          .where(
            and(
              eq(userData.userId, offer.creatorUserId),
              sql`${userData.bank} + ${offer.requestedRyo} <= ${RYO_CAP}`,
            ),
          ),
      ]);

      // Verify BOTH buyer and seller updates succeeded
      const buyerFailed = buyerResult.rowsAffected === 0;
      const sellerFailed = sellerResult.rowsAffected === 0;

      if (buyerFailed || sellerFailed) {
        // Rollback: reset offer status and any successful updates
        await Promise.all([
          // Always reset the offer status
          ctx.drizzle
            .update(ryoTrade)
            .set({ purchaserUserId: null })
            .where(eq(ryoTrade.id, input.offerId)),
          // Roll back seller's bank if only buyer failed (seller succeeded)
          ...(sellerFailed === false && buyerFailed
            ? [
                ctx.drizzle
                  .update(userData)
                  .set({ bank: sql`${userData.bank} - ${offer.requestedRyo}` })
                  .where(eq(userData.userId, offer.creatorUserId)),
              ]
            : []),
          // Roll back buyer if only seller failed (buyer succeeded)
          ...(buyerFailed === false && sellerFailed
            ? [
                ctx.drizzle
                  .update(userData)
                  .set({
                    money: sql`${userData.money} + ${offer.requestedRyo}`,
                    reputationPoints: sql`${userData.reputationPoints} - ${offer.repsForSale}`,
                  })
                  .where(eq(userData.userId, ctx.userId)),
              ]
            : []),
          // Log the failure for debugging
          ctx.drizzle.insert(actionLog).values({
            id: nanoid(),
            userId: ctx.userId,
            tableName: "ryoTrade",
            changes: [
              `Rollback of offer ${input.offerId}`,
              `Buyer update: ${buyerFailed ? "failed" : "success"}`,
              `Seller update: ${sellerFailed ? "failed" : "success"}`,
            ],
            relatedId: input.offerId,
            relatedMsg: `Rollback: buyer=${buyerFailed ? "fail" : "ok"}, seller=${sellerFailed ? "fail" : "ok"}`,
          }),
        ]);

        return errorResponse(
          buyerFailed
            ? "Failed to update buyer - transaction reverted"
            : "Failed to update seller - transaction reverted",
        );
      }

      // Log successful trade for audit trail
      await ctx.drizzle.insert(actionLog).values({
        id: nanoid(),
        userId: ctx.userId,
        tableName: "ryoTrade",
        changes: [
          `Purchased ${offer.repsForSale} reputation for ${offer.requestedRyo} ryo`,
          `Seller: ${offer.creatorUserId}`,
        ],
        relatedId: input.offerId,
        relatedMsg: `Trade completed: ${offer.requestedRyo} ryo`,
      });

      return {
        success: true,
        message: `Bought ${offer.repsForSale} reputation points for ${offer.requestedRyo} ryo.`,
      };
    }),
  // Update custom title
  updateCustomTitle: protectedProcedure
    .input(z.object({ title: z.string().min(1).max(15) }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard
      if (user.reputationPoints < COST_CUSTOM_TITLE) {
        return errorResponse("Not enough reputation points");
      }
      if (input.title === user.customTitle) {
        return errorResponse("Custom title is the same");
      }
      if (user.isBanned) return errorResponse("You are banned");
      // Mutate
      const result = await ctx.drizzle
        .update(userData)
        .set({
          customTitle: input.title,
          reputationPoints: sql`reputationPoints - ${COST_CUSTOM_TITLE}`,
        })
        .where(eq(userData.userId, ctx.userId));
      if (result.rowsAffected === 0) {
        return { success: false, message: "Could not update user" };
      } else {
        await ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "user",
          changes: [`Custom title changed from ${user.customTitle} to ${input.title}`],
          relatedId: ctx.userId,
          relatedMsg: `Update: ${user.customTitle} -> ${input.title}`,
          relatedImage: user.avatarLight,
        });
        return { success: true, message: "Custom title updated" };
      }
    }),
  changeUserGender: protectedProcedure
    .input(z.object({ gender: z.enum(genders) }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard
      if (user.reputationPoints < COST_CHANGE_GENDER) {
        return errorResponse("Not enough reputation points");
      }
      // Mutate
      const result = await ctx.drizzle
        .update(userData)
        .set({
          gender: input.gender,
          reputationPoints: sql`reputationPoints - ${COST_CHANGE_GENDER}`,
        })
        .where(eq(userData.userId, ctx.userId));
      // Return message
      if (result.rowsAffected === 0) {
        return { success: false, message: "Could not update user" };
      } else {
        return { success: true, message: `Change gender in ${input.gender}` };
      }
    }),
  buyItemSlot: protectedProcedure
    .output(baseServerResponse)
    .mutation(async ({ ctx }) => {
      // Fetch
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard
      if (user.reputationPoints < COST_EXTRA_ITEM_SLOT) {
        return errorResponse("Not enough reputation points");
      }
      // Mutate
      const result = await ctx.drizzle
        .update(userData)
        .set({
          extraItemSlots: sql`extraItemSlots + 1`,
          reputationPoints: sql`reputationPoints - ${COST_EXTRA_ITEM_SLOT}`,
        })
        .where(eq(userData.userId, ctx.userId));
      if (result.rowsAffected === 0) {
        return { success: false, message: "Could not update user" };
      } else {
        await ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "user",
          changes: ["Item slot purchased"],
          relatedId: ctx.userId,
          relatedMsg: "Update: Item slot purchased",
          relatedImage: user.avatarLight,
        });
        return { success: true, message: "Item slot purchased" };
      }
    }),
  buyJutsuSlot: protectedProcedure
    .output(baseServerResponse)
    .mutation(async ({ ctx }) => {
      // Fetch
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard
      if (user.reputationPoints < COST_EXTRA_JUTSU_SLOT) {
        return errorResponse("Not enough reputation points");
      }
      if (user.extraJutsuSlots >= MAX_EXTRA_JUTSU_SLOTS) {
        return errorResponse("Already maximum amount of extra jutsu slots");
      }
      // Mutate
      const result = await ctx.drizzle
        .update(userData)
        .set({
          extraJutsuSlots: sql`extraJutsuSlots + 1`,
          reputationPoints: sql`reputationPoints - ${COST_EXTRA_JUTSU_SLOT}`,
        })
        .where(eq(userData.userId, ctx.userId));
      if (result.rowsAffected === 0) {
        return { success: false, message: "Could not update user" };
      } else {
        await ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "user",
          changes: ["Jutsu slot purchased"],
          relatedId: ctx.userId,
          relatedMsg: "Update: Jutsu slot purchased",
          relatedImage: user.avatarLight,
        });
        return { success: true, message: "Jutsu slot purchased" };
      }
    }),
  rerollElement: protectedProcedure
    .input(z.object({ elementType: z.enum(["primary", "secondary"]) }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch user and rolled elements in parallel
      const [user, rollHistory] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        getRolledElements(ctx.drizzle, ctx.userId),
      ]);

      // Guard
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

      // Ensure current elements are in actionLog if not already tracked
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

      // Execute all addElementRoll operations in parallel
      if (mutations.length > 0) {
        await Promise.all(mutations);
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
        mutations.push(
          ctx.drizzle.insert(actionLog).values({
            id: nanoid(),
            userId: ctx.userId,
            tableName: "elementRoll",
            changes: [`${input.elementType} element tracking reset`],
            relatedMsg: `RESET: ${input.elementType}`,
          }),
        );
      }

      // Mutation for updating the user data
      const updateData: Record<string, unknown> = {
        reputationPoints: sql`reputationPoints - ${COST_REROLL_ELEMENT}`,
      };
      if (input.elementType === "primary") {
        updateData.primaryElement = result.element;
      } else {
        updateData.secondaryElement = result.element;
      }
      mutations.push(
        ctx.drizzle
          .update(userData)
          .set(updateData)
          .where(eq(userData.userId, ctx.userId)),
      );

      // Add element roll to actionLog for the new element
      mutations.push(
        addElementRoll(ctx.drizzle, ctx.userId, input.elementType, result.element),
      );

      // Run all the mutations in parallel
      await Promise.all(mutations);

      return {
        success: true,
        message: `Element rerolled successfully. ${result.changes.join(", ")}`,
      };
    }),
  // Update stats
  updateStats: protectedProcedure
    .input(statSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      const cost = canChangeContent(user.role) ? 0 : COST_RESET_STATS;
      if (user.reputationPoints < cost) {
        return { success: false, message: "Not enough reputation points" };
      }
      const inputSum = round(Object.values(input).reduce((a, b) => a + b, 0));
      const availableStats = round(user.experience + 120);
      if (inputSum !== availableStats) {
        const message = `Requested points ${inputSum} for not match experience points ${availableStats}`;
        return { success: false, message };
      }
      const result = await ctx.drizzle
        .update(userData)
        .set({
          ninjutsuOffence: input.ninjutsuOffence,
          taijutsuOffence: input.taijutsuOffence,
          genjutsuOffence: input.genjutsuOffence,
          bukijutsuOffence: input.bukijutsuOffence,
          ninjutsuDefence: input.ninjutsuDefence,
          taijutsuDefence: input.taijutsuDefence,
          genjutsuDefence: input.genjutsuDefence,
          bukijutsuDefence: input.bukijutsuDefence,
          strength: input.strength,
          speed: input.speed,
          intelligence: input.intelligence,
          willpower: input.willpower,
          reputationPoints: sql`reputationPoints - ${cost}`,
        })
        .where(eq(userData.userId, ctx.userId));
      if (result.rowsAffected === 0) {
        return { success: false, message: "Could not update user" };
      } else {
        await ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "user",
          changes: [`User stats distribution changed`],
          relatedId: ctx.userId,
          relatedMsg: `Update: ${user.username} stats redistribution`,
          relatedImage: user.avatarLight,
        });
        return {
          success: true,
          message: `User stats updated for ${cost} reputation points`,
        };
      }
    }),
});

/**
 * Fetches a ryo offer from the black market.
 *
 * @param {DrizzleClient} client - The Drizzle client used to make the query.
 * @param {string} offerId - The ID of the offer to fetch.
 */
export const fetchOffer = async (client: DrizzleClient, offerId: string) => {
  return await client.query.ryoTrade.findFirst({
    where: eq(ryoTrade.id, offerId),
  });
};

/**
 * Fetches all offers created by a specific user.
 *
 * @param {DrizzleClient} client - The database client used to perform the query.
 * @param {string} userId - The ID of the user whose offers are to be fetched.
 * @returns {Promise<Array>} A promise that resolves to an array of offers created by the user.
 */
export const fetchActiveUserOffers = async (client: DrizzleClient, userId: string) => {
  return await client.query.ryoTrade.findMany({
    where: and(eq(ryoTrade.creatorUserId, userId), isNull(ryoTrade.purchaserUserId)),
  });
};

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
  const allLogs = await client
    .select({
      relatedMsg: actionLog.relatedMsg,
      createdAt: actionLog.createdAt,
    })
    .from(actionLog)
    .where(and(eq(actionLog.userId, userId), eq(actionLog.tableName, "elementRoll")))
    .orderBy(asc(actionLog.createdAt));

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
 * Adds a new element roll to actionLog.
 *
 * @param {DrizzleClient} client - The Drizzle client used to make the query.
 * @param {string} userId - The ID of the user who rolled the element.
 * @param {string} elementType - The type of element rolled (primary or secondary).
 * @param {string} element - The name of the element rolled.
 */
const addElementRoll = async (
  client: DrizzleClient,
  userId: string,
  elementType: "primary" | "secondary",
  element: ElementName,
) => {
  await client.insert(actionLog).values({
    id: nanoid(),
    userId: userId,
    tableName: "elementRoll",
    changes: [`${elementType} element rolled`],
    relatedMsg: `${elementType === "primary" ? "Primary" : "Secondary"}: ${element}`,
  });
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
