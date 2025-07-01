import { z } from "zod";
import { nanoid } from "nanoid";
import { createTRPCRouter, protectedProcedure } from "@/api/trpc";
import { eq, gte, gt, sql, and, inArray, lte, desc } from "drizzle-orm";
import { item, jutsu, rankedLoadout, rankedPvpQueue, userData } from "@/drizzle/schema";
import { TRPCError } from "@trpc/server";
import { rankedSeason, rankedUserRewards } from "@/drizzle/schema";
import { canChangeContent } from "@/utils/permissions";
import { rankedLoadoutSchema, rankedSeasonSchema } from "@/validators/pvpRank";
import { baseServerResponse, errorResponse } from "@/api/trpc";
import {
  RANKED_LOADOUT_MAX_CONSUMABLES,
  RANKED_LOADOUT_MAX_WEAPONS,
  RANKED_LOADOUT_MAX_JUTSUS,
  RANKED_SANNIN_TOP_PLAYERS,
  RANKED_PVP_STATS,
} from "@/drizzle/constants";
import { initiateBattle } from "@/routers/combat";
import { secondsPassed } from "@/utils/time";
import { fetchUser } from "@/routers/profile";
import { collapseRewards } from "@/libs/quest";
import { updateRewards } from "@/server/api/routers/quests";
import { postProcessRewards } from "@/libs/quest";
import type { DrizzleClient } from "@/server/db";
import { getRankedRank } from "@/libs/ranked_pvp";

export const pvpRankRouter = createTRPCRouter({
  // Get the user's season rewards
  getUnclaimedUserSeasonRewards: protectedProcedure.query(async ({ ctx }) => {
    return await getUnclaimedUserSeasonRewards(ctx.drizzle, ctx.userId);
  }),

  // Claim the user's season rewards
  claimSeasonRewards: protectedProcedure.mutation(async ({ ctx }) => {
    // Fetch unclaimed rewards for the user
    const [rewards, user] = await Promise.all([
      getUnclaimedUserSeasonRewards(ctx.drizzle, ctx.userId),
      fetchUser(ctx.drizzle, ctx.userId),
    ]);
    // Guard
    if (rewards.length === 0) {
      return errorResponse("No unclaimed season rewards");
    }
    // Collect rewards from each entry
    const collapsedRewards = collapseRewards(
      rewards.map((r) => r.seasonRewards!).filter((r) => r !== undefined),
    );
    const processedRewards = postProcessRewards(collapsedRewards);
    await Promise.all([
      updateRewards({
        client: ctx.drizzle,
        user,
        rewards: processedRewards,
        reason: "RANKED_REWARDS",
      }),
      ctx.drizzle
        .update(rankedUserRewards)
        .set({ claimed: true })
        .where(eq(rankedUserRewards.userId, ctx.userId)),
    ]);

    return {
      success: true,
      message: "Season rewards claimed successfully",
      rewards: processedRewards,
    };
  }),

  // Get all ranked seasons
  getSeasons: protectedProcedure.query(async ({ ctx }) => {
    const seasons = await fetchAllSeasons(ctx.drizzle);
    return seasons;
  }),

  // Get a specific season
  getSeason: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const season = await ctx.drizzle.query.rankedSeason.findFirst({
        where: eq(rankedSeason.id, input.id),
      });
      if (!season) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Season not found" });
      }
      return season;
    }),

  // Get the current season
  getCurrentSeason: protectedProcedure.query(async ({ ctx }) => {
    return await fetchCurrentSeason(ctx.drizzle);
  }),

  // Get the current season
  getCurrentTopPlayers: protectedProcedure.query(async ({ ctx }) => {
    const topPlayers = await ctx.drizzle.query.userData.findMany({
      columns: {
        userId: true,
        rankedLp: true,
      },
      where: gt(userData.rankedLp, 0),
      orderBy: [desc(userData.rankedLp)],
      limit: RANKED_SANNIN_TOP_PLAYERS,
    });
    return topPlayers;
  }),

  // Create a new season
  createSeason: protectedProcedure
    .input(rankedSeasonSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, currentSeason] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchCurrentSeason(ctx.drizzle),
      ]);
      // Guard
      if (!canChangeContent(user.role)) {
        return errorResponse("You don't have permission to create ranked seasons");
      }
      if (currentSeason) {
        return errorResponse("A season is already active");
      }
      // insert new season
      const id = nanoid();
      await ctx.drizzle.insert(rankedSeason).values({
        id,
        ...input,
      });

      return { success: true, message: "Season created successfully" };
    }),

  // Update an existing season
  updateSeason: protectedProcedure
    .input(z.object({ id: z.string() }).merge(rankedSeasonSchema))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, currentSeason] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchCurrentSeason(ctx.drizzle),
      ]);
      // Guard
      if (!canChangeContent(user.role)) {
        return errorResponse("You don't have permission to update ranked seasons");
      }
      if (currentSeason && currentSeason.id !== input.id) {
        const now = new Date();
        const resultActive = input.endDate >= now;
        if (resultActive) {
          return errorResponse("Another season is active, cannot update this season");
        }
      }
      // update season
      const { id, ...data } = input;
      await ctx.drizzle
        .update(rankedSeason)
        .set({
          ...data,
          updatedAt: new Date(),
        })
        .where(eq(rankedSeason.id, id));
      return { success: true, message: "Season updated successfully" };
    }),

  // Delete a season
  deleteSeason: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard
      if (!canChangeContent(user.role)) {
        return errorResponse("You don't have permission to delete ranked seasons");
      }
      // delete season
      await Promise.all([
        ctx.drizzle.delete(rankedSeason).where(eq(rankedSeason.id, input.id)),
        ctx.drizzle
          .delete(rankedUserRewards)
          .where(eq(rankedUserRewards.seasonId, input.id)),
      ]);
      return { success: true, message: "Season deleted successfully" };
    }),

  // End a season manually
  endSeason: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch user & permission guard
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (!canChangeContent(user.role)) {
        return errorResponse("You don't have permission to end ranked seasons");
      }
      // Verify season exists & not already ended
      const season = await ctx.drizzle.query.rankedSeason.findFirst({
        where: eq(rankedSeason.id, input.id),
      });
      if (!season) {
        return errorResponse("Season not found");
      }
      if (season.ended) {
        return errorResponse("Season already ended");
      }

      // Perform season ending logic
      await endRankedSeason(ctx.drizzle, season.id);

      return { success: true, message: "Season ended successfully" };
    }),

  // Get the ranked loadout
  getRankedLoadout: protectedProcedure.query(async ({ ctx }) => {
    let loadout = await ctx.drizzle.query.rankedLoadout.findFirst({
      where: eq(rankedLoadout.userId, ctx.userId),
    });
    if (!loadout) {
      loadout = {
        id: nanoid(),
        userId: ctx.userId,
        createdAt: new Date(),
        updatedAt: new Date(),
        loadout: {
          jutsuIds: [],
          weaponIds: [],
          consumableIds: [],
        },
      };
      await ctx.drizzle.insert(rankedLoadout).values(loadout);
    }
    return loadout;
  }),

  // Get the ranked PvP queue
  getRankedPvpQueue: protectedProcedure.query(async ({ ctx }) => {
    // Query
    const [user, queueEntry] = await Promise.all([
      fetchUser(ctx.drizzle, ctx.userId),
      fetchUserRankedQueue(ctx.drizzle, ctx.userId),
    ]);
    // Fix user status
    if (user.status === "QUEUED" && !queueEntry) {
      await ctx.drizzle
        .update(userData)
        .set({ status: "AWAKE" })
        .where(eq(userData.userId, ctx.userId));
    }
    // Get the queue count
    const queueCount = await ctx.drizzle
      .select({ count: sql<number>`count(*)` })
      .from(rankedPvpQueue)
      .then((result) => result[0]?.count ?? 0);

    return {
      inQueue: !!queueEntry,
      createdAt: queueEntry?.queueStartTime,
      queueCount,
    };
  }),

  // Update the ranked loadout
  updateRankedLoadout: protectedProcedure
    .input(rankedLoadoutSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query all relevant information
      const itemIds = [...input.weaponIds, ...input.consumableIds];
      const [items, jutsus, currentLoadout] = await Promise.all([
        itemIds.length > 0
          ? ctx.drizzle.query.item.findMany({
              where: and(inArray(item.id, itemIds), eq(item.inShop, true)),
            })
          : [],
        input.jutsuIds.length > 0
          ? ctx.drizzle.query.jutsu.findMany({
              where: inArray(jutsu.id, input.jutsuIds),
            })
          : [],
        ctx.drizzle.query.rankedLoadout.findFirst({
          where: eq(rankedLoadout.userId, ctx.userId),
        }),
      ]);
      // Split weapons and consumables
      const weapons = items.filter((item) => item.itemType === "WEAPON");
      const consumables = items.filter((item) => item.itemType === "CONSUMABLE");
      // Guard & ensure that all the items & jutsus exist and are of correct type
      if (!currentLoadout) {
        return errorResponse("No ranked loadout found");
      }
      if (items.length !== itemIds.length) {
        return errorResponse("Some items not found or not available in shop");
      }
      if (jutsus.length !== input.jutsuIds.length) {
        return errorResponse("Some jutsus not found or not available in shop");
      }
      // Check if items exist and are of correct type
      if (weapons.length > RANKED_LOADOUT_MAX_WEAPONS) {
        return errorResponse(
          `You can only equip up to ${RANKED_LOADOUT_MAX_WEAPONS} weapons`,
        );
      }
      if (consumables.length > RANKED_LOADOUT_MAX_CONSUMABLES) {
        return errorResponse(
          `You can only equip up to ${RANKED_LOADOUT_MAX_CONSUMABLES} consumables`,
        );
      }
      if (jutsus.length > RANKED_LOADOUT_MAX_JUTSUS) {
        return errorResponse(
          `You can only equip up to ${RANKED_LOADOUT_MAX_JUTSUS} jutsus`,
        );
      }
      // Run mutation
      await ctx.drizzle
        .update(rankedLoadout)
        .set({ loadout: input, updatedAt: new Date() })
        .where(eq(rankedLoadout.id, currentLoadout.id));
      // Return success
      return { success: true, message: "Ranked loadout updated successfully" };
    }),

  // Queue for ranked PVP battle
  queueForRankedPvp: protectedProcedure
    .output(baseServerResponse.extend({ battleId: z.string().optional() }))
    .mutation(async ({ ctx }) => {
      // Query
      const [existingQueue, user] = await Promise.all([
        fetchUserRankedQueue(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, ctx.userId),
      ]);
      // Guard
      if (existingQueue) {
        return errorResponse("Already in queue");
      }
      const result = await ctx.drizzle
        .update(userData)
        .set({ status: "QUEUED" })
        .where(and(eq(userData.userId, user.userId), eq(userData.status, "AWAKE")));
      if (result.rowsAffected === 0) return errorResponse("Need to be awake to queue");
      // Add to queue
      await ctx.drizzle.insert(rankedPvpQueue).values({
        id: nanoid(),
        userId: ctx.userId,
        rankedLp: user.rankedLp,
        queueStartTime: new Date(),
        createdAt: new Date(),
      });
      return { success: true, message: "Queued for ranked PvP" };
    }),

  // Leave the ranked PvP queue
  leaveRankedPvpQueue: protectedProcedure
    .output(baseServerResponse)
    .mutation(async ({ ctx }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard
      if (user.status !== "QUEUED") {
        return errorResponse("Not in the queue");
      }
      // Mutation
      await Promise.all([
        ctx.drizzle.delete(rankedPvpQueue).where(eq(rankedPvpQueue.userId, ctx.userId)),
        ctx.drizzle
          .update(userData)
          .set({ status: "AWAKE" })
          .where(eq(userData.userId, ctx.userId)),
      ]);
      return { success: true, message: "Left ranked PvP queue" };
    }),

  // Check for ranked PvP matches
  checkRankedPvpMatches: protectedProcedure
    .output(baseServerResponse.extend({ battleId: z.string().optional() }))
    .mutation(async ({ ctx }) => {
      // Get all queued players
      const queuedPlayers = await ctx.drizzle.query.rankedPvpQueue.findMany({
        with: { user: { columns: { status: true }, with: { rankedLoadout: true } } },
        orderBy: desc(rankedPvpQueue.queueStartTime),
      });

      const userEntry = queuedPlayers.find((p) => p.userId === ctx.userId);
      // Guards
      if (!userEntry) {
        return { success: false, message: "", battleId: undefined };
      }
      // Derived
      const secondsInQueue = secondsPassed(userEntry.queueStartTime);
      const lpRadius = getRankedRadius(secondsInQueue);
      const opponentEntry = queuedPlayers.find((opponent) => {
        if (opponent.userId === ctx.userId) return false;
        if (opponent.user?.status !== "QUEUED") return false;
        return Math.abs(opponent.rankedLp - userEntry.rankedLp) <= lpRadius;
      });
      // Guard
      if (!opponentEntry) {
        return { success: false, message: "", battleId: undefined };
      }
      if (!userEntry.user.rankedLoadout || !opponentEntry.user.rankedLoadout) {
        return { success: false, message: "No loadout found", battleId: undefined };
      }
      // Start battle
      const [result] = await Promise.all([
        initiateBattle(
          {
            userIds: [userEntry.userId],
            targetIds: [opponentEntry.userId],
            client: ctx.drizzle,
            asset: "arena",
            targetStatDistribution: RANKED_PVP_STATS,
            userStatDistribution: RANKED_PVP_STATS,
            forceLoadouts: [
              userEntry.user.rankedLoadout,
              opponentEntry.user.rankedLoadout,
            ],
          },
          "RANKED_PVP",
        ),
        ctx.drizzle
          .delete(rankedPvpQueue)
          .where(inArray(rankedPvpQueue.userId, [ctx.userId, opponentEntry.userId])),
      ]);
      if (result.success && result.battleId) {
        return { success: true, message: "Match found!", battleId: result.battleId };
      } else {
        return result;
      }
    }),
});

/**
 * Fetch the user's ranked PvP queue
 * @param client - The Drizzle client
 * @param userId - The user's ID
 * @returns The queue entry
 */
export const fetchUserRankedQueue = async (client: DrizzleClient, userId: string) => {
  return await client.query.rankedPvpQueue.findFirst({
    where: and(eq(rankedPvpQueue.userId, userId)),
    columns: {
      queueStartTime: true,
    },
  });
};

/**
 * Fetch all ranked seasons
 * @param client - The Drizzle client
 * @returns All ranked seasons
 */
export const fetchAllSeasons = async (client: DrizzleClient) => {
  return await client.query.rankedSeason.findMany({
    orderBy: (season, { desc }) => [desc(season.startDate)],
  });
};

/**
 * Fetch the current ranked season
 * @param client - The Drizzle client
 * @returns The current ranked season
 */
export const fetchCurrentSeason = async (client: DrizzleClient) => {
  const now = new Date();
  const season = await client.query.rankedSeason.findFirst({
    where: and(
      lte(rankedSeason.startDate, now),
      gte(rankedSeason.endDate, now),
      eq(rankedSeason.ended, false),
    ),
  });
  return season || null;
};

/**
 * Get the radius for a ranked PvP match
 * @param secondsInQueue - The number of seconds the player has been in the queue
 * @returns The radius for the match
 */
export const getRankedRadius = (secondsInQueue: number) => {
  if (secondsInQueue < 60) {
    return 50;
  } else if (secondsInQueue < 120) {
    return 100;
  } else if (secondsInQueue < 180) {
    return 150;
  } else if (secondsInQueue < 240) {
    return 200;
  } else if (secondsInQueue < 300) {
    return 250;
  } else {
    return 300;
  }
};

/**
 * Get the unclaimed season rewards for a user
 * @param client - The Drizzle client
 * @param userId - The user's ID
 * @returns The unclaimed season rewards
 */
export const getUnclaimedUserSeasonRewards = async (
  client: DrizzleClient,
  userId: string,
) => {
  const joinedResults = await client
    .select({
      id: rankedUserRewards.id,
      seasonId: rankedSeason.id,
      seasonName: rankedSeason.name,
      division: rankedUserRewards.division,
      claimed: rankedUserRewards.claimed,
      seasonRewards: rankedSeason.rewards,
      seasonEndDate: rankedSeason.endDate,
    })
    .from(rankedUserRewards)
    .innerJoin(rankedSeason, eq(rankedUserRewards.seasonId, rankedSeason.id))
    .where(
      and(eq(rankedUserRewards.userId, userId), eq(rankedUserRewards.claimed, false)),
    );
  return joinedResults.map((row) => {
    const divisionRewards = row.seasonRewards.find(
      (d) => d.division === row.division,
    )?.rewards;
    return { ...row, seasonRewards: divisionRewards };
  });
};

/**
 * End a ranked season
 * @param client - The Drizzle client
 * @param seasonId - The ID of the season to end
 */
export const endRankedSeason = async (client: DrizzleClient, seasonId: string) => {
  // Fetch users with LP > 0 and the season to end (validate again in case caller skipped)
  const [users, season] = await Promise.all([
    client.query.userData.findMany({
      columns: {
        userId: true,
        rankedLp: true,
      },
      orderBy: (userData, { desc }) => [desc(userData.rankedLp)],
      where: gt(userData.rankedLp, 0),
    }),
    client.query.rankedSeason.findFirst({
      where: eq(rankedSeason.id, seasonId),
    }),
  ]);

  if (!season) {
    throw new Error("Season not found");
  }
  if (season.ended) {
    return;
  }

  // Determine top players LP for "Sannin" rank calculation
  const topPlayersLP = users.slice(0, RANKED_SANNIN_TOP_PLAYERS).map((u) => u.rankedLp);

  // Prepare reward rows
  const rewardRows = users.map((user) => ({
    id: nanoid(),
    userId: user.userId,
    seasonId: season.id,
    division: getRankedRank(user.rankedLp, topPlayersLP),
  }));

  // Execute database updates in parallel (no explicit transaction)
  await Promise.all([
    // Reset LP for everyone
    client
      .update(userData)
      .set({ rankedLp: 0, rankedStreak: 0 })
      .where(gt(userData.rankedLp, 0)),
    // Mark season as ended
    client
      .update(rankedSeason)
      .set({ ended: true, endDate: new Date() })
      .where(eq(rankedSeason.id, season.id)),
    // Insert rewards rows if any
    rewardRows.length > 0 ? client.insert(rankedUserRewards).values(rewardRows) : null,
  ]);
};
