import { nanoid } from "nanoid";
import { and, eq, sql, gte, desc, inArray, or, isNull } from "drizzle-orm";
import { bounty, bountySignup, bountyContribution, userData, actionLog } from "@/drizzle/schema";
import {
  BOUNTY_MAX_HUNTERS,
  RANKS_RESTRICTED_FROM_PVP,
  BOUNTY_MIN_AMOUNT,
  VILLAGE_SYNDICATE_ID,
} from "@/drizzle/constants";
import {
  createBountySchema,
  signupBountySchema,
  resignBountySchema,
  retractBountySchema,
  bountyBoardFilterSchema,
  collectBountySchema,
  addBountyMoneySchema,
} from "@/validators/bounty";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { baseServerResponse, errorResponse } from "../trpc";
import { fetchUser } from "@/routers/profile";
import { canSeeHiddenBountyInfo } from "@/utils/permissions";
import { z } from "zod";

export const bountyRouter = createTRPCRouter({
  // Get open bounty board
  board: protectedProcedure
    .input(bountyBoardFilterSchema)
    .query(async ({ ctx, input }) => {
      const limit = input.limit ?? 30;
      const offset = (input.cursor ?? 0) * limit;
      const userId = ctx.userId;

      // Fetch user and bounties in parallel for efficiency
      const [currentUser, results] = await Promise.all([
        fetchUser(ctx.drizzle, userId),
        ctx.drizzle.query.bounty.findMany({
          where:
            input.status === "all"
              ? undefined
              : input.status === "OPEN"
                ? and(
                    inArray(bounty.status, ["OPEN", "CLAIMED"]),
                    // Hide completed bounties (CLAIMED and collected)
                    or(
                      eq(bounty.status, "OPEN"),
                      and(eq(bounty.status, "CLAIMED"), isNull(bounty.collectedAt)),
                    ),
                  )
                : eq(bounty.status, input.status),
          columns: {
            id: true,
            amountRyo: true,
            createdAt: true,
            status: true,
            collectedAt: true,
            claimedAt: true,
            targetUserId: true,
            claimedByUserId: true,
            creatorUserId: true,
          },
          with: {
            target: {
              columns: {
                username: true,
                avatar: true,
                level: true,
                rank: true,
                isOutlaw: true,
                villageId: true,
              },
            },
            hunters: {
              columns: {
                hunterUserId: true,
              },
              with: {
                hunter: {
                  columns: {
                    username: true,
                    avatar: true,
                    level: true,
                    rank: true,
                    isOutlaw: true,
                    villageId: true,
                  },
                },
              },
            },
            creator: {
              columns: {
                username: true,
                avatar: true,
                level: true,
                rank: true,
                isOutlaw: true,
                villageId: true,
              },
            },
            claimedBy: {
              columns: {
                username: true,
                avatar: true,
                level: true,
                rank: true,
                isOutlaw: true,
                villageId: true,
              },
            },
          },
          orderBy: desc(bounty.createdAt),
          limit,
          offset,
        }),
      ]);

      const canSeeHiddenInfo = currentUser
        ? canSeeHiddenBountyInfo(currentUser.role)
        : false;

      // Transform results and filter based on permissions
      const transformedResults = results
        .filter((bountyItem) => {
          // Staff and syndicate users can see all bounties
          if (canSeeHiddenInfo || currentUser?.villageId === VILLAGE_SYNDICATE_ID) {
            return true;
          }

          // For other users, hide bounties from the same village
          const targetVillageId = bountyItem.target?.villageId;
          const creatorVillageId = bountyItem.creator?.villageId;
          const userVillageId = currentUser?.villageId;

          // Hide if target or creator is from the same village
          return (
            targetVillageId !== userVillageId && creatorVillageId !== userVillageId
          );
        })
        .map((bountyItem) => ({
          ...bountyItem,
          huntersCount: bountyItem.hunters?.length ?? 0,
          youSignedUp:
            bountyItem.hunters?.some((h) => h.hunterUserId === userId) ?? false,
          targetUser: bountyItem.target,
          creatorUser: canSeeHiddenInfo ? bountyItem.creator : undefined,
          creatorUserId: canSeeHiddenInfo ? bountyItem.creatorUserId : undefined,
          huntingUsers: canSeeHiddenInfo
            ? bountyItem.hunters
                ?.map((h) => ("hunter" in h ? h.hunter : null))
                .filter(Boolean)
            : undefined,
          claimedByUser: bountyItem.claimedBy,
        }));

      const nextCursor = results.length < limit ? null : (input.cursor ?? 0) + 1;
      return { data: transformedResults, nextCursor };
    }),

  create: protectedProcedure
    .input(createBountySchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const { targetUserId, amountRyo } = input;
      // Guards
      if (targetUserId === ctx.userId) return errorResponse("Cannot bounty yourself");
      // Query
      const [creator, target] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, targetUserId),
      ]);
      // Guards
      if (!creator || !target) return errorResponse("User not found");
      if (RANKS_RESTRICTED_FROM_PVP.includes(target.rank))
        return errorResponse("Target too low rank for PvP");
      if (amountRyo < BOUNTY_MIN_AMOUNT)
        return errorResponse(
          `Bounty amount too low. Must be at least ${BOUNTY_MIN_AMOUNT.toLocaleString()} Ryo`,
        );
      if (creator.money < amountRyo) return errorResponse("Not enough ryo");

      // Check if target already has an active bounty
      const existingBounty = await ctx.drizzle.query.bounty.findFirst({
        where: and(eq(bounty.targetUserId, targetUserId), eq(bounty.status, "OPEN")),
      });
      if (existingBounty) {
        return errorResponse(
          "Target already has an active bounty. You can add money to it instead.",
        );
      }
      // Mutation 1
      const result = await ctx.drizzle
        .update(userData)
        .set({ money: sql`${userData.money} - ${amountRyo}` })
        .where(and(eq(userData.userId, ctx.userId), gte(userData.money, amountRyo)));
      if (result?.rowsAffected === 0) return errorResponse("Not enough ryo");
      // Mutation 2
      const bountyId = nanoid();
      await Promise.all([
        ctx.drizzle.insert(bounty).values({
          id: bountyId,
          targetUserId,
          creatorUserId: ctx.userId,
          amountRyo,
          originalAmountRyo: amountRyo,
          status: "OPEN",
          createdAt: new Date(),
        }),
        ctx.drizzle.insert(bountyContribution).values({
          id: nanoid(),
          bountyId,
          contributorUserId: ctx.userId,
          amountRyo,
          createdAt: new Date(),
        }),
      ]);
      return { success: true, message: "Bounty created" };
    }),

  signup: protectedProcedure
    .input(signupBountySchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const { bountyId } = input;
      const [curBounty, curSignups, userSignups, target] = await Promise.all([
        ctx.drizzle.query.bounty.findFirst({
          where: eq(bounty.id, bountyId),
        }),
        ctx.drizzle.query.bountySignup.findMany({
          where: eq(bountySignup.bountyId, bountyId),
        }),
        ctx.drizzle.query.bountySignup.findFirst({
          where: eq(bountySignup.hunterUserId, ctx.userId),
        }),
        fetchUser(ctx.drizzle, input.targetUserId),
      ]);
      // Guards
      if (!curBounty) return errorResponse("Bounty not found");
      if (curBounty.status !== "OPEN") return errorResponse("Bounty closed");
      if (curBounty.creatorUserId === ctx.userId)
        return errorResponse("Cannot track your own bounty");
      if (curBounty.targetUserId === ctx.userId)
        return errorResponse("Cannot track your own bounty");
      if (!target) return errorResponse("Target user not found");
      if (target.userId !== curBounty.targetUserId)
        return errorResponse("Target user does not match bounty");
      const hunter = await fetchUser(ctx.drizzle, ctx.userId);
      if (!hunter) return errorResponse("User not found");
      if (RANKS_RESTRICTED_FROM_PVP.includes(hunter.rank))
        return errorResponse("Your rank cannot engage in PvP");
      if (curSignups?.find((c) => c.hunterUserId === ctx.userId))
        return errorResponse("Already sign up");
      if (curSignups && curSignups.length >= BOUNTY_MAX_HUNTERS)
        return errorResponse("Maximum hunters signed up already");
      if (userSignups) return errorResponse("Already tracking a bounty.");
      if (
        hunter.villageId === target.villageId &&
        hunter.villageId !== VILLAGE_SYNDICATE_ID
      ) {
        return errorResponse("Cannot take bounties on players in the same village");
      }

      // Sign up for the bounty hunt
      await ctx.drizzle.insert(bountySignup).values({
        id: nanoid(),
        bountyId,
        hunterUserId: ctx.userId,
        createdAt: new Date(),
      });
      return { success: true, message: "Tracking this bounty" };
    }),

  resign: protectedProcedure
    .input(resignBountySchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const claim = await ctx.drizzle.query.bountySignup.findFirst({
        where: eq(bountySignup.id, input.claimId),
      });
      if (!claim) return errorResponse("Claim not found");
      if (claim.hunterUserId !== ctx.userId) return errorResponse("Not your claim");
      const curBounty = await ctx.drizzle.query.bounty.findFirst({
        where: eq(bounty.id, claim.bountyId),
      });
      if (!curBounty || curBounty.status !== "OPEN")
        return errorResponse("Bounty closed");
      await ctx.drizzle.delete(bountySignup).where(eq(bountySignup.id, claim.id));
      return { success: true, message: "Claim withdrawn" };
    }),

  stopTracking: protectedProcedure
    .input(z.object({ bountyId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [curBounty, userSignup] = await Promise.all([
        ctx.drizzle.query.bounty.findFirst({
          where: eq(bounty.id, input.bountyId),
        }),
        ctx.drizzle.query.bountySignup.findFirst({
          where: and(
            eq(bountySignup.bountyId, input.bountyId),
            eq(bountySignup.hunterUserId, ctx.userId),
          ),
        }),
      ]);

      // Guards
      if (!curBounty) return errorResponse("Bounty not found");
      if (!userSignup) return errorResponse("You are not tracking this bounty");
      if (curBounty.status !== "OPEN") return errorResponse("Bounty closed");

      // Stop tracking the bounty
      await ctx.drizzle.delete(bountySignup).where(eq(bountySignup.id, userSignup.id));
      return { success: true, message: "Stopped tracking bounty" };
    }),

  collect: protectedProcedure
    .input(collectBountySchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const { bountyId } = input;

      // Find the bounty and hunter signup
      const [curBounty, hunterSignup] = await Promise.all([
        ctx.drizzle.query.bounty.findFirst({
          where: eq(bounty.id, bountyId),
        }),
        ctx.drizzle.query.bountySignup.findFirst({
          where: and(
            eq(bountySignup.bountyId, bountyId),
            eq(bountySignup.hunterUserId, ctx.userId),
          ),
        }),
      ]);

      // Guards
      if (!curBounty) return errorResponse("Bounty not found");
      if (curBounty.claimedByUserId !== ctx.userId)
        return errorResponse("Not your bounty");
      if (curBounty.collectedAt) return errorResponse("Bounty already collected");
      if (!hunterSignup) return errorResponse("Not signed up for this bounty");

      // Execute all mutations in parallel
      await Promise.all([
        // Update bounty as claimed
        ctx.drizzle
          .update(bounty)
          .set({ collectedAt: new Date() })
          .where(eq(bounty.id, bountyId)),
        // Update hunter signup as fulfilled
        ctx.drizzle.delete(bountySignup).where(eq(bountySignup.bountyId, bountyId)),
        // Award the bounty money to the hunter
        ctx.drizzle
          .update(userData)
          .set({ money: sql`${userData.money} + ${curBounty.amountRyo}` })
          .where(eq(userData.userId, ctx.userId)),
      ]);

      return { success: true, message: "Bounty claimed successfully" };
    }),

  addMoney: protectedProcedure
    .input(addBountyMoneySchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [curBounty, user] = await Promise.all([
        ctx.drizzle.query.bounty.findFirst({
          where: eq(bounty.id, input.bountyId),
        }),
        fetchUser(ctx.drizzle, ctx.userId),
      ]);
      // Guards
      if (!curBounty) return errorResponse("Bounty not found");
      if (curBounty.status !== "OPEN") return errorResponse("Bounty not open");
      if (input.amountRyo < 1) return errorResponse("Amount must be at least 1 Ryo");
      if (user.money < input.amountRyo) return errorResponse("Not enough ryo");

      // Execute mutations in parallel
      await Promise.all([
        // Add money to the bounty
        ctx.drizzle
          .update(bounty)
          .set({ amountRyo: sql`${bounty.amountRyo} + ${input.amountRyo}` })
          .where(eq(bounty.id, input.bountyId)),
        // Deduct money from the user
        ctx.drizzle
          .update(userData)
          .set({ money: sql`${userData.money} - ${input.amountRyo}` })
          .where(eq(userData.userId, ctx.userId)),
        // Track the contribution
        ctx.drizzle.insert(bountyContribution).values({
          id: nanoid(),
          bountyId: input.bountyId,
          contributorUserId: ctx.userId,
          amountRyo: input.amountRyo,
          createdAt: new Date(),
        }),
      ]);

      return {
        success: true,
        message: `Added ${input.amountRyo.toLocaleString()} Ryo to bounty`,
      };
    }),

  retract: protectedProcedure
    .input(retractBountySchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [curBounty, contributions] = await Promise.all([
        ctx.drizzle.query.bounty.findFirst({
          where: eq(bounty.id, input.bountyId),
        }),
        ctx.drizzle.query.bountyContribution.findMany({
          where: eq(bountyContribution.bountyId, input.bountyId),
        }),
      ]);
      // Guards
      if (!curBounty) return errorResponse("Bounty not found");
      if (curBounty.creatorUserId !== ctx.userId)
        return errorResponse("Not your bounty");
      if (curBounty.status !== "OPEN") return errorResponse("Bounty not open");
      // First disable the bounty and check the result
      const result = await ctx.drizzle
        .update(bounty)
        .set({ status: "CANCELLED" })
        .where(
          and(
            eq(bounty.id, input.bountyId),
            eq(bounty.creatorUserId, ctx.userId),
            eq(bounty.status, "OPEN"),
          ),
        );
      if (result?.rowsAffected === 0) return errorResponse("Bounty not found");
      // Execute mutations in parallel
      await Promise.all([
        // Remove all hunter signups for this bounty
        ctx.drizzle
          .delete(bountySignup)
          .where(eq(bountySignup.bountyId, input.bountyId)),
        // Remove all contributions for this bounty
        ctx.drizzle
          .delete(bountyContribution)
          .where(eq(bountyContribution.bountyId, input.bountyId)),
        // Refund all contributors their money
        ...contributions.map((contribution) =>
          ctx.drizzle
            .update(userData)
            .set({ money: sql`${userData.money} + ${contribution.amountRyo}` })
            .where(eq(userData.userId, contribution.contributorUserId)),
        ),
      ]);
      return { success: true, message: "Bounty retracted successfully" };
    }),

  removeAllTrackers: protectedProcedure
    .input(z.object({ bountyId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [curBounty, user] = await Promise.all([
        ctx.drizzle.query.bounty.findFirst({
          where: eq(bounty.id, input.bountyId),
        }),
        fetchUser(ctx.drizzle, ctx.userId),
      ]);
      
      // Guards
      if (!curBounty) return errorResponse("Bounty not found");
      if (!canSeeHiddenBountyInfo(user.role)) return errorResponse("Staff access required");
      if (curBounty.status !== "OPEN") return errorResponse("Bounty not open");
      
      // Get all hunters tracking this bounty
      const hunters = await ctx.drizzle.query.bountySignup.findMany({
        where: eq(bountySignup.bountyId, input.bountyId),
        with: {
          hunter: {
            columns: {
              userId: true,
              username: true,
            },
          },
        },
      });
      
      // Execute deletion and logging in a transaction
      await ctx.drizzle.transaction(async (tx) => {
        // Remove all hunter signups for this bounty
        await tx
          .delete(bountySignup)
          .where(eq(bountySignup.bountyId, input.bountyId));
        
        // Log the action
        await tx.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "bounty",
          changes: [`Removed ${hunters.length} hunters from bounty tracking`],
          relatedId: input.bountyId,
          relatedMsg: `Staff removed all trackers from bounty: ${hunters.length} hunters removed`,
        });
      });
      
      return { 
        success: true, 
        message: `Removed ${hunters.length} hunters from bounty tracking` 
      };
    }),

  // Get user's tracked bounties for map display
  getTrackedBounties: protectedProcedure.query(async ({ ctx }) => {
    // Get bounties the user is tracking
    const trackedBounties = await ctx.drizzle.query.bountySignup.findMany({
      where: eq(bountySignup.hunterUserId, ctx.userId),
      with: {
        bounty: {
          columns: {
            id: true,
            status: true,
            amountRyo: true,
            collectedAt: true,
            claimedAt: true,
          },
          with: {
            target: {
              columns: {
                userId: true,
                username: true,
                avatar: true,
                avatarLight: true,
                sector: true,
              },
            },
          },
        },
      },
    });

    // Transform to map format
    const bountyHighlights = trackedBounties
      .filter((tb) => tb.bounty.status === "OPEN" && tb.bounty.target)
      .map((tb) => {
        const target = tb.bounty.target;
        return {
          userId: target.userId,
          sector: target.sector,
          avatar: target.avatar,
          avatarLight: target.avatarLight,
          username: target.username,
          bountyAmount: tb.bounty.amountRyo,
        };
      });

    return bountyHighlights;
  }),
});
