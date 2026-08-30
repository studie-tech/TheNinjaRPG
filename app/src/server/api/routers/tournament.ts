import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { TournamentMatchState } from "@/drizzle/constants";
import { TOURNAMENT_ROUND_SECONDS } from "@/drizzle/constants";
import type { TournamentMatch } from "@/drizzle/schema";
import {
  clan,
  tournament,
  tournamentMatch,
  tournamentRecord,
  userData,
} from "@/drizzle/schema";
import { getServerPusher } from "@/libs/pusher";
import { postProcessRewards } from "@/libs/quest";
import { fetchClan } from "@/routers/clan";
import { initiateBattle } from "@/routers/combat";
import { fetchUser } from "@/routers/profile";
import { updateRewards } from "@/routers/quests";
import type { BaseServerResponse } from "@/server/api/trpc";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { secondsFromDate } from "@/utils/time";
import { checkCoLeader } from "@/validators/clan";
import { ObjectiveReward } from "@/validators/rewards";
import { tournamentCreateSchema } from "@/validators/tournament";

const TOURNAMENT_FINALIZATION_INCOMPLETE =
  "Tournament finalization incomplete. Staff recovery required.";

export const tournamentRouter = createTRPCRouter({
  // Advances rounds and finalizes payouts via syncTournamentState before each read so clients
  // need not call syncTournament separately (authenticated tRPC; not edge-cacheable like static GET).
  getTournament: protectedProcedure
    .meta({
      mcp: {
        enabled: true,
        description:
          "Get tournament details and matches (includes automatic round sync / finalization)",
      },
    })
    .input(z.object({ tournamentId: z.string() }))
    .query(async ({ ctx, input }) => {
      await syncTournamentState(ctx.drizzle, input.tournamentId);
      return (await fetchTournament(ctx.drizzle, input.tournamentId)) ?? null;
    }),
  syncTournament: protectedProcedure
    .meta({
      mcp: {
        enabled: true,
        description:
          "Synchronize tournament progression (also runs when loading tournament details)",
      },
    })
    .input(z.object({ tournamentId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      return await syncTournamentState(ctx.drizzle, input.tournamentId);
    }),
  createTournament: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Create a new tournament" } })
    .input(tournamentCreateSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, clanData, tournamentData] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchClan(ctx.drizzle, input.id),
        fetchTournament(ctx.drizzle, input.id),
      ]);
      // General guards
      if (!user) return errorResponse("User not found");
      if (tournamentData) return errorResponse("Tournament already exists found.");
      // Specific guards & updates
      if (input.type === "CLAN") {
        if (!clanData) return errorResponse("Clan not found.");
        const isLeader = user.userId === clanData?.leaderId;
        const isColeader = checkCoLeader(user.userId, clanData);
        if (!isLeader && !isColeader) return errorResponse("Must be leader");
        input.rewards = ObjectiveReward.parse({ reward_money: clanData.bank });
        await ctx.drizzle.update(clan).set({ bank: 0 }).where(eq(clan.id, clanData.id));
      }
      // Insert tournament
      await ctx.drizzle.insert(tournament).values(input);
      // Return
      return { success: true, message: "Tournament created." };
    }),
  joinTournament: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Join an existing tournament" } })
    .input(z.object({ tournamentId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, clanData, tournamentData] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchClan(ctx.drizzle, input.tournamentId),
        fetchTournament(ctx.drizzle, input.tournamentId),
      ]);
      // Derived
      const matches = tournamentData?.matches ?? [];
      // General guards
      if (!user) return errorResponse("User not found");
      if (!tournamentData) return errorResponse("Tournament not found.");
      if (matches.find((m) => [m.userId1, m.userId2].includes(user.userId))) {
        return errorResponse("User already in tournament.");
      }
      // Specific guards
      if (tournamentData.type === "CLAN") {
        if (!clanData) return errorResponse("Clan not found.");
        if (user.clanId !== clanData.id) return errorResponse("User not in clan.");
      }
      // Mutate
      const availableMatch = matches.find((m) => !m.userId1 || !m.userId2);
      if (availableMatch) {
        await ctx.drizzle
          .update(tournamentMatch)
          .set({
            userId1: sql`CASE WHEN ${tournamentMatch.userId1} IS NULL THEN ${user.userId} ELSE ${tournamentMatch.userId1} END`,
            userId2: sql`CASE WHEN ${tournamentMatch.userId2} IS NULL THEN ${user.userId} ELSE ${tournamentMatch.userId2} END`,
          })
          .where(eq(tournamentMatch.id, availableMatch.id));
      } else {
        await ctx.drizzle.insert(tournamentMatch).values({
          id: nanoid(),
          tournamentId: input.tournamentId,
          round: tournamentData.round,
          userId1: user.userId,
          match: tournamentData.matches.length + 1,
          startedAt: tournamentData.startedAt,
        });
      }
      // Return
      return { success: true, message: "Joined Tournament" };
    }),
  joinMatch: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Join a tournament match" } })
    .input(z.object({ matchId: z.string(), tournamentId: z.string() }))
    .output(baseServerResponse.extend({ battleId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, matchData, tournamentData] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchMatch(ctx.drizzle, input.matchId),
        fetchTournament(ctx.drizzle, input.tournamentId),
      ]);
      // General guards
      if (!user) return errorResponse("User not found");
      if (!matchData) return errorResponse("Match not found.");
      if (!tournamentData) return errorResponse("Tournament not found.");
      if (tournamentData.round !== matchData.round) {
        return errorResponse("Match not in current round.");
      }
      if (matchData?.tournamentId !== input.tournamentId) {
        return errorResponse("Match not in tournament.");
      }
      if (![matchData.userId1, matchData.userId2].includes(user.userId)) {
        return errorResponse("Not in this match.");
      }
      // Ensure all users are awake
      await ctx.drizzle
        .update(userData)
        .set({
          status: "AWAKE",
          curHealth: sql`CASE WHEN ${userData.curHealth} < 0 THEN 1 ELSE ${userData.curHealth} END`,
        })
        .where(
          inArray(userData.userId, [matchData.userId1 ?? "", matchData.userId2 ?? ""]),
        );
      // Start the battle
      let result: Awaited<ReturnType<typeof initiateBattle>> | undefined;
      if (matchData.userId1 && matchData.userId2) {
        result = await initiateBattle(
          {
            userIds: [matchData.userId2],
            targetIds: [matchData.userId1],
            client: ctx.drizzle,
            biome: "arena",
          },
          "TOURNAMENT",
        );
      }
      // We we failed to create battle, let this user win by default
      if (!result?.success) {
        await setMatchWinner(ctx.drizzle, input.matchId, user.userId, "NO_SHOW");
      } else {
      }
      // Return
      return { success: true, message: "Joined Match", battleId: result?.battleId };
    }),
});

/**
 * Fetches a tournament from the database.
 * @param {DrizzleClient} client - The Drizzle client used to query the database.
 * @param {string} tournamentId - The ID of the tournament to fetch.
 * @returns {Promise<Tournament>} - A promise that resolves to the fetched tournament.
 */
export const fetchTournament = async (client: DrizzleClient, tournamentId: string) => {
  return client.query.tournament.findFirst({
    where: and(eq(tournament.id, tournamentId), ne(tournament.status, "COMPLETED")),
    with: {
      matches: {
        with: {
          user1: { columns: { userId: true, username: true, avatar: true } },
          user2: { columns: { userId: true, username: true, avatar: true } },
        },
        orderBy: (table, { asc }) => [asc(table.match)],
      },
    },
  });
};

const fetchTournamentForSync = async (client: DrizzleClient, tournamentId: string) => {
  return client.query.tournament.findFirst({
    where: eq(tournament.id, tournamentId),
    with: {
      matches: {
        with: {
          user1: { columns: { userId: true, username: true, avatar: true } },
          user2: { columns: { userId: true, username: true, avatar: true } },
        },
        orderBy: (table, { asc }) => [asc(table.match)],
      },
    },
  });
};

const fetchTournamentRecord = async (client: DrizzleClient, tournamentId: string) => {
  return client.query.tournamentRecord.findFirst({
    where: eq(tournamentRecord.id, tournamentId),
  });
};

const cleanupCompletedTournament = async (
  client: DrizzleClient,
  tournamentId: string,
) => {
  await Promise.all([
    client
      .delete(tournamentMatch)
      .where(eq(tournamentMatch.tournamentId, tournamentId)),
    client
      .delete(tournament)
      .where(and(eq(tournament.id, tournamentId), eq(tournament.status, "COMPLETED"))),
  ]);
};

/**
 * Fetches a tournament match from the database.
 *
 * @param {DrizzleClient} client - The Drizzle client used to query the database.
 * @param {string} matchId - The ID of the match to fetch.
 * @returns {Promise<TournamentMatch | null>} - A promise that resolves to the fetched match, or null if not found.
 */
export const fetchMatch = async (client: DrizzleClient, matchId: string) => {
  return client.query.tournamentMatch.findFirst({
    where: eq(tournamentMatch.id, matchId),
    with: {
      user1: { columns: { userId: true, username: true, avatar: true } },
      user2: { columns: { userId: true, username: true, avatar: true } },
    },
  });
};

/**
 * Sets the winner of a match in a tournament.
 *
 * @param {DrizzleClient} client - The Drizzle client used to update the tournament match.
 * @param {string} matchId - The ID of the match.
 * @param {string} winnerId - The ID of the winner.
 * @returns {Promise<boolean>} - A promise that resolves to true if the winner is successfully set.
 * @throws {Error} - If the match is not found or the winner is not in the match.
 */
export const setMatchWinner = async (
  client: DrizzleClient,
  matchId: string,
  winnerId: string,
  state: TournamentMatchState = "PLAYED",
) => {
  const result = await client
    .update(tournamentMatch)
    .set({ winnerId, state })
    .where(
      and(
        eq(tournamentMatch.id, matchId),
        or(
          eq(tournamentMatch.userId1, winnerId),
          eq(tournamentMatch.userId2, winnerId),
        ),
      ),
    );
  if (result.rowsAffected === 0) {
    throw new Error("Match not found or winner not in match.");
  }
  return true;
};

/**
 * Retrieves the winner ID of a tournament match.
 * If the match has a winner ID, it is returned.
 * If the match has two user IDs, a random winner is determined.
 * If the match has only one user ID, that user is considered the winner.
 *
 * @param match - The tournament match object.
 * @returns The winner ID of the tournament match.
 */
const getWinner = (match: TournamentMatch) => {
  if (match.winnerId) return match.winnerId;
  if (match.userId2) return Math.random() > 0.5 ? match.userId1 : match.userId2;
  return match.userId1;
};

type TournamentSyncData = NonNullable<
  Awaited<ReturnType<typeof fetchTournamentForSync>>
>;

/** OPEN → IN_PROGRESS when start time passed; refetches on successful CAS. */
const promoteOpenTournamentIfStarted = async (
  client: DrizzleClient,
  tournamentId: string,
  data: TournamentSyncData,
  now: Date,
): Promise<[TournamentSyncData, BaseServerResponse | null]> => {
  if (data.status !== "OPEN" || now <= data.startedAt) {
    return [data, null];
  }
  const startResult = await client
    .update(tournament)
    .set({ status: "IN_PROGRESS" })
    .where(and(eq(tournament.id, tournamentId), eq(tournament.status, "OPEN")));

  if (startResult.rowsAffected > 0) {
    const refetched = await fetchTournamentForSync(client, tournamentId);
    if (!refetched) {
      return [data, { success: true, message: "Tournament synchronized." }];
    }
    return [refetched, null];
  }
  return [data, null];
};

/** Returns a response when the round is still playing or multi-match bracket advanced; otherwise null. */
const tryAdvanceTournamentRoundOrWait = async (
  client: DrizzleClient,
  tournamentId: string,
  currentData: TournamentSyncData,
  matches: TournamentMatch[],
  now: Date,
  roundEndAt: Date,
  allWon: boolean,
): Promise<BaseServerResponse | null> => {
  if (currentData.status === "IN_PROGRESS" && !(now > roundEndAt || allWon)) {
    return { success: true, message: "Tournament synchronized." };
  }

  if (currentData.status === "IN_PROGRESS" && matches.length > 1) {
    const nextRoundStartedAt = new Date();
    const nextRoundMatches: TournamentMatch[] = [];

    for (let i = 0; i < matches.length; i += 2) {
      const firstMatch = matches[i];
      const secondMatch = matches[i + 1];
      const winner1 = firstMatch ? getWinner(firstMatch) : null;
      const winner2 = secondMatch ? getWinner(secondMatch) : null;
      if (winner1) {
        nextRoundMatches.push({
          id: nanoid(),
          tournamentId,
          round: currentData.round + 1,
          userId1: winner1,
          userId2: winner2 ?? null,
          match: currentData.matches.length + i / 2 + 1,
          startedAt: nextRoundStartedAt,
          createdAt: nextRoundStartedAt,
          battleId: null,
          winnerId: null,
          state: "WAITING",
        });
      }
    }

    const roundAdvanceResult = await client
      .update(tournament)
      .set({ round: currentData.round + 1, roundStartedAt: nextRoundStartedAt })
      .where(
        and(
          eq(tournament.id, tournamentId),
          eq(tournament.status, "IN_PROGRESS"),
          eq(tournament.round, currentData.round),
          eq(tournament.roundStartedAt, currentData.roundStartedAt),
        ),
      );

    if (roundAdvanceResult.rowsAffected > 0 && nextRoundMatches.length > 0) {
      await client.insert(tournamentMatch).values(nextRoundMatches);
    }

    return { success: true, message: "Tournament synchronized." };
  }

  return null;
};

/** Existing TournamentRecord rows: cleanup or staff-recovery errors. */
const handleTournamentRecordLedger = async (
  client: DrizzleClient,
  tournamentId: string,
  currentData: TournamentSyncData,
): Promise<BaseServerResponse | null> => {
  const existingRecord = await fetchTournamentRecord(client, tournamentId);
  if (!existingRecord) return null;
  if (!existingRecord.winnerId) {
    return errorResponse(TOURNAMENT_FINALIZATION_INCOMPLETE);
  }
  if (currentData.status === "COMPLETED") {
    await cleanupCompletedTournament(client, tournamentId);
    return { success: true, message: "Tournament synchronized." };
  }
  return errorResponse(TOURNAMENT_FINALIZATION_INCOMPLETE);
};

/** Final single-match finalization: ledger insert (winnerId null) → COMPLETED CAS → updateRewards → set winner on ledger → cleanup → pusher. */
const finalizeTournamentAndPayWinner = async (
  client: DrizzleClient,
  tournamentId: string,
  currentData: TournamentSyncData,
  finalMatch: TournamentMatch,
  rewardWinner: typeof updateRewards,
): Promise<BaseServerResponse> => {
  const winnerId = getWinner(finalMatch);
  if (!winnerId) {
    return { success: true, message: "Tournament synchronized." };
  }

  if (currentData.status !== "IN_PROGRESS") {
    return errorResponse(TOURNAMENT_FINALIZATION_INCOMPLETE);
  }

  const winner = await fetchUser(client, winnerId);
  if (!winner) {
    return errorResponse("Tournament winner not found.");
  }

  try {
    await client.insert(tournamentRecord).values({
      id: tournamentId,
      name: currentData.name,
      image: currentData.image,
      description: currentData.description,
      round: currentData.round,
      type: currentData.type,
      rewards: currentData.rewards,
      startedAt: currentData.startedAt,
      winnerId: null,
    });
  } catch (error) {
    const recordAfterInsertError = await fetchTournamentRecord(client, tournamentId);
    if (recordAfterInsertError?.winnerId) {
      const latestTournament = await fetchTournamentForSync(client, tournamentId);
      if (latestTournament?.status === "COMPLETED") {
        await cleanupCompletedTournament(client, tournamentId);
        return { success: true, message: "Tournament synchronized." };
      }
      return { success: true, message: "Tournament synchronized." };
    }
    if (recordAfterInsertError) {
      return errorResponse(TOURNAMENT_FINALIZATION_INCOMPLETE);
    }
    throw error;
  }

  const finalizeResult = await client
    .update(tournament)
    .set({ status: "COMPLETED" })
    .where(
      and(
        eq(tournament.id, tournamentId),
        eq(tournament.status, "IN_PROGRESS"),
        eq(tournament.round, currentData.round),
        eq(tournament.roundStartedAt, currentData.roundStartedAt),
      ),
    );
  if (finalizeResult.rowsAffected === 0) {
    const refetched = await fetchTournamentForSync(client, tournamentId);
    if (!refetched || refetched.status !== "COMPLETED") {
      await client
        .delete(tournamentRecord)
        .where(
          and(eq(tournamentRecord.id, tournamentId), isNull(tournamentRecord.winnerId)),
        );
      return { success: true, message: "Tournament synchronized." };
    }
    return errorResponse(TOURNAMENT_FINALIZATION_INCOMPLETE);
  }

  const finalRewards = postProcessRewards(currentData.rewards);
  try {
    await rewardWinner({
      client,
      user: winner,
      rewards: finalRewards,
      reason: "TOURNAMENT",
    });
  } catch {
    return errorResponse(TOURNAMENT_FINALIZATION_INCOMPLETE);
  }

  const recordCompletionResult = await client
    .update(tournamentRecord)
    .set({ winnerId })
    .where(
      and(eq(tournamentRecord.id, tournamentId), isNull(tournamentRecord.winnerId)),
    );
  if (recordCompletionResult.rowsAffected === 0) {
    return errorResponse(TOURNAMENT_FINALIZATION_INCOMPLETE);
  }

  await cleanupCompletedTournament(client, tournamentId);

  const users = [
    ...new Set(currentData.matches.flatMap((match) => [match.userId1, match.userId2])),
  ];
  users.forEach((uid) => {
    if (uid) {
      void getServerPusher().trigger(uid, "event", {
        type: "userMessage",
        message: `The tournament has ended, ${winner.username} has won!`,
        route: "/profile",
        routeText: "To profile",
      });
    }
  });

  return { success: true, message: "Tournament synchronized." };
};

/**
 * Single-winner finalization ordering (do not reorder):
 * 1) Insert TournamentRecord with winnerId null (ledger starts).
 * 2) CAS tournament → COMPLETED (only one sync wins).
 * 3) updateRewards for the winner.
 * 4) CAS TournamentRecord winnerId from null → winner (exactly one payout path).
 * 5) Cleanup matches + tournament row; notify participants.
 * @param rewardWinner Reward writer injected by tests to keep module mocks isolated.
 */
export const syncTournamentState = async (
  client: DrizzleClient,
  tournamentId: string,
  rewardWinner: typeof updateRewards = updateRewards,
): Promise<BaseServerResponse> => {
  let data = await fetchTournamentForSync(client, tournamentId);
  if (!data) {
    return errorResponse("Tournament not found.");
  }

  const now = new Date();
  const [afterOpen, earlyAfterOpen] = await promoteOpenTournamentIfStarted(
    client,
    tournamentId,
    data,
    now,
  );
  if (earlyAfterOpen) return earlyAfterOpen;
  data = afterOpen;

  if (data.status !== "IN_PROGRESS" && data.status !== "COMPLETED") {
    return { success: true, message: "Tournament synchronized." };
  }

  const currentData = data;
  const matches = currentData.matches.filter(
    (match) => match.round === currentData.round,
  );
  const allWon = matches.every((match) => match.winnerId);
  const finalMatch = matches[0];
  const roundEndAt = secondsFromDate(
    TOURNAMENT_ROUND_SECONDS,
    currentData.roundStartedAt,
  );

  const roundPhase = await tryAdvanceTournamentRoundOrWait(
    client,
    tournamentId,
    currentData,
    matches,
    now,
    roundEndAt,
    allWon,
  );
  if (roundPhase) return roundPhase;

  const ledgerResult = await handleTournamentRecordLedger(
    client,
    tournamentId,
    currentData,
  );
  if (ledgerResult) return ledgerResult;

  if (!finalMatch) {
    return { success: true, message: "Tournament synchronized." };
  }

  return await finalizeTournamentAndPayWinner(
    client,
    tournamentId,
    currentData,
    finalMatch,
    rewardWinner,
  );
};
