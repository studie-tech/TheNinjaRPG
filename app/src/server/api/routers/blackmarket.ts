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
import { UserRanks, BasicElementName, ElementNames } from "@/drizzle/constants";
import { getRandomElement } from "@/utils/array";
import { genders } from "@/validators/register";
import { baseServerResponse, errorResponse } from "../trpc";
import type { DrizzleClient } from "@/server/db";
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
      // Fetch both the offer and user data simultaneously
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
      if (user.money < offer.requestedRyo) {
        return errorResponse("Insufficient funds");
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
        // Update seller's money - add the requested ryo
        ctx.drizzle
          .update(userData)
          .set({ bank: sql`${userData.bank} + ${offer.requestedRyo}` })
          .where(eq(userData.userId, offer.creatorUserId)),
      ]);

      if (buyerResult.rowsAffected === 0) {
        // This should not happen since we checked funds earlier, but handle it anyway
        // We need to revert the offer status since the buyer update failed
        await Promise.all([
          // Always reset the offer status
          ctx.drizzle
            .update(ryoTrade)
            .set({ purchaserUserId: null })
            .where(eq(ryoTrade.id, input.offerId)),

          // Only attempt to roll back seller's money if their update succeeded
          // and ensure they still have enough money to roll back
          ...(sellerResult.rowsAffected === 1
            ? [
                ctx.drizzle
                  .update(userData)
                  .set({ bank: sql`${userData.bank} - ${offer.requestedRyo}` })
                  .where(eq(userData.userId, offer.creatorUserId)),
                ,
              ]
            : []),
          ctx.drizzle.insert(actionLog).values({
            id: nanoid(),
            userId: ctx.userId,
            tableName: "ryoTrade",
            changes: [`Attempted rollback of offer ${input.offerId}`],
            relatedId: input.offerId,
            relatedMsg: `Rollback attempt: Buyer update failed`,
          }),
        ]);

        return errorResponse("Failed to update buyer - transaction reverted");
      }

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
      // Fetch
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard
      if (user.reputationPoints < COST_REROLL_ELEMENT) {
        return errorResponse("Not enough reputation points");
      }
      
      // Get the updated elements
      const rankId = UserRanks.findIndex((r) => r === user.rank);
      const changes: string[] = [];
      
      // Parse rolled elements - handle both old format (array) and new format (object)
      let rolledElementsData: { primary: string[], secondary: string[] };
      if (Array.isArray(user.rolledElements)) {
        // Old format - convert to new format
        rolledElementsData = { primary: [], secondary: [] };
      } else if (user.rolledElements && typeof user.rolledElements === 'string') {
        // New format - parse the JSON string back to object
        try {
          const parsed = JSON.parse(user.rolledElements) as { primary?: unknown; secondary?: unknown };
          rolledElementsData = {
            primary: Array.isArray(parsed.primary) ? parsed.primary : [],
            secondary: Array.isArray(parsed.secondary) ? parsed.secondary : []
          };
        } catch {
          rolledElementsData = { primary: [], secondary: [] };
        }
      } else if (user.rolledElements && typeof user.rolledElements === 'object') {
        // Direct object format
        const rolledObj = user.rolledElements as { primary?: string[], secondary?: string[] };
        rolledElementsData = {
          primary: Array.isArray(rolledObj.primary) ? rolledObj.primary : [],
          secondary: Array.isArray(rolledObj.secondary) ? rolledObj.secondary : []
        };
      } else {
        // No data
        rolledElementsData = { primary: [], secondary: [] };
      }
      
      // Ensure current elements are in their respective rolled arrays
      if (user.primaryElement && !rolledElementsData.primary.includes(user.primaryElement)) {
        rolledElementsData.primary.push(user.primaryElement);
      }
      if (user.secondaryElement && !rolledElementsData.secondary.includes(user.secondaryElement)) {
        rolledElementsData.secondary.push(user.secondaryElement);
      }
      
      if (input.elementType === "primary") {
        if (rankId >= 1) {
          // For primary reroll, exclude secondary element and previously rolled primary elements
          const excludedElements: typeof ElementNames[number][] = [];
          if (user.secondaryElement) {
            excludedElements.push(user.secondaryElement);
          }
          // Filter and type-cast primary rolled elements
          const validPrimaryRolled = rolledElementsData.primary.filter(
            (e): e is typeof ElementNames[number] => ElementNames.includes(e as typeof ElementNames[number])
          );
          excludedElements.push(...validPrimaryRolled);
          
          const available = BasicElementName.filter((e) => !excludedElements.includes(e));
          
          // If no elements available, reset the primary rolled elements tracking
          if (available.length === 0) {
            rolledElementsData.primary = [];
            
            const resetAvailable = user.secondaryElement 
              ? BasicElementName.filter((e) => e !== user.secondaryElement && e !== user.primaryElement)
              : BasicElementName.filter((e) => e !== user.primaryElement);
            user.primaryElement = getRandomElement(resetAvailable) ?? null;
            // Don't add the new element to tracking after reset - let it be available for future rolls
          } else {
            user.primaryElement = getRandomElement(available) ?? null;
            // Add the new element to primary rolled elements tracking
            if (user.primaryElement) {
              rolledElementsData.primary.push(user.primaryElement);
            }
          }
          changes.push("Primary element rerolled");
        }
      }
      
      if (input.elementType === "secondary") {
        if (user.secondaryElement) {
          // For secondary reroll, exclude primary element and previously rolled secondary elements
          const excludedElements: typeof ElementNames[number][] = [];
          if (user.primaryElement) {
            excludedElements.push(user.primaryElement);
          }
          // Filter and type-cast secondary rolled elements
          const validSecondaryRolled = rolledElementsData.secondary.filter(
            (e): e is typeof ElementNames[number] => ElementNames.includes(e as typeof ElementNames[number])
          );
          excludedElements.push(...validSecondaryRolled);
          
          const available = BasicElementName.filter((e) => !excludedElements.includes(e));
          
          // If no elements available, reset the secondary rolled elements tracking
          if (available.length === 0) {
            rolledElementsData.secondary = [];
            
            const resetAvailable = user.primaryElement 
              ? BasicElementName.filter((e) => e !== user.primaryElement && e !== user.secondaryElement)
              : BasicElementName.filter((e) => e !== user.secondaryElement);
            user.secondaryElement = getRandomElement(resetAvailable) ?? null;
            // Don't add the new element to tracking after reset - let it be available for future rolls
          } else {
            user.secondaryElement = getRandomElement(available) ?? null;
            // Add the new element to secondary rolled elements tracking
            if (user.secondaryElement) {
              rolledElementsData.secondary.push(user.secondaryElement);
            }
          }
          changes.push("Secondary element rerolled");
        }
      }
      
      // Mutate
      const result = await ctx.drizzle
        .update(userData)
        .set({
          primaryElement: user.primaryElement,
          secondaryElement: user.secondaryElement,
          rolledElements: JSON.stringify(rolledElementsData) as unknown as string[],
          reputationPoints: sql`reputationPoints - ${COST_REROLL_ELEMENT}`,
        })
        .where(eq(userData.userId, ctx.userId));
      if (result.rowsAffected === 0) {
        return { success: false, message: "Could not update user" };
      } else {
        await ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "user",
          changes: changes,
          relatedId: ctx.userId,
          relatedMsg: `Update: ${changes.join(", ")}`,
          relatedImage: user.avatarLight,
        });
        return { success: true, message: changes.join(", ") };
      }
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
