import { nanoid } from "nanoid";
import { z } from "zod";
import {
  BOUNTY_MAX_HUNTERS,
  BOUNTY_MIN_AMOUNT,
  BOUNTY_STATUSES,
  RANKS_RESTRICTED_FROM_PVP,
  VILLAGE_SYNDICATE_ID,
} from "@/drizzle/constants";
import {
  deleteBountyContribution,
  deleteBountySignupForStopTracking,
  deleteBountySignups,
  findBountyById,
  findBountyForCreate,
  findBountyForRemoveAllTrackers,
  findBountyForSignup,
  findBountySignup,
  findBountySignupForSignup,
  insertActionLogForRemoveAllTrackers,
  insertBountyContribution,
  insertBountyForCreate,
  insertBountySignupForSignup,
  listBountyContributions,
  listBountyForBoard,
  listBountySignupForGetTrackedBounties,
  listBountySignupForSignup,
  refundBountyContribution,
  updateBountyForAddMoney,
  updateBountyForCollect,
  updateBountyForRetract,
} from "@/queries/bounty";
import { debitUserMoney, fetchUser, incrementUserMoney } from "@/queries/profile";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { canSeeHiddenBountyInfo } from "@/utils/permissions";
import { addBountyMoneySchema, createBountySchema } from "@/validators/bounty";

const signupBountySchema = z.object({
  bountyId: z.string().min(1),
});

const retractBountySchema = z.object({
  bountyId: z.string().min(1),
});

const bountyBoardFilterSchema = z.object({
  cursor: z.number().nullish(),
  limit: z.number().min(1).max(100).prefault(30),
  status: z.enum([...BOUNTY_STATUSES, "all"]).prefault("OPEN"),
});

const collectBountySchema = z.object({
  bountyId: z.string().min(1),
});

export const bountyRouter = createTRPCRouter({
  // Get open bounty board
  board: protectedProcedure
    .meta({ mcp: { description: "Get bounty board listings" } })
    .input(bountyBoardFilterSchema)
    .query(async ({ ctx, input }) => {
      const limit = input.limit;
      const offset = (input.cursor ?? 0) * limit;
      const userId = ctx.userId;

      // Fetch user and bounties in parallel for efficiency
      const [currentUser, results] = await Promise.all([
        fetchUser(ctx.drizzle, userId),
        listBountyForBoard(ctx.drizzle, input, limit, offset),
      ]);

      const canSeeHiddenInfo = canSeeHiddenBountyInfo(currentUser.role);

      // Transform results and filter based on permissions
      const transformedResults = results
        .filter((bountyItem) => {
          // Staff and syndicate users can see all bounties
          if (canSeeHiddenInfo || currentUser.villageId === VILLAGE_SYNDICATE_ID) {
            return true;
          }

          // For other users, hide bounties where the target is from the same village
          const targetVillageId = bountyItem.target?.villageId;
          const userVillageId = currentUser.villageId;
          const isCreator = bountyItem.creatorUserId === userId;

          // Show if user is the creator, or if target is from a different village
          return isCreator || targetVillageId !== userVillageId;
        })
        .map((bountyItem) => ({
          id: bountyItem.id,
          amountRyo: bountyItem.amountRyo,
          createdAt: bountyItem.createdAt,
          status: bountyItem.status,
          collectedAt: bountyItem.collectedAt,
          claimedAt: bountyItem.claimedAt,
          targetUserId: bountyItem.targetUserId,
          claimedByUserId: bountyItem.claimedByUserId,
          huntersCount: bountyItem.hunters.length,
          youSignedUp: bountyItem.hunters.some((h) => h.hunterUserId === userId),
          isCreator: bountyItem.creatorUserId === userId,
          targetUser: bountyItem.target,
          claimedByUser: bountyItem.claimedBy,
          // Creator and hunter identities are staff-only
          creatorUser: canSeeHiddenInfo ? bountyItem.creator : undefined,
          huntingUsers: canSeeHiddenInfo
            ? bountyItem.hunters.map((h) => h.hunter)
            : undefined,
        }));

      const nextCursor = results.length < limit ? null : (input.cursor ?? 0) + 1;
      return { data: transformedResults, nextCursor };
    }),

  create: protectedProcedure
    .meta({ mcp: { description: "Create bounty on target user" } })
    .input(createBountySchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const { amountRyo } = input;
      // Query
      const [creator, target, existingBounty] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, input.targetUserId),
        findBountyForCreate(ctx.drizzle, input.targetUserId),
      ]);
      // Identity comes from the stored row: a lookup also matches other spellings of an id
      const targetUserId = target.userId;
      // Guards
      if (targetUserId === ctx.userId) return errorResponse("Cannot bounty yourself");
      if (RANKS_RESTRICTED_FROM_PVP.includes(target.rank))
        return errorResponse("Target too low rank for PvP");
      if (amountRyo < BOUNTY_MIN_AMOUNT)
        return errorResponse(
          `Bounty amount too low. Must be at least ${BOUNTY_MIN_AMOUNT.toLocaleString()} Ryo`,
        );
      if (creator.money < amountRyo) return errorResponse("Not enough ryo");

      // Check if target already has an active bounty
      if (existingBounty) {
        return errorResponse(
          "Target already has an active bounty. You can add money to it instead.",
        );
      }
      // Mutation 1
      const result = await debitUserMoney(ctx.drizzle, amountRyo, ctx);
      if (result?.rowsAffected === 0) return errorResponse("Not enough ryo");
      // Mutation 2
      const bountyId = nanoid();
      await Promise.all([
        insertBountyForCreate(ctx.drizzle, bountyId, targetUserId, ctx, amountRyo),
        insertBountyContribution(ctx.drizzle, bountyId, ctx.userId, amountRyo),
      ]);
      return { success: true, message: "Bounty created" };
    }),

  signup: protectedProcedure
    .meta({ mcp: { description: "Sign up to track a bounty" } })
    .input(signupBountySchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const { bountyId } = input;
      const [curBounty, curSignups, userSignups, hunter] = await Promise.all([
        findBountyForSignup(ctx.drizzle, bountyId),
        listBountySignupForSignup(ctx.drizzle, bountyId),
        findBountySignupForSignup(ctx.drizzle, ctx),
        fetchUser(ctx.drizzle, ctx.userId),
      ]);
      // Guards
      if (!curBounty) return errorResponse("Bounty not found");
      if (curBounty.status !== "OPEN") return errorResponse("Bounty closed");
      if (curBounty.creatorUserId === ctx.userId)
        return errorResponse("Cannot track your own bounty");
      if (curBounty.targetUserId === ctx.userId)
        return errorResponse("Cannot track your own bounty");
      const target = curBounty.target;
      if (!target) return errorResponse("Target user not found");
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
      await insertBountySignupForSignup(ctx.drizzle, bountyId, ctx);
      return { success: true, message: "Tracking this bounty" };
    }),

  stopTracking: protectedProcedure
    .meta({ mcp: { description: "Stop tracking a bounty" } })
    .input(z.object({ bountyId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [curBounty, userSignup] = await Promise.all([
        findBountyById(ctx.drizzle, input.bountyId),
        findBountySignup(ctx.drizzle, input.bountyId, ctx.userId),
      ]);

      // Guards
      if (!curBounty) return errorResponse("Bounty not found");
      if (!userSignup) return errorResponse("You are not tracking this bounty");
      if (curBounty.status !== "OPEN") return errorResponse("Bounty closed");

      // Stop tracking the bounty
      await deleteBountySignupForStopTracking(ctx.drizzle, userSignup);
      return { success: true, message: "Stopped tracking bounty" };
    }),

  collect: protectedProcedure
    .meta({ mcp: { description: "Collect bounty reward after kill" } })
    .input(collectBountySchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const { bountyId } = input;

      // Find the bounty and hunter signup
      const [curBounty, hunterSignup] = await Promise.all([
        findBountyById(ctx.drizzle, bountyId),
        findBountySignup(ctx.drizzle, bountyId, ctx.userId),
      ]);

      // Guards
      if (!curBounty) return errorResponse("Bounty not found");
      if (curBounty.claimedByUserId !== ctx.userId)
        return errorResponse("Not your bounty");
      if (curBounty.collectedAt) return errorResponse("Bounty already collected");
      if (!hunterSignup) return errorResponse("Not signed up for this bounty");

      // Claim the payout once; concurrent collects lose this compare-and-swap
      const claim = await updateBountyForCollect(ctx.drizzle, bountyId, ctx.userId);
      if (claim.rowsAffected !== 1) return errorResponse("Bounty already collected");
      await Promise.all([
        deleteBountySignups(ctx.drizzle, bountyId),
        incrementUserMoney(ctx.drizzle, curBounty.amountRyo, ctx.userId),
      ]);

      return { success: true, message: "Bounty claimed successfully" };
    }),

  addMoney: protectedProcedure
    .meta({ mcp: { description: "Add ryo to existing bounty" } })
    .input(addBountyMoneySchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [curBounty, user] = await Promise.all([
        findBountyById(ctx.drizzle, input.bountyId),
        fetchUser(ctx.drizzle, ctx.userId),
      ]);
      // Guards
      if (!curBounty) return errorResponse("Bounty not found");
      if (curBounty.status !== "OPEN") return errorResponse("Bounty not open");
      if (user.money < input.amountRyo) return errorResponse("Not enough ryo");

      // Debit first, then record the contribution before raising the bounty, so a
      // retract or expiry that cancels the bounty in between refunds it
      const debit = await debitUserMoney(ctx.drizzle, input.amountRyo, ctx);
      if (debit.rowsAffected === 0) return errorResponse("Not enough ryo");
      const contributionId = nanoid();
      await insertBountyContribution(
        ctx.drizzle,
        input.bountyId,
        ctx.userId,
        input.amountRyo,
        contributionId,
      );
      const raise = await updateBountyForAddMoney(ctx.drizzle, input);
      if (raise.rowsAffected === 0) {
        await refundContribution(ctx.drizzle, {
          id: contributionId,
          amountRyo: input.amountRyo,
        });
        return errorResponse("Bounty not open");
      }

      return {
        success: true,
        message: `Added ${input.amountRyo.toLocaleString()} Ryo to bounty`,
      };
    }),

  retract: protectedProcedure
    .meta({ mcp: { description: "Retract bounty and get refund" } })
    .input(retractBountySchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const curBounty = await findBountyById(ctx.drizzle, input.bountyId);
      // Guards
      if (!curBounty) return errorResponse("Bounty not found");
      if (curBounty.creatorUserId !== ctx.userId)
        return errorResponse("Not your bounty");
      if (curBounty.status !== "OPEN") return errorResponse("Bounty not open");
      // First disable the bounty and check the result
      const result = await updateBountyForRetract(ctx.drizzle, input, ctx);
      if (result?.rowsAffected === 0) return errorResponse("Bounty not found");
      await Promise.all([
        deleteBountySignups(ctx.drizzle, input.bountyId),
        refundBountyContributions(ctx.drizzle, input.bountyId),
      ]);
      return { success: true, message: "Bounty retracted successfully" };
    }),

  removeAllTrackers: protectedProcedure
    .input(z.object({ bountyId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query - fetch bounty with hunters and user in parallel
      const [curBountyWithHunters, user] = await Promise.all([
        findBountyForRemoveAllTrackers(ctx.drizzle, input),
        fetchUser(ctx.drizzle, ctx.userId),
      ]);

      // Guards
      if (!curBountyWithHunters) return errorResponse("Bounty not found");
      if (!canSeeHiddenBountyInfo(user.role))
        return errorResponse("Staff access required");
      if (
        curBountyWithHunters.status !== "OPEN" &&
        curBountyWithHunters.status !== "CLAIMED"
      ) {
        return errorResponse("Bounty must be open or claimed");
      }

      const hunters = curBountyWithHunters.hunters;

      // Execute deletion and logging in parallel (no transaction to avoid PlanetScale deadlocks)
      await Promise.all([
        // Remove all hunter signups for this bounty
        deleteBountySignups(ctx.drizzle, input.bountyId),

        // Log the action
        insertActionLogForRemoveAllTrackers(ctx.drizzle, ctx, hunters.length, input),
      ]);

      return {
        success: true,
        message: `Removed ${hunters.length} hunters from bounty tracking`,
      };
    }),

  // Get user's tracked bounties for map display
  getTrackedBounties: protectedProcedure
    .meta({ mcp: { description: "Get bounties you are tracking" } })
    .query(async ({ ctx }) => {
      // Get bounties the user is tracking
      const trackedBounties = await listBountySignupForGetTrackedBounties(
        ctx.drizzle,
        ctx,
      );

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

/**
 * Refund every contribution of a bounty that has already left the OPEN state. Contributions
 * are read after that transition so late ones are included. Safe to repeat, so the hourly
 * cron resumes a pass that stopped partway.
 */
export const refundBountyContributions = async (
  client: DrizzleClient,
  bountyId: string,
) => {
  const contributions = await listBountyContributions(client, bountyId);
  await Promise.all(
    contributions.map((contribution) => refundContribution(client, contribution)),
  );
};

/**
 * Refund one contribution, then remove it. Only the refunder that zeroes the row pays and
 * deletes it; a row found at 0 was paid by a pass that stopped before its delete.
 */
const refundContribution = async (
  client: DrizzleClient,
  contribution: { id: string; amountRyo: number },
) => {
  if (contribution.amountRyo > 0) {
    const refund = await refundBountyContribution(client, contribution);
    if (refund.rowsAffected === 0) return;
  }
  await deleteBountyContribution(client, contribution.id);
};
