/**
 * Database access for tournament; authorization and transaction scopes stay in callers.
 */
import { and, eq, ne, type SQL } from "drizzle-orm";
import type { TournamentMatch } from "@/drizzle/schema";
import { tournament, tournamentMatch, tournamentRecord } from "@/drizzle/schema";
import { actionReadinessSqlSet } from "@/queries/actionReadiness";
import { nextSnapshotSql } from "@/queries/concurrency";
import { withoutDungeonReservation } from "@/queries/dungeonReservation";
import type { DrizzleClient } from "@/server/db";
import type { ActionReadinessWrite } from "@/server/utils/actionReadiness";

const matchUsers = {
  user1: { columns: { userId: true, username: true, avatar: true } },
  user2: { columns: { userId: true, username: true, avatar: true } },
} as const;

/**
 * Fetches a tournament from the database.
 * @param {DrizzleClient} client - The Drizzle client used to query the database.
 * @param {string} tournamentId - The ID of the tournament to fetch.
 * @returns The tournament and matches, or undefined if missing or completed.
 */
export const fetchTournament = async (client: DrizzleClient, tournamentId: string) => {
  return findTournamentWithMatches(
    client,
    and(eq(tournament.id, tournamentId), ne(tournament.status, "COMPLETED")),
  );
};

/** Load a tournament and ordered match/player data, including completed tournaments needed by synchronization. */
export const fetchTournamentForSync = async (
  client: DrizzleClient,
  tournamentId: string,
) => {
  return findTournamentWithMatches(client, eq(tournament.id, tournamentId));
};

/** Build the tournament read with its matches in bracket order and their players. */
const findTournamentWithMatches = (client: DrizzleClient, where: SQL | undefined) =>
  client.query.tournament.findFirst({
    where,
    with: {
      matches: {
        with: matchUsers,
        orderBy: (table, { asc }) => [asc(table.match)],
      },
    },
  });

/** Load a tournament record by its record ID; a missing record yields undefined. */
export const fetchTournamentRecord = async (
  client: DrizzleClient,
  tournamentId: string,
) => {
  return client.query.tournamentRecord.findFirst({
    where: eq(tournamentRecord.id, tournamentId),
  });
};

/**
 * Fetches a tournament match from the database.
 *
 * @param {DrizzleClient} client - The Drizzle client used to query the database.
 * @param {string} matchId - The ID of the match to fetch.
 * @returns {Promise<TournamentMatch | undefined>} - A promise that resolves to the fetched match, or undefined if not found.
 */
export const fetchMatch = async (client: DrizzleClient, matchId: string) => {
  return client.query.tournamentMatch.findFirst({
    where: eq(tournamentMatch.id, matchId),
    with: matchUsers,
  });
};

import { gte, inArray, isNull, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { clan, userData } from "@/drizzle/schema";

/** Build the `clan` bank debit for `createTournament`, guarded by the bank covering the prize. */
export const updateClanForCreateTournament = (
  client: Pick<DrizzleClient, "update">,
  clanData: { id: string },
  prize: number,
) =>
  client
    .update(clan)
    .set({ bank: sql`${clan.bank} - ${prize}` })
    .where(and(eq(clan.id, clanData.id), gte(clan.bank, prize)));

/** Build the `tournament` insert for `createTournament`. */
export const insertTournamentForCreateTournament = (
  client: Pick<DrizzleClient, "insert">,
  input: import("@/validators/tournament").TournamentCreateSchema,
) => client.insert(tournament).values(input);

/** Build the `tournamentMatch` update for `joinTournament`, claiming `userId2` only while it is still empty. */
export const updateTournamentMatchForJoinTournament = (
  client: Pick<DrizzleClient, "update">,
  user: { userId: string },
  availableMatch: { id: string },
) =>
  client
    .update(tournamentMatch)
    .set({ userId2: user.userId })
    .where(
      and(eq(tournamentMatch.id, availableMatch.id), isNull(tournamentMatch.userId2)),
    );

/** Build the `tournamentMatch` insert for `joinTournament`. */
export const insertTournamentMatchForJoinTournament = (
  client: Pick<DrizzleClient, "insert">,
  input: { tournamentId: string },
  tournamentData: {
    round: number;
    matches: (import("@/drizzle/schema").TournamentMatch & {
      user1: Pick<
        import("@/drizzle/schema").UserData,
        "userId" | "username" | "avatar"
      >;
      user2: null | Pick<
        import("@/drizzle/schema").UserData,
        "userId" | "username" | "avatar"
      >;
    })[];
    startedAt: Date;
  },
  user: { userId: string },
) =>
  client.insert(tournamentMatch).values({
    id: nanoid(),
    tournamentId: input.tournamentId,
    round: tournamentData.round,
    userId1: user.userId,
    match: tournamentData.matches.length + 1,
    startedAt: tournamentData.startedAt,
  });

/** Reset scheduled participants while claiming any actor recovery atomically and preserving live dungeon reservations. */
export const updateUserDataForJoinMatch = (
  client: Pick<DrizzleClient, "update" | "execute">,
  matchData: { userId1: string; userId2: null | string },
  actorId?: string,
  readiness?: ActionReadinessWrite,
) =>
  readiness?.where && actorId
    ? client.execute(sql`
  UPDATE ${userData} LEFT JOIN ${userData} AS opponent
    ON opponent.userId = ${matchData.userId1 === actorId ? matchData.userId2 : matchData.userId1}
      AND ${withoutDungeonReservation(sql`opponent.userId`)}
  SET ${actionReadinessSqlSet(readiness, ["status", "curHealth"])}
    ${userData.status} = 'AWAKE',
    ${userData.curHealth} = ${readiness.set.curHealth ?? sql`GREATEST(1, ${userData.curHealth})`},
    ${userData.updatedAt} = ${nextSnapshotSql(userData.updatedAt)},
    opponent.status = 'AWAKE',
    opponent.curHealth = CASE WHEN opponent.curHealth < 0 THEN 1 ELSE opponent.curHealth END,
    opponent.updatedAt = NOW(3)
  WHERE ${userData.userId} = ${actorId} AND ${readiness.where}
    AND ${withoutDungeonReservation()}
`)
    : client
        .update(userData)
        .set({
          status: "AWAKE",
          curHealth: sql`CASE WHEN ${userData.curHealth} < 0 THEN 1 ELSE ${userData.curHealth} END`,
        })
        .where(
          and(
            inArray(userData.userId, [
              matchData.userId1 ?? "",
              matchData.userId2 ?? "",
            ]),
            withoutDungeonReservation(),
          ),
        );

/** Build deletion of all matches in a tournament. */
export const deleteTournamentMatches = (
  client: Pick<DrizzleClient, "delete">,
  tournamentId: string,
) =>
  client.delete(tournamentMatch).where(eq(tournamentMatch.tournamentId, tournamentId));

/** Build the `tournament` deletion for `cleanupCompletedTournament`, using predicates on `id` and `status`. */
export const deleteTournamentForCleanupCompletedTournament = (
  client: Pick<DrizzleClient, "delete">,
  tournamentId: string,
) =>
  client
    .delete(tournament)
    .where(and(eq(tournament.id, tournamentId), eq(tournament.status, "COMPLETED")));

/**
 * Build the `tournamentMatch` update for `setMatchWinner`, setting `winnerId` and
 * `state`, using predicates on `id`, `userId1`, `userId2`.
 */
export const updateTournamentMatchForSetMatchWinner = (
  client: Pick<DrizzleClient, "update">,
  winnerId: string,
  state: "WAITING" | "PLAYED" | "NO_SHOW",
  matchId: string,
) =>
  client
    .update(tournamentMatch)
    .set({ winnerId, state })
    .where(
      and(
        eq(tournamentMatch.id, matchId),
        or(
          eq(tournamentMatch.userId1, winnerId),
          eq(tournamentMatch.userId2, winnerId),
        ),
        // A genuine bye needs no battle; a rejected two-player admission is not a forfeit.
        state === "NO_SHOW"
          ? or(
              isNull(tournamentMatch.userId2),
              and(
                withoutDungeonReservation(tournamentMatch.userId1),
                withoutDungeonReservation(tournamentMatch.userId2),
              ),
            )
          : undefined,
      ),
    );

/**
 * Build the `tournament` update for `promoteOpenTournamentIfStarted`, setting
 * `status`, using predicates on `id` and `status`.
 */
export const updateTournamentForPromoteOpenTournamentIfStarted = (
  client: Pick<DrizzleClient, "update">,
  tournamentId: string,
) =>
  client
    .update(tournament)
    .set({ status: "IN_PROGRESS" })
    .where(and(eq(tournament.id, tournamentId), eq(tournament.status, "OPEN")));

/**
 * Build the `tournament` update for `tryAdvanceTournamentRoundOrWait`, setting `round`
 * and `roundStartedAt`, including predicates on `id`, `status`, `round`.
 */
export const updateTournamentForTryAdvanceTournamentRoundOrWait = (
  client: Pick<DrizzleClient, "update">,
  currentData: { round: number; roundStartedAt: Date },
  nextRoundStartedAt: Date,
  tournamentId: string,
) =>
  client
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

/** Build the `tournamentMatch` insert for `tryAdvanceTournamentRoundOrWait`. */
export const insertTournamentMatchForTryAdvanceTournamentRoundOrWait = (
  client: Pick<DrizzleClient, "insert">,
  nextRoundMatches: import("@/drizzle/schema").TournamentMatch[],
) => client.insert(tournamentMatch).values(nextRoundMatches);

/** Build the `tournamentRecord` insert for `finalizeTournamentAndPayWinner`. */
export const insertTournamentRecordForFinalizeTournamentAndPayWinner = (
  client: Pick<DrizzleClient, "insert">,
  tournamentId: string,
  currentData: {
    name: string;
    image: string;
    description: string;
    round: number;
    type: "EVENT" | "CLAN";
    rewards: import("@/validators/rewards").ObjectiveRewardType;
    startedAt: Date;
  },
) =>
  client.insert(tournamentRecord).values({
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

/**
 * Build the `tournament` update for `finalizeTournamentAndPayWinner`, setting
 * `status`, including predicates on `id`, `status`, `round`.
 */
export const updateTournamentForFinalizeTournamentAndPayWinner = (
  client: Pick<DrizzleClient, "update">,
  tournamentId: string,
  currentData: { round: number; roundStartedAt: Date },
) =>
  client
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

/** Build the `tournamentRecord` deletion for `finalizeTournamentAndPayWinner`, using predicates on `id` and `winnerId`. */
export const deleteTournamentRecordForFinalizeTournamentAndPayWinner = (
  client: Pick<DrizzleClient, "delete">,
  tournamentId: string,
) =>
  client
    .delete(tournamentRecord)
    .where(
      and(eq(tournamentRecord.id, tournamentId), isNull(tournamentRecord.winnerId)),
    );

/**
 * Build the `tournamentRecord` update for `finalizeTournamentAndPayWinner`, setting
 * `winnerId`, using predicates on `id` and `winnerId`.
 */
export const updateTournamentRecordForFinalizeTournamentAndPayWinner = (
  client: Pick<DrizzleClient, "update">,
  winnerId: string,
  tournamentId: string,
) =>
  client
    .update(tournamentRecord)
    .set({ winnerId })
    .where(
      and(eq(tournamentRecord.id, tournamentId), isNull(tournamentRecord.winnerId)),
    );
