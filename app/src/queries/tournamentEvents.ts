/**
 * Database access for tournament events; authorization and transaction scopes stay in callers.
 */
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { JUTSU_TRAIN_LEVEL_CAP } from "@/drizzle/constants";
import { tournament, userData, userJutsu } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";

/** Load an event and its combat tokens together for synchronization and versioned edits. */
export const fetchEvent = (client: DrizzleClient, id: string) =>
  client.query.tournament.findFirst({
    where: and(eq(tournament.id, id), eq(tournament.type, "EVENT")),
    with: { matches: true },
  });

/** Fetch the account and distinct mastered jutsu needed for event eligibility in parallel. */
export const fetchEventUser = async (client: DrizzleClient, id: string) => {
  const [user, mastered] = await Promise.all([
    client.query.userData.findFirst({
      where: eq(userData.userId, id),
      with: { queue: { columns: { id: true } } },
    }),
    client.query.userJutsu.findMany({
      where: and(eq(userJutsu.userId, id), gte(userJutsu.level, JUTSU_TRAIN_LEVEL_CAP)),
      columns: { jutsuId: true },
    }),
  ]);
  return user
    ? { ...user, masteredJutsu: new Set(mastered.map((j) => j.jutsuId)).size }
    : null;
};

/**
 * Share actionable invitations and match notices between global prompts and navigation.
 * Reuse the same rows for polling eligibility, including seats between actionable checks.
 * Restrict the capped query to this player, then discard withdrawn seats and closed checks.
 */
export const fetchEventNoticeState = async (client: DrizzleClient, userId: string) => {
  const now = Date.now();
  const events = await client.query.tournament.findMany({
    where: and(
      eq(tournament.type, "EVENT"),
      inArray(tournament.status, ["OPEN", "IN_PROGRESS"]),
      sql`JSON_CONTAINS(JSON_EXTRACT(${tournament.eventData}, '$.participants[*].userId'), JSON_QUOTE(${userId}))`,
    ),
    columns: { id: true, eventData: true },
    limit: 100,
  });
  const participations = events.flatMap((row) => {
    const event = row.eventData;
    const seat = event?.participants.find((p) => p.userId === userId && !p.withdrawn);
    return event && seat ? [{ id: row.id, event, seat }] : [];
  });
  const notices = participations.flatMap(({ id, event, seat }) => {
    const ready = event.series.find(
      (s) =>
        !s.complete &&
        s.seats.includes(seat.id) &&
        s.games.at(-1)?.status === "READY" &&
        (s.games.at(-1)?.opensAt ?? Infinity) <= now &&
        (s.games.at(-1)?.deadline ?? 0) > now &&
        !s.games.at(-1)?.accepted.includes(userId),
    );
    if (ready)
      return [
        {
          tournamentId: id,
          name: event.config.name,
          message: "Your tournament match is ready",
          deadline: ready.games.at(-1)!.deadline,
        },
      ];
    if (
      !seat.accepted &&
      event.status === "REGISTRATION" &&
      event.config.registrationClosesAt > now
    )
      return [
        {
          tournamentId: id,
          name: event.config.name,
          message: "You have a tournament invitation",
          deadline: event.config.registrationClosesAt,
        },
      ];
    return [];
  });
  return { notices, isEventParticipant: participations.length > 0 };
};

import { isNull, notExists } from "drizzle-orm";
import { IMG_MANUAL_TOURNAMENTS } from "@/drizzle/constants";
import {
  battle,
  rankedLoadout,
  tournamentMatch,
  tournamentRewardClaim,
} from "@/drizzle/schema";
import { ObjectiveReward } from "@/validators/rewards";

/** Build the `tournament` listing for `listEvents`, using predicates on `type`. */
export const listTournamentForListEvents = (client: Pick<DrizzleClient, "query">) =>
  client.query.tournament.findMany({
    where: eq(tournament.type, "EVENT"),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    limit: 100,
  });

/** Build the `tournament` insert for `saveEvent`. */
export const insertTournamentForSaveEvent = (
  client: Pick<DrizzleClient, "insert">,
  id: string,
  input: { config: { name: string; description: string } },
  eventData: import("@/validators/tournament").EventTournamentState,
) =>
  client.insert(tournament).values({
    id,
    type: "EVENT",
    name: `${input.config.name} (${id})`,
    description: input.config.description,
    image: IMG_MANUAL_TOURNAMENTS,
    rewards: ObjectiveReward.parse({}),
    eventData,
  });

/** Build the `tournament` update for `saveEventState`, using predicates on `id` and `version`. */
export const updateTournamentForSaveEventState = (
  client: Pick<DrizzleClient, "update">,
  event: import("@/validators/tournament").EventTournamentState,
  row: { id: string; version: number },
) =>
  client
    .update(tournament)
    .set({
      eventData: event,
      version: sql`${tournament.version} + 1`,
      status: ["COMPLETED", "CANCELLED"].includes(event.status)
        ? "COMPLETED"
        : event.series.length
          ? "IN_PROGRESS"
          : "OPEN",
    })
    .where(and(eq(tournament.id, row.id), eq(tournament.version, row.version)));

/** Build the `battle` lookup for `syncEventTournament`, selecting only `id`, using predicates on `id`. */
export const findBattleForSyncEventTournament = (
  client: Pick<DrizzleClient, "query">,
  game: { battleId: string },
) =>
  client.query.battle.findFirst({
    where: eq(battle.id, game.battleId),
    columns: { id: true },
  });

/** Build the `tournamentMatch` insert for `syncEventTournament`, updating duplicate keys. */
export const insertTournamentMatchForSyncEventTournament = (
  client: Pick<DrizzleClient, "insert">,
  game: { id: string; userIds: string[]; battleId: string },
  id: string,
  series: { round: number; games: import("@/validators/tournament").EventGame[] },
) =>
  client
    .insert(tournamentMatch)
    .values({
      id: game.id,
      tournamentId: id,
      round: series.round,
      match: series.games.length,
      userId1: game.userIds[0] ?? "",
      userId2: game.userIds[1] ?? "",
      battleId: game.battleId,
      startedAt: new Date(),
      state: "NO_SHOW",
    })
    .onDuplicateKeyUpdate({ set: { id: sql`${tournamentMatch.id}` } });

/** Build the `tournamentMatch` lookup for `syncEventTournament`, using predicates on `id`. */
export const findTournamentMatchForSyncEventTournament = (
  client: Pick<DrizzleClient, "query">,
  game: { id: string },
) =>
  client.query.tournamentMatch.findFirst({
    where: eq(tournamentMatch.id, game.id),
  });

/**
 * Build the `tournamentMatch` update for `syncEventTournament`, setting `state`, using
 * predicates on `id`, `state`, `winnerId`.
 */
export const updateTournamentMatchForSyncEventTournament = (
  client: Pick<DrizzleClient, "update" | "select">,
  game: { id: string; battleId: string },
) =>
  client
    .update(tournamentMatch)
    .set({ state: "NO_SHOW" })
    .where(
      and(
        eq(tournamentMatch.id, game.id),
        eq(tournamentMatch.state, "WAITING"),
        isNull(tournamentMatch.winnerId),
        notExists(
          client
            .select({ id: battle.id })
            .from(battle)
            .where(eq(battle.id, game.battleId)),
        ),
      ),
    );

/** Build the `tournamentMatch` insert for `launchEventGame`. */
export const insertTournamentMatchForLaunchEventGame = (
  client: Pick<DrizzleClient, "insert">,
  game: { id: string; userIds: string[]; battleId: string },
  id: string,
  series: { round: number; games: import("@/validators/tournament").EventGame[] },
) =>
  client.insert(tournamentMatch).values({
    id: game.id,
    tournamentId: id,
    round: series.round,
    match: series.games.length,
    userId1: game.userIds[0] ?? "",
    userId2: game.userIds[1] ?? "",
    battleId: game.battleId,
    startedAt: new Date(),
  });

/** Build the `userData` listing for `launchEventGame`, using predicates on `userId`. */
export const listUserDataForLaunchEventGame = (
  client: Pick<DrizzleClient, "query">,
  game: { userIds: string[] },
) =>
  client.query.userData.findMany({
    where: inArray(userData.userId, game.userIds),
    columns: {
      userId: true,
      status: true,
      battleId: true,
      sector: true,
      isBanned: true,
    },
  });

/** Build the `rankedLoadout` listing for `launchEventGame`, using predicates on `userId`. */
export const listRankedLoadoutForLaunchEventGame = (
  client: Pick<DrizzleClient, "query">,
  game: { userIds: string[] },
) =>
  client.query.rankedLoadout.findMany({
    where: inArray(rankedLoadout.userId, game.userIds),
  });

/** Build the `tournamentMatch` update for `recordLaunchFailure`, setting `state`, using predicates on `id` and `state`. */
export const updateTournamentMatchForRecordLaunchFailure = (
  client: Pick<DrizzleClient, "update">,
  gameId: string,
) =>
  client
    .update(tournamentMatch)
    .set({ state: "NO_SHOW" })
    .where(and(eq(tournamentMatch.id, gameId), eq(tournamentMatch.state, "WAITING")));

/** Build the `tournamentRewardClaim` listing for `payEventRewards`, using predicates on `tournamentId`. */
export const listTournamentRewardClaimForPayEventRewards = (
  client: Pick<DrizzleClient, "query">,
  row: { id: string },
) =>
  client.query.tournamentRewardClaim.findMany({
    where: eq(tournamentRewardClaim.tournamentId, row.id),
  });

/** Build the `tournament` update for `payEventRewards`, setting `version`, using predicates on `id`, `type`, `status`. */
export const updateTournamentForPayEventRewards = (
  client: Pick<DrizzleClient, "update">,
  row: { id: string },
) =>
  client
    .update(tournament)
    .set({ version: sql`${tournament.version} + 1` })
    .where(
      and(
        eq(tournament.id, row.id),
        eq(tournament.type, "EVENT"),
        eq(tournament.status, "COMPLETED"),
      ),
    );

/** Build the `tournamentRewardClaim` insert for `payEventRewards`. */
export const insertTournamentRewardClaimForPayEventRewards = (
  client: Pick<DrizzleClient, "insert">,
  row: { id: string },
  userId: string,
) =>
  client
    .insert(tournamentRewardClaim)
    .values({ id: `${row.id}:${userId}`, tournamentId: row.id, userId });

/** Build the `tournament` listing for `maintainEventTournaments`, using predicates on `type`. */
export const listTournamentForMaintainEventTournaments = (
  client: Pick<DrizzleClient, "query">,
) =>
  client.query.tournament.findMany({
    where: eq(tournament.type, "EVENT"),
  });

/** Build the `tournament` deletion for `maintainEventTournaments`, using predicates on `id` and `version`. */
export const deleteTournamentForMaintainEventTournaments = (
  client: Pick<DrizzleClient, "delete">,
  row: { id: string; version: number },
) =>
  client
    .delete(tournament)
    .where(and(eq(tournament.id, row.id), eq(tournament.version, row.version)));

/** Build the `tournamentRewardClaim` deletion for `maintainEventTournaments`, using predicates on `tournamentId`. */
export const deleteTournamentRewardClaimForMaintainEventTournaments = (
  client: Pick<DrizzleClient, "delete">,
  row: { id: string },
) =>
  client
    .delete(tournamentRewardClaim)
    .where(eq(tournamentRewardClaim.tournamentId, row.id));

/** Read only state affected by battle launches and flags that require progression reconciliation. */
export const findEventActorCacheState = (client: DrizzleClient, userId: string) =>
  client.query.userData.findFirst({
    where: eq(userData.userId, userId),
    columns: {
      role: true,
      status: true,
      battleId: true,
      updatedAt: true,
      curHealth: true,
      curChakra: true,
      curStamina: true,
      curEnergy: true,
      regenAt: true,
      currentlyTrainingMastery: true,
      currentlyTrainingElement: true,
    },
    with: { queue: { columns: { id: true } } },
  });

/** Detect a payout to the acting account while synchronization advances this event. */
export const findEventActorRewardReceipt = (
  client: DrizzleClient,
  tournamentId: string,
  userId: string,
) =>
  client.query.tournamentRewardClaim.findFirst({
    where: and(
      eq(tournamentRewardClaim.tournamentId, tournamentId),
      eq(tournamentRewardClaim.userId, userId),
    ),
    columns: { id: true },
  });
