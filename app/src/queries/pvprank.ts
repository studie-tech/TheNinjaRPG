/**
 * Database access for pvprank; authorization and transaction scopes stay in callers.
 */
import {
  and,
  asc,
  count,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  notExists,
  type SQL,
  sql,
} from "drizzle-orm";
import {
  PVP_EXPERIENCE_DAILY_DECAY,
  RANKED_ENTRY_COST,
  RANKED_LEGEND_LP_REQUIREMENT,
  RANKED_SANNIN_TOP_PLAYERS,
  type RankedRank,
} from "@/drizzle/constants";
import {
  battleHistory,
  item,
  logQueueLengths,
  logRankedPicks,
  mpvpBattleQueue,
  mpvpBattleUser,
  rankedLoadout,
  rankedPvpQueue,
  rankedSeason,
  rankedUserRewards,
  userData,
} from "@/drizzle/schema";
import { withoutDungeonReservation } from "@/queries/dungeonReservation";
import type { DrizzleClient } from "@/server/db";
import type { RankedLoadoutSchema } from "@/validators/pvpRank";

/** Build the `userData` selection for `decayPlayerPvpExperience`, using the configured predicates. */
export const selectUserDataForDecayPlayerPvpExperience = (
  client: Pick<DrizzleClient, "select">,
  pending: undefined | SQL<unknown>,
) => client.select({ userId: userData.userId }).from(userData).where(pending);

/**
 * Build the `userData` update for `decayPlayerPvpExperience`, setting `pvpExperience`
 * and `pvpExperienceDecayAt`, using predicates on `userId`.
 */
export const updateUserDataForDecayPlayerPvpExperience = (
  client: Pick<DrizzleClient, "update">,
  dayStart: Date,
  batch: string[],
  pending: undefined | SQL<unknown>,
) =>
  client
    .update(userData)
    .set({
      pvpExperience: sql`FLOOR(${userData.pvpExperience} * ${1 - PVP_EXPERIENCE_DAILY_DECAY} * 100) / 100`,
      pvpExperienceDecayAt: dayStart,
    })
    .where(and(inArray(userData.userId, batch), pending));

/** Build the `rankedSeason` listing for `GET`, using predicates on `ended`. */
export const listRankedSeasonForGET = (client: Pick<DrizzleClient, "query">) =>
  client.query.rankedSeason.findMany({
    where: and(eq(rankedSeason.ended, false)),
  });

/** Execute the database statement for `GET`. */
export const executeRowsForGET = (
  client: Pick<DrizzleClient, "execute">,
  fiveDaysAgo: Date,
) =>
  client.execute(
    sql`
          UPDATE ${userData} u
          LEFT JOIN (
            SELECT attackedId AS userId FROM ${battleHistory}
            WHERE battleType = 'RANKED_PVP' AND createdAt > ${fiveDaysAgo}
            UNION
            SELECT defenderId AS userId FROM ${battleHistory}
            WHERE battleType = 'RANKED_PVP' AND createdAt > ${fiveDaysAgo}
          ) b ON u.userId = b.userId
          SET u.rankedLp = u.rankedLp - 70
          WHERE u.rankedLp > 899 AND b.userId IS NULL
        `,
  );

/** Build the `userData` update for `GET`, setting `rankedStreak`, using predicates on `rankedLp`. */
export const updateUserDataForGET = (client: Pick<DrizzleClient, "update">) =>
  client
    .update(userData)
    .set({
      rankedStreak: 0,
    })
    .where(gt(userData.rankedLp, 0));

/** Build the weekly PvP kill-counter reset for accounts whose recorded week precedes the caller-captured week start. */
export const updateUserDataForWeeklyPvpReset = (
  client: Pick<DrizzleClient, "update">,
  weekStart: Date,
) =>
  client
    .update(userData)
    .set({
      weeklyPvpKills: 0,
      weeklyPvpKillsAt: weekStart,
    })
    .where(lt(userData.weeklyPvpKillsAt, weekStart));

/**
 * Fetch the user's claimed ranked PvP queue, excluding joins still acquiring status.
 * @param client - The Drizzle client
 * @param userId - The user's ID
 * @returns The queue entry
 */
export const fetchUserRankedQueue = async (client: DrizzleClient, userId: string) => {
  return await client.query.rankedPvpQueue.findFirst({
    where: and(eq(rankedPvpQueue.userId, userId), eq(rankedPvpQueue.hasClaimed, true)),
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
 * Build the `rankedUserRewards` update for `claimSeasonRewards`, setting `claimed` and
 * `claimedAt`, using predicates on `userId`, `id`, `claimed`.
 */
export const updateRankedUserRewardsForClaimSeasonRewards = (
  client: Pick<DrizzleClient, "update">,
  ctx: { userId: string },
  rewardIds: string[],
) =>
  client
    .update(rankedUserRewards)
    .set({ claimed: true, claimedAt: new Date() })
    .where(
      and(
        eq(rankedUserRewards.userId, ctx.userId),
        inArray(rankedUserRewards.id, rewardIds),
        eq(rankedUserRewards.claimed, false),
      ),
    );

/** Build the `rankedSeason` insert for `createSeason`. */
export const insertRankedSeasonForCreateSeason = (
  client: Pick<DrizzleClient, "insert">,
  id: string,
  seasonData: Pick<
    import("@/drizzle/schema").RankedSeason,
    "name" | "description" | "rewards" | "startDate" | "endDate" | "paused"
  >,
) =>
  client.insert(rankedSeason).values({
    id,
    ...seasonData,
  });

/** Build the `rankedSeason` update for `updateSeason`, setting `updatedAt`, using predicates on `id`. */
export const updateRankedSeasonForUpdateSeason = (
  client: Pick<DrizzleClient, "update">,
  data: Pick<
    import("@/drizzle/schema").RankedSeason,
    "name" | "description" | "rewards" | "startDate" | "endDate" | "paused"
  >,
  id: string,
) =>
  client
    .update(rankedSeason)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(rankedSeason.id, id));

/** Build the `rankedSeason` deletion for `deleteSeason`, using predicates on `id`. */
export const deleteRankedSeasonForDeleteSeason = (
  client: Pick<DrizzleClient, "delete">,
  input: { id: string },
) => client.delete(rankedSeason).where(eq(rankedSeason.id, input.id));

/** Build the `rankedUserRewards` deletion for `deleteSeason`, using predicates on `seasonId`. */
export const deleteRankedUserRewardsForDeleteSeason = (
  client: Pick<DrizzleClient, "delete">,
  input: { id: string },
) => client.delete(rankedUserRewards).where(eq(rankedUserRewards.seasonId, input.id));

/** Build a user’s ranked loadout lookup. */
export const findRankedLoadoutByUserId = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
) =>
  client.query.rankedLoadout.findFirst({
    where: eq(rankedLoadout.userId, userId),
  });

/** Build the `rankedLoadout` insert for `getRankedLoadout`. */
export const insertRankedLoadoutForGetRankedLoadout = (
  client: Pick<DrizzleClient, "insert">,
  loadout: import("@/drizzle/schema").RankedLoadout,
) => client.insert(rankedLoadout).values(loadout);

/**
 * Build the `userData` update for `getRankedPvpQueue`, setting `status`, including
 * predicates on `userId`, `status`, `id`.
 */
export const updateUserDataForGetRankedPvpQueue = (
  client: Pick<DrizzleClient, "update" | "select">,
  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set({ status: "ASLEEP" })
    .where(
      and(
        eq(userData.userId, ctx.userId),
        eq(userData.status, "QUEUED"),
        withoutDungeonReservation(),
        // Independent reads may precede a ranked claim or belong to a clan lobby.
        notExists(
          client
            .select({ id: rankedPvpQueue.id })
            .from(rankedPvpQueue)
            .where(
              and(
                eq(rankedPvpQueue.userId, userData.userId),
                eq(rankedPvpQueue.hasClaimed, true),
              ),
            ),
        ),
        notExists(
          client
            .select({ id: mpvpBattleUser.id })
            .from(mpvpBattleUser)
            .innerJoin(
              mpvpBattleQueue,
              eq(mpvpBattleUser.clanBattleId, mpvpBattleQueue.id),
            )
            .where(
              and(
                eq(mpvpBattleUser.userId, userData.userId),
                isNull(mpvpBattleQueue.winnerId),
              ),
            ),
        ),
      ),
    );

/** Build the `rankedPvpQueue` selection for `getRankedPvpQueue`, using predicates on `hasClaimed`. */
export const selectRankedPvpQueueForGetRankedPvpQueue = (
  client: Pick<DrizzleClient, "select">,
) =>
  client
    .select({ count: count() })
    .from(rankedPvpQueue)
    .where(eq(rankedPvpQueue.hasClaimed, true));

/** Build the `item` listing for `updateRankedLoadout`, using predicates on `id` and `inShop`. */
export const listItemForUpdateRankedLoadout = (
  client: Pick<DrizzleClient, "query">,
  itemIds: string[],
) =>
  client.query.item.findMany({
    where: and(inArray(item.id, itemIds), eq(item.inShop, true)),
  });

/**
 * Build the `rankedLoadout` update for `updateRankedLoadout`, setting `loadout` and
 * `updatedAt`, using predicates on `id`.
 */
export const updateRankedLoadoutForUpdateRankedLoadout = (
  client: Pick<DrizzleClient, "update">,
  loadout: RankedLoadoutSchema,
  currentLoadout: { id: string },
) =>
  client
    .update(rankedLoadout)
    .set({
      loadout,
      updatedAt: sql`GREATEST(NOW(3), TIMESTAMPADD(MICROSECOND, 1000, ${rankedLoadout.updatedAt}))`,
    })
    .where(eq(rankedLoadout.id, currentLoadout.id));

/**
 * Build the `userData` update for `enterRankedSeason`, setting `rankedLp` and
 * `villagePrestige`, using predicates on `userId`.
 */
export const updateUserDataForEnterRankedSeason = (
  client: Pick<DrizzleClient, "update">,
  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set({
      rankedLp: 150,
      villagePrestige: sql`${userData.villagePrestige} - ${RANKED_ENTRY_COST}`,
    })
    .where(
      and(
        eq(userData.userId, ctx.userId),
        lte(userData.rankedLp, 0),
        gte(userData.villagePrestige, RANKED_ENTRY_COST),
      ),
    );

/** Build the `rankedPvpQueue` insert for `queueForRankedPvp`. */
export const insertRankedPvpQueueForQueueForRankedPvp = (
  client: Pick<DrizzleClient, "insert">,
  queueId: string,
  ctx: { userId: string },
  user: { rankedLp: number },
) =>
  client.insert(rankedPvpQueue).values({
    id: queueId,
    userId: ctx.userId,
    rankedLp: user.rankedLp,
    hasClaimed: false,
    queueStartTime: new Date(),
    createdAt: new Date(),
  });

/** Execute the database statement for `queueForRankedPvp`. */
export const executeResultForQueueForRankedPvp = (
  client: Pick<DrizzleClient, "execute">,
  user: { userId: string },
  queueId: string,
) =>
  client.execute(sql`
            UPDATE ${userData}
            INNER JOIN ${rankedPvpQueue}
              ON ${rankedPvpQueue.userId} = ${userData.userId}
            SET ${userData.status} = 'QUEUED', ${rankedPvpQueue.hasClaimed} = true
            WHERE ${userData.userId} = ${user.userId}
              AND ${userData.status} = 'AWAKE'
              AND ${rankedPvpQueue.id} = ${queueId}
              AND ${rankedPvpQueue.hasClaimed} = false
          `);

/** Build the `rankedPvpQueue` deletion for `queueForRankedPvp`, using predicates on `id` and `hasClaimed`. */
export const deleteRankedPvpQueueForQueueForRankedPvp = (
  client: Pick<DrizzleClient, "delete">,
  queueId: string,
) =>
  client
    .delete(rankedPvpQueue)
    .where(and(eq(rankedPvpQueue.id, queueId), eq(rankedPvpQueue.hasClaimed, false)));

/** Build the `userData` lookup for `leaveRankedPvpQueue`, selecting only `battleId`, using predicates on `userId`. */
export const findUserDataForLeaveRankedPvpQueue = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.userData.findFirst({
    columns: { battleId: true },
    where: eq(userData.userId, ctx.userId),
  });

/** Build the `rankedPvpQueue` listing for `checkRankedPvpMatches`, using predicates on `hasClaimed`. */
export const listRankedPvpQueueForCheckRankedPvpMatches = (
  client: Pick<DrizzleClient, "query">,
) =>
  client.query.rankedPvpQueue.findMany({
    where: eq(rankedPvpQueue.hasClaimed, true),
    with: { user: { columns: { status: true }, with: { rankedLoadout: true } } },
    orderBy: asc(rankedPvpQueue.queueStartTime),
  });

/** Build the `rankedPvpQueue` deletion for `checkRankedPvpMatches`, using predicates on `userId`. */
export const deleteRankedPvpQueueForCheckRankedPvpMatches = (
  client: Pick<DrizzleClient, "delete">,
  ctx: { userId: string },
  opponentEntry: { userId: string },
) =>
  client
    .delete(rankedPvpQueue)
    .where(inArray(rankedPvpQueue.userId, [ctx.userId, opponentEntry.userId]));

/** Build the `logQueueLengths` insert for `checkRankedPvpMatches`, updating duplicate keys. */
export const insertLogQueueLengthsForCheckRankedPvpMatches = (
  client: Pick<DrizzleClient, "insert">,
  rankedRank: RankedRank,
  secondsInQueue: number,
) =>
  client
    .insert(logQueueLengths)
    .values({
      rankedRank: rankedRank,
      ceiledMinutes: Math.ceil(secondsInQueue / 60),
      count: 1,
    })
    .onDuplicateKeyUpdate({
      set: { count: sql`${logQueueLengths.count} + 1` },
    });

/** Build the `logRankedPicks` insert for `checkRankedPvpMatches`, updating duplicate keys. */
export const insertLogRankedPicksForCheckRankedPvpMatches = (
  client: Pick<DrizzleClient, "insert">,
  rankedPickRows: (
    | { type: "jutsu"; contentId: string; battleType: "RANKED_PVP"; count: number }
    | { type: "item"; contentId: string; battleType: "RANKED_PVP"; count: number }
    | { type: "consumable"; contentId: string; battleType: "RANKED_PVP"; count: number }
  )[],
) =>
  client
    .insert(logRankedPicks)
    .values(rankedPickRows)
    .onDuplicateKeyUpdate({
      set: { count: sql`${logRankedPicks.count} + 1` },
    });

/** Build the `rankedPvpQueue` deletion for `deleteUserRankedQueueRow`, using predicates on `userId` and `status`. */
export const deleteRankedPvpQueueForDeleteUserRankedQueueRow = (
  client: Pick<DrizzleClient, "delete" | "select">,
  userId: string,
  onlyIfNotQueued: false | true,
) =>
  client.delete(rankedPvpQueue).where(
    and(
      eq(rankedPvpQueue.userId, userId),
      onlyIfNotQueued
        ? notExists(
            client
              .select({ userId: userData.userId })
              .from(userData)
              .where(and(eq(userData.userId, userId), eq(userData.status, "QUEUED"))),
          )
        : undefined,
    ),
  );

/**
 * Build the `rankedUserRewards` selection for `getUnclaimedUserSeasonRewards`, using
 * predicates on `userId` and `claimed`.
 */
export const selectRankedUserRewardsForGetUnclaimedUserSeasonRewards = (
  client: Pick<DrizzleClient, "select">,
  userId: string,
) =>
  client
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

/**
 * Build the `userData` listing for `endRankedSeason`, selecting only `userId` and
 * `rankedLp`, using predicates on `rankedLp`.
 */
export const listUserDataForEndRankedSeason = (client: Pick<DrizzleClient, "query">) =>
  client.query.userData.findMany({
    columns: {
      userId: true,
      rankedLp: true,
    },
    orderBy: (userData, { desc }) => [desc(userData.rankedLp)],
    where: gt(userData.rankedLp, 0),
  });

/** Build a ranked season lookup by ID. */
export const findRankedSeasonById = (
  client: Pick<DrizzleClient, "query">,
  seasonId: string,
) =>
  client.query.rankedSeason.findFirst({
    where: eq(rankedSeason.id, seasonId),
  });

/**
 * Build the `userData` update for `endRankedSeason`, setting `rankedLp` and
 * `rankedStreak`, using predicates on `rankedLp`.
 */
export const updateUserDataForEndRankedSeason = (
  client: Pick<DrizzleClient, "update">,
) =>
  client
    .update(userData)
    .set({ rankedLp: 0, rankedStreak: 0 })
    .where(gt(userData.rankedLp, 0));

/** Build the `rankedSeason` update for `endRankedSeason`, setting `ended` and `endDate`, using predicates on `id`. */
export const updateRankedSeasonForEndRankedSeason = (
  client: Pick<DrizzleClient, "update">,
  season: { id: string },
) =>
  client
    .update(rankedSeason)
    .set({ ended: true, endDate: new Date() })
    .where(eq(rankedSeason.id, season.id));

/** Build the `rankedUserRewards` insert for `endRankedSeason`. */
export const insertRankedUserRewardsForEndRankedSeason = (
  client: Pick<DrizzleClient, "insert">,
  rewardRows: Pick<
    import("@/drizzle/schema").RankedUserRewards,
    "id" | "userId" | "division" | "seasonId"
  >[],
) => client.insert(rankedUserRewards).values(rewardRows);

/** Build the `rankedPvpQueue` count for `getRankedQueueCount`. */
export const countRankedPvpQueueForGetRankedQueueCount = (
  client: Pick<DrizzleClient, "$count">,
) => client.$count(rankedPvpQueue, eq(rankedPvpQueue.hasClaimed, true));

/** Build deletion of a user’s ranked PvP queue entry. */
export const deleteRankedQueueForUser = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(rankedPvpQueue).where(eq(rankedPvpQueue.userId, userId));

/** Build the `userData` selection for `loadAverage`, using predicates on `isAi`. */
export const selectUserDataForLoadAverage = (client: Pick<DrizzleClient, "select">) =>
  client
    .select({
      average: sql<number>`COALESCE(AVG(${userData.pvpExperience}), 0)`.mapWith(Number),
    })
    .from(userData, { forceIndex: "UserData_pvpExperienceAverage_idx" })
    .where(eq(userData.isAi, false));

/**
 * Build the `userData` listing for `fetchSanninRankedPlayers`, selecting only `userId`
 * and `rankedLp`, using predicates on `rankedLp`.
 */
export const listUserDataForFetchSanninRankedPlayers = (
  client: Pick<DrizzleClient, "query">,
) =>
  client.query.userData.findMany({
    columns: {
      userId: true,
      rankedLp: true,
    },
    orderBy: (userData, { desc }) => [desc(userData.rankedLp)],
    where: gte(userData.rankedLp, RANKED_LEGEND_LP_REQUIREMENT),
    limit: RANKED_SANNIN_TOP_PLAYERS,
  });

/**
 * Build the `rankedLoadout` update for `cleanRankedProhibitedSelections`, setting
 * `loadout` and `updatedAt`, using predicates on `id` and `updatedAt`.
 */
export const updateRankedLoadoutForCleanRankedProhibitedSelections = (
  client: Pick<DrizzleClient, "update">,
  loadout: { loadout: import("@/validators/pvpRank").RankedLoadoutSchema },
  nextUpdatedAt: Date,
  storedLoadout: { id: string; updatedAt: Date },
) =>
  client
    .update(rankedLoadout)
    .set({ loadout: loadout.loadout, updatedAt: nextUpdatedAt })
    .where(
      and(
        eq(rankedLoadout.id, storedLoadout.id),
        eq(rankedLoadout.updatedAt, storedLoadout.updatedAt),
      ),
    );

/** Build the `rankedLoadout` lookup for `cleanRankedProhibitedSelections`, using predicates on `id`. */
export const findRankedLoadoutForCleanRankedProhibitedSelections = (
  client: Pick<DrizzleClient, "query">,
  storedLoadout: { id: string },
) =>
  client.query.rankedLoadout.findFirst({
    where: eq(rankedLoadout.id, storedLoadout.id),
  });

/** Confirm reward counters whose SQL grants include live caps and pet eligibility. */
export const findSeasonRewardUserSnapshot = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
) =>
  client.query.userData.findFirst({
    columns: {
      money: true,
      seichiSilver: true,
      earnedExperience: true,
      petExperience: true,
      villagePrestige: true,
      reputationPoints: true,
      reputationPointsTotal: true,
      skillPoints: true,
      medicalExperience: true,
      huntingExperience: true,
      craftingExperience: true,
      gatheringExperience: true,
      sageMasteryExperience: true,
      ninjutsuMastery: true,
      genjutsuMastery: true,
      taijutsuMastery: true,
      bukijutsuMastery: true,
      bloodlineMastery: true,
      sageMastery: true,
      masteryRanks: true,
    },
    with: { village: { columns: { id: true, tokens: true } } },
    where: eq(userData.userId, userId),
  });
