import { nanoid } from "nanoid";
import { z } from "zod";
import type { TournamentMatchState } from "@/drizzle/constants";
import { TOURNAMENT_ROUND_SECONDS } from "@/drizzle/constants";
import type { TournamentMatch } from "@/drizzle/schema";
import { getServerPusher } from "@/libs/pusher";
import { postProcessRewards } from "@/libs/quest";
import { fetchActionUser } from "@/queries/actionReadiness";
import { fetchClan } from "@/queries/clan";
import { fetchAllGameSettings, fetchUser, findUserById } from "@/queries/profile";
import {
  deleteTournamentForCleanupCompletedTournament,
  deleteTournamentMatches,
  deleteTournamentRecordForFinalizeTournamentAndPayWinner,
  fetchMatch,
  fetchTournament,
  fetchTournamentForSync,
  fetchTournamentRecord,
  insertTournamentForCreateTournament,
  insertTournamentMatchForJoinTournament,
  insertTournamentMatchForTryAdvanceTournamentRoundOrWait,
  insertTournamentRecordForFinalizeTournamentAndPayWinner,
  updateClanForCreateTournament,
  updateTournamentForFinalizeTournamentAndPayWinner,
  updateTournamentForPromoteOpenTournamentIfStarted,
  updateTournamentForTryAdvanceTournamentRoundOrWait,
  updateTournamentMatchForJoinTournament,
  updateTournamentMatchForSetMatchWinner,
  updateTournamentRecordForFinalizeTournamentAndPayWinner,
  updateUserDataForJoinMatch,
} from "@/queries/tournament";
import { initiateBattle } from "@/routers/combat";
import type { BaseServerResponse } from "@/server/api/trpc";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import {
  actionReadinessResponse,
  prepareActionReadiness,
} from "@/server/utils/actionReadiness";
import { isMysqlDuplicateKeyError } from "@/server/utils/mysqlErrors";
import { updateRewards } from "@/server/utils/questRewards";
import { secondsFromDate } from "@/utils/time";
import { checkCoLeader } from "@/validators/clan";
import { ObjectiveReward } from "@/validators/rewards";
import { tournamentCreateSchema } from "@/validators/tournament";
import { userDeltaResponseSchema } from "@/validators/userCache";
import { eventTournamentProcedures, syncEventTournament } from "./tournamentEvents";

const TOURNAMENT_FINALIZATION_INCOMPLETE =
  "Tournament finalization incomplete. Staff recovery required.";
const TOURNAMENT_SYNCHRONIZED: BaseServerResponse = {
  success: true,
  message: "Tournament synchronized.",
};

export const tournamentRouter = createTRPCRouter({
  ...eventTournamentProcedures,
  // Advances rounds and pays finals via syncTournamentState before every read; keep it off edge caches.
  getTournament: protectedProcedure
    .meta({
      mcp: {
        description:
          "Get tournament details and matches (includes automatic round sync / finalization)",
      },
    })
    .input(z.object({ tournamentId: z.string() }))
    .query(async ({ ctx, input }) => {
      await syncTournamentState(ctx.drizzle, input.tournamentId);
      const data = await fetchTournament(ctx.drizzle, input.tournamentId);
      return data?.type === "CLAN" ? data : null;
    }),
  createTournament: protectedProcedure
    .meta({ mcp: { description: "Create a new tournament" } })
    .input(tournamentCreateSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, clanData, tournamentData] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchClan(ctx.drizzle, input.id),
        fetchTournament(ctx.drizzle, input.id),
      ]);
      // Guards
      if (tournamentData) return errorResponse("Tournament already exists found.");
      if (!clanData) return errorResponse("Clan not found.");
      const isLeader = user.userId === clanData.leaderId;
      const isColeader = checkCoLeader(user.userId, clanData);
      if (!isLeader && !isColeader) return errorResponse("Must be leader");
      // Update
      const prize = clanData.bank;
      input.rewards = ObjectiveReward.parse({ reward_money: prize });
      // Take only the prize read above; deposits made since stay in the bank
      if (prize > 0) {
        const debit = await updateClanForCreateTournament(ctx.drizzle, clanData, prize);
        if (debit.rowsAffected === 0) {
          return errorResponse("Clan treasury changed, try again");
        }
      }
      // Insert tournament
      await insertTournamentForCreateTournament(ctx.drizzle, input);
      // Return
      return { success: true, message: "Tournament created." };
    }),
  joinTournament: protectedProcedure
    .meta({ mcp: { description: "Join an existing tournament" } })
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
      // Guards
      if (!tournamentData) return errorResponse("Tournament not found.");
      if (tournamentData.type === "EVENT")
        return errorResponse("Use the event tournament page");
      if (matches.find((m) => [m.userId1, m.userId2].includes(user.userId))) {
        return errorResponse("User already in tournament.");
      }
      if (!clanData) return errorResponse("Clan not found.");
      if (user.clanId !== clanData.id) return errorResponse("User not in clan.");
      // Mutate
      const availableMatch = matches.find((m) => !m.userId2);
      if (availableMatch) {
        const joined = await updateTournamentMatchForJoinTournament(
          ctx.drizzle,
          user,
          availableMatch,
        );
        if (joined.rowsAffected === 0) {
          return errorResponse("That slot was just taken. Try again");
        }
      } else {
        await insertTournamentMatchForJoinTournament(
          ctx.drizzle,
          input,
          tournamentData,
          user,
        );
      }
      // Return
      return { success: true, message: "Joined Tournament" };
    }),
  joinMatch: protectedProcedure
    .meta({ mcp: { description: "Join a tournament match" } })
    .input(
      z.object({
        matchId: z.string(),
        tournamentId: z.string(),
        originSocketId: z.string().max(128).optional(),
      }),
    )
    .output(userDeltaResponseSchema.extend({ battleId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      // Fetch
      let [user, matchData, tournamentData, settings] = await Promise.all([
        fetchActionUser(ctx.drizzle, ctx.userId),
        fetchMatch(ctx.drizzle, input.matchId),
        fetchTournament(ctx.drizzle, input.tournamentId),
        fetchAllGameSettings(ctx.drizzle),
      ]);
      // Receiving a bye starts no activity and preserves a live dungeon reservation.
      const readiness =
        !matchData?.userId2 && user.status === "QUEUED"
          ? undefined
          : prepareActionReadiness(user, settings);
      if (readiness?.error) return errorResponse(readiness.error);
      user = readiness?.user ?? user;
      // General guards
      if (!matchData) return errorResponse("Match not found.");
      if (!tournamentData) return errorResponse("Tournament not found.");
      if (tournamentData.type === "EVENT")
        return errorResponse("Use the event tournament page");
      if (tournamentData.round !== matchData.round) {
        return errorResponse("Match not in current round.");
      }
      if (matchData.tournamentId !== input.tournamentId) {
        return errorResponse("Match not in tournament.");
      }
      if (![matchData.userId1, matchData.userId2].includes(user.userId)) {
        return errorResponse("Not in this match.");
      }
      // Ensure all users are awake
      const admitted = await updateUserDataForJoinMatch(
        ctx.drizzle,
        matchData,
        ctx.userId,
        readiness,
      );
      if (readiness?.notice && !admitted.rowsAffected)
        return errorResponse("Your status changed. Please try joining again.");
      // Start the battle
      let result: Awaited<ReturnType<typeof initiateBattle>> | undefined;
      if (matchData.userId2) {
        result = await initiateBattle(
          {
            userIds: [matchData.userId2],
            targetIds: [matchData.userId1],
            client: ctx.drizzle,
            actionUserId: ctx.userId,
            originSocketId: input.originSocketId,
            biome: "arena",
          },
          "TOURNAMENT",
        );
      }
      // Two-player no-shows preserve live dungeon reservations.
      if (!result?.success) {
        const awarded = await setMatchWinner(
          ctx.drizzle,
          input.matchId,
          user.userId,
          "NO_SHOW",
        );
        if (!awarded)
          return actionReadinessResponse(
            errorResponse(
              result?.message ?? "Match participants are unavailable. Try again.",
            ),
            readiness,
            ctx.drizzle,
          );
      }
      // Return
      return actionReadinessResponse(
        {
          ...result,
          success: true,
          message: "Joined Match",
          battleId: result?.battleId,
        },
        readiness,
        ctx.drizzle,
        result?.success && result.battleId
          ? { status: "BATTLE", battleId: result.battleId }
          : undefined,
      );
    }),
});

const cleanupCompletedTournament = async (
  client: DrizzleClient,
  tournamentId: string,
) => {
  await Promise.all([
    deleteTournamentMatches(client, tournamentId),
    deleteTournamentForCleanupCompletedTournament(client, tournamentId),
  ]);
};

/**
 * Sets the winner of a match in a tournament.
 *
 * @param {DrizzleClient} client - The Drizzle client used to update the tournament match.
 * @param {string} matchId - The ID of the match.
 * @param {string} winnerId - The ID of the winner.
 * @returns {Promise<boolean>} - A promise that resolves to true if the winner is successfully set.
 * Refused no-show awards return false; other missing result writes throw.
 */
export const setMatchWinner = async (
  client: DrizzleClient,
  matchId: string,
  winnerId: string,
  state: TournamentMatchState = "PLAYED",
) => {
  const result = await updateTournamentMatchForSetMatchWinner(
    client,
    winnerId,
    state,
    matchId,
  );
  if (result.rowsAffected === 0) {
    if (state === "NO_SHOW") return false;
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
  const startResult = await updateTournamentForPromoteOpenTournamentIfStarted(
    client,
    tournamentId,
  );

  if (startResult.rowsAffected > 0) {
    const refetched = await fetchTournamentForSync(client, tournamentId);
    if (!refetched) {
      return [data, TOURNAMENT_SYNCHRONIZED];
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
    return TOURNAMENT_SYNCHRONIZED;
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

    const roundAdvanceResult = await updateTournamentForTryAdvanceTournamentRoundOrWait(
      client,
      currentData,
      nextRoundStartedAt,
      tournamentId,
    );

    if (roundAdvanceResult.rowsAffected > 0 && nextRoundMatches.length > 0) {
      await insertTournamentMatchForTryAdvanceTournamentRoundOrWait(
        client,
        nextRoundMatches,
      );
    }

    return TOURNAMENT_SYNCHRONIZED;
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
    return TOURNAMENT_SYNCHRONIZED;
  }
  return errorResponse(TOURNAMENT_FINALIZATION_INCOMPLETE);
};

const TOURNAMENT_RECORD_NAME_KEY = "HistoricalTournament_name_key";

/** True when an insert hit the unique TournamentRecord name index (not the id primary key). */
const isTournamentRecordNameConflict = (error: unknown): boolean => {
  if (!isMysqlDuplicateKeyError(error)) return false;
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    const sqlMessage = (current as { sqlMessage?: unknown }).sqlMessage;
    if (
      current.message.includes(TOURNAMENT_RECORD_NAME_KEY) ||
      (typeof sqlMessage === "string" &&
        sqlMessage.includes(TOURNAMENT_RECORD_NAME_KEY))
    ) {
      return true;
    }
    current = current.cause;
  }
  return false;
};

/**
 * Archived name for a tournament whose name is already used by an older record. It is
 * derived from the tournament id, so concurrent finalizers of the same tournament collide
 * on the primary key instead of writing two records.
 */
export const archivedTournamentRecordName = (name: string, tournamentId: string) => {
  const suffix = ` (${tournamentId.slice(0, 8)})`;
  return `${name.slice(0, 191 - suffix.length)}${suffix}`;
};

/**
 * Insert the pending TournamentRecord ledger row. Tournament names are only unique among
 * live tournaments, so a reused name (e.g. "Test") can clash with an older record; in that
 * case the record is stored under an archived name instead of blocking finalization.
 */
const insertTournamentLedgerRecord = async (
  client: DrizzleClient,
  tournamentId: string,
  currentData: TournamentSyncData,
) => {
  try {
    await insertTournamentRecordForFinalizeTournamentAndPayWinner(
      client,
      tournamentId,
      currentData,
    );
  } catch (error) {
    if (!isTournamentRecordNameConflict(error)) throw error;
    await insertTournamentRecordForFinalizeTournamentAndPayWinner(
      client,
      tournamentId,
      {
        ...currentData,
        name: archivedTournamentRecordName(currentData.name, tournamentId),
      },
    );
  }
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
    return TOURNAMENT_SYNCHRONIZED;
  }

  if (currentData.status !== "IN_PROGRESS") {
    return errorResponse(TOURNAMENT_FINALIZATION_INCOMPLETE);
  }

  // A deleted winner leaves the tournament IN_PROGRESS for staff recovery
  const winner = await findUserById(client, winnerId);
  if (!winner) {
    return errorResponse("Tournament winner not found.");
  }

  try {
    await insertTournamentLedgerRecord(client, tournamentId, currentData);
  } catch (error) {
    const recordAfterInsertError = await fetchTournamentRecord(client, tournamentId);
    if (recordAfterInsertError?.winnerId) {
      const latestTournament = await fetchTournamentForSync(client, tournamentId);
      if (latestTournament?.status === "COMPLETED") {
        await cleanupCompletedTournament(client, tournamentId);
      }
      return TOURNAMENT_SYNCHRONIZED;
    }
    if (recordAfterInsertError) {
      return errorResponse(TOURNAMENT_FINALIZATION_INCOMPLETE);
    }
    throw error;
  }

  const finalizeResult = await updateTournamentForFinalizeTournamentAndPayWinner(
    client,
    tournamentId,
    currentData,
  );
  if (finalizeResult.rowsAffected === 0) {
    const refetched = await fetchTournamentForSync(client, tournamentId);
    if (!refetched || refetched.status !== "COMPLETED") {
      await deleteTournamentRecordForFinalizeTournamentAndPayWinner(
        client,
        tournamentId,
      );
      return TOURNAMENT_SYNCHRONIZED;
    }
    return errorResponse(TOURNAMENT_FINALIZATION_INCOMPLETE);
  }

  const finalRewards = postProcessRewards(currentData.rewards, winner);
  try {
    await rewardWinner({
      client,
      user: winner,
      rewards: finalRewards,
      reason: "TOURNAMENT",
      // Clan prizes transfer the existing treasury rather than generating new ryo.
      pvpBoostApplied: currentData.type === "CLAN",
    });
  } catch {
    return errorResponse(TOURNAMENT_FINALIZATION_INCOMPLETE);
  }

  const recordCompletionResult =
    await updateTournamentRecordForFinalizeTournamentAndPayWinner(
      client,
      winnerId,
      tournamentId,
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

  return TOURNAMENT_SYNCHRONIZED;
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
  if (data.type === "EVENT") {
    await syncEventTournament(client, tournamentId);
    return TOURNAMENT_SYNCHRONIZED;
  }

  const [afterOpen, earlyAfterOpen] = await promoteOpenTournamentIfStarted(
    client,
    tournamentId,
    data,
    now,
  );
  if (earlyAfterOpen) return earlyAfterOpen;
  data = afterOpen;

  if (data.status !== "IN_PROGRESS" && data.status !== "COMPLETED") {
    return TOURNAMENT_SYNCHRONIZED;
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
    return TOURNAMENT_SYNCHRONIZED;
  }

  return await finalizeTournamentAndPayWinner(
    client,
    tournamentId,
    currentData,
    finalMatch,
    rewardWinner,
  );
};
