import { nanoid } from "nanoid";
import { after } from "next/server";
import { getKessenMatchLog } from "@/deltas/kessenPvp";
import {
  KESSEN_PVP_MAX_TIMEOUTS,
  KESSEN_PVP_MULLIGAN_SECONDS,
  KESSEN_PVP_TURN_SECONDS,
  KESSEN_RANKED_DAILY_REWARDED_WINS,
  KESSEN_RANKED_PAIR_DAILY_RATED,
  KESSEN_RANKED_RATING_FLOOR,
  KESSEN_RANKED_START_RATING,
  KESSEN_RANKED_WEEKLY_PACK_WINS,
  KESSEN_RANKED_WIN_RYO,
  type KessenMatchKind,
} from "@/drizzle/constants";
import type { KessenMatch, KessenProgress } from "@/drizzle/schema";
import { other } from "@/libs/kessen/board";
import { kessenCatalogCards, snapshotCatalog } from "@/libs/kessen/catalog";
import { expandDeckCards } from "@/libs/kessen/deck";
import {
  actingSeats,
  applyAction,
  createMatch,
  matchInputProblem,
  redactEvents,
  viewFor,
} from "@/libs/kessen/engine";
import { KESSEN_PACK_IDS } from "@/libs/kessen/packs";
import {
  kessenDuelEligibility,
  kessenForfeitWinner,
  kessenLogNames,
  kessenNextDeadline,
  kessenRatingDelta,
  resolveKessenClock,
} from "@/libs/kessen/pvp";
import { countPlays } from "@/libs/kessen/rewards";
import { CARD_ENGINE_VERSION } from "@/libs/kessen/rules";
import type { KessenAction, KessenEvent, MatchState, Seat } from "@/libs/kessen/types";
import { getServerPusher } from "@/libs/pusher";
import {
  insertKessenMatch,
  insertKessenProgressRowsIfMissing,
  type listKessenCards,
  updateKessenMatchForTurn,
  updateUserDataForKessenPayout,
} from "@/queries/kessen";
import {
  findKessenPvpMatchById,
  listActiveKessenMatchesForPlayers,
  listKessenProgressRows,
  listKessenRatedPairs,
  type RatingSeat,
  updateKessenMatchForRatingClaim,
  updateKessenProgressForRankedReward,
  updateKessenPvpMatchesForVoid,
  updateKessenPvpMatchResult,
} from "@/queries/kessenPvp";
import { fetchUser } from "@/queries/profile";
import { fetchQuestTrackerState } from "@/queries/quests";
import type { DrizzleClient } from "@/server/db";
import { grantUserItems, type ItemGrant } from "@/server/utils/itemGrants";
import {
  kessenObjectiveTrackers,
  kessenTrackerUser,
} from "@/server/utils/kessenPayout";
import { notifyKessenDuelStarted } from "@/server/utils/push/kessen";
import { getUtcDayKey, periodStart } from "@/utils/time";
import type {
  KessenMatchLog,
  KessenPvpEnd,
  KessenPvpMatchPayload,
  KessenPvpPlayer,
  KessenPvpResult,
  KessenPvpSettlement,
  KessenPvpViewResult,
  KessenRatingChange,
  KessenStoredPvpMatch,
} from "@/validators/kessen";

/**
 * Live Kessen duels between two players. Seat 0 is `KessenMatch.userId`, seat 1
 * `opponentId`. Every change to a duel (a decision, a clock that ran out, a concession)
 * is one version CAS on the row, after which the new version is pushed on the duel's
 * channel; each seat refetches its own redacted view. A ranked duel's rating and reward
 * are settled once, after the ending write, through guarded claims.
 */

/** The refusal of a decision made against an outdated version of the duel. */
export const STALE_DUEL_MESSAGE = "This match moved on; showing the latest turn.";
const RULES_CHANGED_MESSAGE =
  "The Kessen rules changed since this match began, so it ended without a result.";
const MAX_LOG_EVENTS = 4000;
/** Claim rounds one settlement runs before leaving the duel to a later resume. */
const SETTLEMENT_ATTEMPTS = 3;

/** The stored duel of a row. */
export const storedDuelOf = (row: Pick<KessenMatch, "state">) =>
  row.state as unknown as KessenStoredPvpMatch;

/** The seat `userId` sits in. */
export const kessenDuelSeat = (
  row: Pick<KessenMatch, "userId">,
  userId: string,
): Seat => (row.userId === userId ? 0 : 1);

/**
 * Announces a duel's new version on its channel once the response is sent; the channel is
 * public, so nothing else. The write has committed by then, so a failed announcement
 * never fails the decision: the other seat reads the version on its next refetch.
 */
const pushKessenDuelVersion = (matchId: string, version: number) =>
  after(() => getServerPusher().trigger(matchId, "event", { version }));

/**
 * Brings a duel up to `now` and applies one seat's decision: forces every decision whose
 * clock ran out, then the decision when it is still legal, and writes everything with one
 * version CAS on the row as read. An ending write is followed by the settlement, and the
 * final version is pushed. A decision against an ended duel, a stale version or an
 * illegal action is refused, while the clock's forced decisions are still written.
 */
export const advanceKessenDuel = async (
  client: DrizzleClient,
  row: KessenMatch,
  input: { now: Date; decision?: KessenDuelDecision },
): Promise<KessenDuelAdvance> => {
  const { now, decision } = input;
  if (row.status !== "ACTIVE") {
    const settled = await resumeKessenDuelSettlement(client, row);
    return {
      row: settled.row,
      events: [],
      refused: decision ? "This match is over." : null,
      lost: false,
      paid: settled.paid,
    };
  }
  const stored = storedDuelOf(row);
  if (row.engineVersion !== CARD_ENGINE_VERSION) {
    const state: KessenStoredPvpMatch = { ...stored, result: voidResult() };
    const write = await updateKessenMatchForTurn(client, row, {
      state,
      now,
      deadline: null,
      status: "EXPIRED",
    });
    if (write.rowsAffected !== 1) return lostAdvance(client, row, decision);
    const expired = nextRow(row, state, now, null, "EXPIRED");
    pushKessenDuelVersion(row.id, expired.version);
    return {
      row: expired,
      events: [],
      refused: decision ? RULES_CHANGED_MESSAGE : null,
      lost: false,
      paid: null,
    };
  }

  const clock = resolveKessenClock({
    engine: stored.engine,
    timeouts: stored.timeouts,
    deadline: row.turnDeadline,
    now,
  });
  let engine = clock.engine;
  let deadline = clock.deadline;
  const events = [...clock.events];
  let ending: DuelEnding | null =
    clock.forfeited.length > 0
      ? {
          winner: kessenForfeitWinner(clock.forfeited),
          endedBy: "timeout",
          loserBy: clock.forfeited.length === 1 ? (clock.forfeited[0] as Seat) : null,
        }
      : engineEnding(engine);
  let refused: string | null = null;

  if (decision && ending) refused = "This match is over.";
  else if (decision && "concede" in decision) {
    ending = {
      winner: other(decision.seat),
      endedBy: "concede",
      loserBy: decision.seat,
    };
  } else if (decision) {
    const pending = actingSeats(engine).includes(decision.seat);
    // A mulligan does not depend on the other seat's, so it may answer an older version.
    const independent = decision.action.t === "mull" && engine.phase === "mulligan";
    const current = decision.version === row.version && clock.timedOut.length === 0;
    if (!pending) {
      refused = clock.timedOut.includes(decision.seat)
        ? "Your time ran out."
        : "It is not your turn.";
    } else if (!current && !independent) {
      refused = STALE_DUEL_MESSAGE;
    } else {
      const applied = applyAction(engine, decision.seat, decision.action);
      if (!applied.ok) refused = applied.reason;
      else {
        deadline = kessenNextDeadline(engine, applied.state, deadline, now);
        engine = applied.state;
        events.push(...applied.events);
        ending = engineEnding(engine);
      }
    }
  }
  if (events.length === 0 && !ending)
    return { row, events: [], refused, lost: false, paid: null };

  const added = countPlays(events);
  const next: KessenStoredPvpMatch = {
    ...stored,
    engine,
    plays: [stored.plays[0] + added[0], stored.plays[1] + added[1]],
    log: [...stored.log, ...events].slice(-MAX_LOG_EVENTS),
    timeouts: clock.timeouts,
  };
  if (!ending) {
    const write = await updateKessenMatchForTurn(client, row, {
      state: next,
      now,
      deadline,
    });
    if (write.rowsAffected !== 1) return lostAdvance(client, row, decision);
    const written = nextRow(row, next, now, deadline, null);
    pushKessenDuelVersion(row.id, written.version);
    return { row: written, events, refused, lost: false, paid: null };
  }

  // The duel ended: plan the ranked claims from one snapshot, then claim the ending.
  const plan = await planDuelEnd(client, row, next, ending, now);
  const status = ending.endedBy === "concede" ? "CONCEDED" : "FINISHED";
  const ended: KessenStoredPvpMatch = {
    ...next,
    result: plan.settlement ? unsettledResult(plan.settlement.result) : plan.result,
    settlement: plan.settlement,
  };
  const write = await updateKessenMatchForTurn(client, row, {
    state: ended,
    now,
    deadline: null,
    status,
  });
  if (write.rowsAffected !== 1) return lostAdvance(client, row, decision);
  let current = nextRow(row, ended, now, null, status);
  let paid: KessenDuelAdvance["paid"] = null;
  if (plan.settlement) {
    const settled = await settleKessenDuel(client, current);
    current = settled.row;
    paid = settled.paid;
  }
  pushKessenDuelVersion(row.id, current.version);
  return { row: current, events, refused, lost: false, paid };
};

/**
 * Finishes the settlement of an ended duel that still carries one (its ending request
 * stopped before writing the settled result) and returns the row as it now stands.
 */
export const resumeKessenDuelSettlement = async (
  client: DrizzleClient,
  row: KessenMatch,
): Promise<{ row: KessenMatch; paid: KessenDuelAdvance["paid"] }> => {
  const stored = storedDuelOf(row);
  if ((row.status !== "FINISHED" && row.status !== "CONCEDED") || !stored.settlement)
    return { row, paid: null };
  const settled = await settleKessenDuel(client, row);
  if (settled.row !== row) pushKessenDuelVersion(row.id, settled.row.version);
  return settled;
};

/**
 * Runs the ranked claims of an ended duel and writes its settled result. The rating
 * claim moves both ratings once per match (`KessenMatch.rated`); the reward claim counts
 * the win against the winner's daily cap and names the match, so a rerun recognises
 * claims an earlier run won. Each claim holds only while the progress it was planned
 * from still stands; when another rated match or rewarded win came first (a settlement
 * resumed late), the claim is planned again from current progress, so ratings move from
 * the current ratings and the weekly pack follows the count the claim writes. The
 * settled result is written with a version CAS before anything is paid, so only one run
 * pays. Returns the row unchanged when another run wrote the settled result first, or
 * when the claims kept losing to concurrent changes (the sweep resumes it later).
 */
export const settleKessenDuel = async (
  client: DrizzleClient,
  row: KessenMatch,
): Promise<{ row: KessenMatch; paid: KessenDuelAdvance["paid"] }> => {
  const stored = storedDuelOf(row);
  const plan = stored.settlement;
  if (!plan) return { row, paid: null };
  const seatUserIds: [string, string] = [row.userId, row.opponentId ?? ""];
  const winner = plan.result.winner;
  const objectiveUser = plan.objectiveUserId;
  let ratings = plan.ratings;
  let played = plan.played;
  let reward = plan.reward;
  // Null while the claim is still open; then whether it was won, by any run.
  let rated: boolean | null = ratings ? null : false;
  let rewarded: boolean | null = reward ? null : false;
  let quest: Parameters<typeof kessenTrackerUser> = [null, null];
  const ratingSeat = (seat: Seat, change: KessenRatingChange): RatingSeat => ({
    userId: seatUserIds[seat],
    before: change.before,
    played: played[seat],
    delta: change.delta,
    score: scoreOf(winner, seat),
  });
  for (let attempt = 0; attempt < SETTLEMENT_ATTEMPTS; attempt++) {
    const first = attempt === 0;
    const [ratingWrite, rewardWrite, questUser, questState] = await Promise.all([
      rated === null && ratings
        ? updateKessenMatchForRatingClaim(client, {
            matchId: row.id,
            floor: KESSEN_RANKED_RATING_FLOOR,
            seats: [ratingSeat(0, ratings[0]), ratingSeat(1, ratings[1])],
          })
        : null,
      rewarded === null && reward
        ? updateKessenProgressForRankedReward(client, {
            matchId: row.id,
            userId: reward.userId,
            dayKey: plan.dayKey,
            weekKey: plan.weekKey,
            pack: reward.packItemId !== null,
          })
        : null,
      first && objectiveUser ? fetchUser(client, objectiveUser) : null,
      first && objectiveUser ? fetchQuestTrackerState(client, objectiveUser) : null,
    ]);
    if (first) quest = [questUser, questState];
    if (ratingWrite && ratingWrite.rowsAffected > 0) rated = true;
    if (rewardWrite?.rowsAffected === 1) rewarded = true;
    if (rated !== null && rewarded !== null) break;
    // A claim missed: an earlier run won it, it can no longer be won, or the progress
    // it was planned from moved on and it is planned again.
    const [fresh, progressRows] = await Promise.all([
      rated === null ? findKessenPvpMatchById(client, row.id) : [],
      listKessenProgressRows(client, seatUserIds),
    ]);
    const progressOf = (seat: Seat) =>
      progressRows.find((entry) => entry.userId === seatUserIds[seat]) ?? null;
    if (rated === null) {
      if (fresh[0]?.rated) rated = true;
      else
        ({ ratings, played } = ratingChanges([progressOf(0), progressOf(1)], winner));
    }
    if (rewarded === null && reward) {
      const progress = progressOf(reward.seat);
      if (progress?.rankedRewardMatchId === row.id) {
        // No claim followed this match's, so the weekly count is the one it wrote.
        rewarded = true;
        reward = { ...reward, packItemId: weeklyPackAt(progress, plan.weekKey) };
      } else if (!rewardClaimable(progress, plan.dayKey)) rewarded = false;
      else reward = { ...reward, packItemId: weeklyPackAfter(progress, plan.weekKey) };
    }
  }
  if (rated === null || rewarded === null) return { row, paid: null };
  const paidReward = rewarded && reward ? reward : null;
  const result: KessenPvpResult = {
    ...plan.result,
    ratings: rated ? ratings : null,
    reward: paidReward
      ? {
          seat: paidReward.seat,
          ryo: paidReward.ryo,
          packItemId: paidReward.packItemId,
        }
      : null,
    note:
      plan.result.note ??
      (plan.reward && !rewarded
        ? "The winner already earned today's ranked rewards."
        : null),
    settling: false,
  };
  const state: KessenStoredPvpMatch = { ...stored, result, settlement: null };
  const now = new Date();
  const write = await updateKessenPvpMatchResult(client, row, { state, now });
  if (write.rowsAffected !== 1) {
    const [fresh] = await findKessenPvpMatchById(client, row.id);
    return { row: fresh ?? row, paid: null };
  }
  const settledRow: KessenMatch = {
    ...row,
    version: row.version + 1,
    state: state as unknown as Record<string, unknown>,
    updatedAt: now,
  };
  const questData = objectiveUser
    ? kessenObjectiveTrackers(kessenTrackerUser(...quest), {
        npcKey: "ranked",
        tier: null,
      })
    : undefined;
  const winnerId = paidReward?.userId ?? objectiveUser;
  const grants: ItemGrant[] = paidReward?.packItemId
    ? [{ itemId: paidReward.packItemId, quantity: 1 }]
    : [];
  const ryo = paidReward?.ryo ?? 0;
  if (winnerId) {
    await Promise.all([
      ryo > 0 || questData
        ? updateUserDataForKessenPayout(client, winnerId, ryo, questData)
        : null,
      grants.length > 0 ? grantUserItems(client, winnerId, grants) : null,
    ]);
  }
  return {
    row: settledRow,
    paid:
      winnerId && (ryo > 0 || grants.length > 0)
        ? { userId: winnerId, ryo, grants }
        : null,
  };
};

/**
 * Creates a duel between two players whose decks are already built, after the request
 * or queue claim that decided it. Keeps the one-active-match rule: when either player
 * has another ACTIVE match once the duel is written (a concurrent start), the duel is
 * voided. Pushes both players once the response is sent and notifies the one who did
 * not start it.
 */
export const createKessenDuel = async (
  client: DrizzleClient,
  input: {
    matchId: string;
    kind: Exclude<KessenMatchKind, "NPC">;
    now: Date;
    catalogRows: Awaited<ReturnType<typeof listKessenCards>>;
    seats: [KessenDuelSeat, KessenDuelSeat];
    startedBy: string;
  },
): Promise<{ row: KessenMatch } | { error: string }> => {
  const { now, seats } = input;
  const setup = {
    seed: nanoid(),
    seats: [
      { leaderId: seats[0].deck.leaderId, deck: expandDeckCards(seats[0].deck.cards) },
      { leaderId: seats[1].deck.leaderId, deck: expandDeckCards(seats[1].deck.cards) },
    ] as [{ leaderId: string; deck: string[] }, { leaderId: string; deck: string[] }],
    cards: snapshotCatalog(kessenCatalogCards(input.catalogRows)),
  };
  if (matchInputProblem(setup))
    return { error: "One of the decks has cards that are not available right now." };
  const engine = createMatch(setup);
  const state: KessenStoredPvpMatch = {
    engine,
    players: [seats[0].player, seats[1].player],
    borrowed: [borrowedIds(seats[0]), borrowedIds(seats[1])],
    plays: [0, 0],
    log: [],
    timeouts: [0, 0],
    result: null,
    settlement: null,
  };
  const userIds = [seats[0].player.userId, seats[1].player.userId];
  const row: KessenMatch = {
    id: input.matchId,
    kind: input.kind,
    userId: seats[0].player.userId,
    opponentId: seats[1].player.userId,
    npcKey: null,
    tier: null,
    deckId: null,
    status: "ACTIVE",
    version: 1,
    engineVersion: CARD_ENGINE_VERSION,
    seed: engine.seed,
    state: state as unknown as Record<string, unknown>,
    rewarded: false,
    rated: false,
    turnDeadline: new Date(now.getTime() + KESSEN_PVP_MULLIGAN_SECONDS * 1000),
    startedAt: now,
    updatedAt: now,
    finishedAt: null,
  };
  await Promise.all([
    insertKessenMatch(client, { ...row, state }),
    insertKessenProgressRowsIfMissing(client, userIds),
  ]);
  const active = await listActiveKessenMatchesForPlayers(client, userIds);
  if (active.some((entry) => entry.id !== row.id)) {
    await updateKessenPvpMatchesForVoid(client, [row.id], now);
    return { error: "Another match is starting; try again in a moment." };
  }
  const kindLabel = input.kind === "RANKED" ? "ranked duel" : "duel";
  after(() =>
    Promise.all(
      seats.map((seat, index) =>
        getServerPusher().trigger(seat.player.userId, "event", {
          type: "userMessage",
          message: `Your Kessen ${kindLabel} against ${seats[index === 0 ? 1 : 0].player.username} has begun.`,
          route: "/kessen",
          routeText: "To the table",
          kessen: { event: "matchStarted", matchId: row.id, kind: input.kind },
        }),
      ),
    ),
  );
  notifyKessenDuelStarted(client, {
    matchId: row.id,
    userIds,
    startedBy: input.startedBy,
  });
  return { row };
};

/** One seat's view of a duel row. */
export const kessenDuelPayload = (
  row: KessenMatch,
  seat: Seat,
  now: Date,
): KessenPvpMatchPayload => {
  const stored = storedDuelOf(row);
  const retired = row.status === "ACTIVE" && row.engineVersion !== CARD_ENGINE_VERSION;
  const active = row.status === "ACTIVE" && !retired;
  return {
    id: row.id,
    kind: row.kind as KessenPvpMatchPayload["kind"],
    version: row.version,
    status: retired ? "EXPIRED" : row.status,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    seat,
    players: stored.players,
    view: viewFor(stored.engine, seat),
    clock: {
      deadline: active ? row.turnDeadline : null,
      acting: active ? actingSeats(stored.engine) : [],
      serverNow: now,
      turnSeconds: KESSEN_PVP_TURN_SECONDS,
      mulliganSeconds: KESSEN_PVP_MULLIGAN_SECONDS,
      timeouts: stored.timeouts,
      maxTimeouts: KESSEN_PVP_MAX_TIMEOUTS,
    },
    borrowed: stored.borrowed[seat],
    result: active ? null : viewResult(stored.result, seat),
  };
};

/** One seat's play log of a duel: the stored events redacted for that seat. */
export const kessenDuelLog = (
  row: KessenMatch,
  payload: KessenPvpMatchPayload,
): KessenMatchLog => {
  const events = redactEvents(storedDuelOf(row).log, payload.seat);
  return getKessenMatchLog(
    events,
    kessenLogNames(events, payload.view.inst),
    row.version,
  );
};

/**
 * The result and ranked plan of a duel that just ended, from one snapshot of both
 * players' progress and today's rated matches between them. Pure.
 */
export const planKessenDuelEnd = (input: {
  kind: KessenMatchKind;
  matchId: string;
  seatUserIds: [string, string];
  stored: KessenStoredPvpMatch;
  ending: DuelEnding;
  startedAt: Date;
  now: Date;
  progress: [KessenProgress | null, KessenProgress | null];
  /** Rated ranked matches between the two players today. */
  pairRatedToday: number;
}): { result: KessenPvpResult; settlement: KessenPvpSettlement | null } => {
  const { ending, now } = input;
  const base: KessenPvpResult = {
    winner: ending.winner,
    endedBy: ending.endedBy,
    loserBy: ending.loserBy,
    ratings: null,
    reward: null,
    note: null,
    settling: false,
  };
  if (input.kind !== "RANKED" || ending.endedBy === "void")
    return { result: base, settlement: null };
  if (input.pairRatedToday >= KESSEN_RANKED_PAIR_DAILY_RATED) {
    return {
      result: {
        ...base,
        note: `You already played ${KESSEN_RANKED_PAIR_DAILY_RATED} rated matches against each other today; this one was unrated.`,
      },
      settlement: null,
    };
  }
  const dayKey = getUtcDayKey(now);
  const weekKey = getUtcDayKey(periodStart("weekly", now));
  const { ratings, played } = ratingChanges(input.progress, ending.winner);
  const eligibility = kessenDuelEligibility({
    winner: ending.winner,
    durationMs: now.getTime() - input.startedAt.getTime(),
    plays: input.stored.plays,
  });
  let reward: KessenPvpSettlement["reward"] = null;
  let note: string | null = null;
  if (ending.winner !== null) {
    const winner = ending.winner;
    const progress = input.progress[winner];
    const today =
      progress?.rankedRewardDay === dayKey ? progress.rankedRewardsToday : 0;
    if (!eligibility.eligible) note = eligibility.reason;
    else if (today >= KESSEN_RANKED_DAILY_REWARDED_WINS)
      note = "The winner already earned today's ranked rewards.";
    else
      reward = {
        seat: winner,
        userId: input.seatUserIds[winner],
        ryo: KESSEN_RANKED_WIN_RYO,
        packItemId: weeklyPackAfter(progress, weekKey),
      };
  }
  const result: KessenPvpResult = {
    ...base,
    ratings,
    reward: reward
      ? { seat: reward.seat, ryo: reward.ryo, packItemId: reward.packItemId }
      : null,
    note,
  };
  return {
    result,
    settlement: {
      dayKey,
      weekKey,
      ratings,
      played,
      reward,
      objectiveUserId:
        ending.winner !== null && eligibility.eligible
          ? input.seatUserIds[ending.winner]
          : null,
      result,
    },
  };
};

/** Reads what the ranked plan needs (both players' progress, today's rated pairs) and plans. */
const planDuelEnd = async (
  client: DrizzleClient,
  row: KessenMatch,
  stored: KessenStoredPvpMatch,
  ending: DuelEnding,
  now: Date,
) => {
  const seatUserIds: [string, string] = [row.userId, row.opponentId ?? ""];
  const ranked = row.kind === "RANKED";
  const dayStart = periodStart("daily", now);
  const [progressRows, pairs] = ranked
    ? await Promise.all([
        listKessenProgressRows(client, seatUserIds),
        listKessenRatedPairs(client, row.userId, dayStart),
      ])
    : [[], []];
  const progressOf = (userId: string) =>
    progressRows.find((entry) => entry.userId === userId) ?? null;
  return planKessenDuelEnd({
    kind: row.kind,
    matchId: row.id,
    seatUserIds,
    stored,
    ending,
    startedAt: row.startedAt,
    now,
    progress: [progressOf(seatUserIds[0]), progressOf(seatUserIds[1])],
    pairRatedToday: pairs.filter(
      (pair) =>
        (pair.userId === seatUserIds[0] && pair.opponentId === seatUserIds[1]) ||
        (pair.userId === seatUserIds[1] && pair.opponentId === seatUserIds[0]),
    ).length,
  });
};

/** A lost CAS: the row as it now stands, nothing of this call written. */
const lostAdvance = async (
  client: DrizzleClient,
  row: KessenMatch,
  decision: KessenDuelDecision | undefined,
): Promise<KessenDuelAdvance> => {
  const [fresh] = await findKessenPvpMatchById(client, row.id);
  return {
    row: fresh ?? row,
    events: [],
    refused: decision ? STALE_DUEL_MESSAGE : null,
    lost: true,
    paid: null,
  };
};

/** The row as this call's version CAS left it; a terminal `status` also sets `finishedAt`. */
const nextRow = (
  row: KessenMatch,
  state: KessenStoredPvpMatch,
  now: Date,
  deadline: Date | null,
  status: KessenMatch["status"] | null,
): KessenMatch => ({
  ...row,
  version: row.version + 1,
  state: state as unknown as Record<string, unknown>,
  updatedAt: now,
  turnDeadline: deadline,
  ...(status ? { status, finishedAt: now } : {}),
});

const engineEnding = (engine: MatchState): DuelEnding | null =>
  engine.phase === "over"
    ? { winner: engine.result?.winner ?? null, endedBy: "play", loserBy: null }
    : null;

const scoreOf = (winner: Seat | null, seat: Seat): 0 | 0.5 | 1 =>
  winner === null ? 0.5 : winner === seat ? 1 : 0;

/** Both seats' rating changes of a ranked duel from the players' progress. */
const ratingChanges = (
  progress: [KessenProgress | null, KessenProgress | null],
  winner: Seat | null,
): { ratings: [KessenRatingChange, KessenRatingChange]; played: [number, number] } => {
  const ratingOf = (seat: Seat) => progress[seat]?.rating ?? KESSEN_RANKED_START_RATING;
  const playedOf = (seat: Seat) => progress[seat]?.rankedPlayed ?? 0;
  const change = (seat: Seat): KessenRatingChange => {
    const before = ratingOf(seat);
    const delta = kessenRatingDelta({
      rating: before,
      opponentRating: ratingOf(other(seat)),
      score: scoreOf(winner, seat),
      played: playedOf(seat),
    });
    return { before, after: before + delta, delta };
  };
  return { ratings: [change(0), change(1)], played: [playedOf(0), playedOf(1)] };
};

/** The weekly pack of the next rewarded win, from the winner's progress before it. */
const weeklyPackAfter = (progress: KessenProgress | null, weekKey: string) =>
  (progress?.rankedWeekKey === weekKey ? progress.rankedWeeklyWins : 0) + 1 ===
  KESSEN_RANKED_WEEKLY_PACK_WINS
    ? KESSEN_PACK_IDS.paper
    : null;

/** The weekly pack of the rewarded win the winner's progress last counted. */
const weeklyPackAt = (progress: KessenProgress, weekKey: string) =>
  progress.rankedWeekKey === weekKey &&
  progress.rankedWeeklyWins === KESSEN_RANKED_WEEKLY_PACK_WINS
    ? KESSEN_PACK_IDS.paper
    : null;

/** Whether the reward claim of `dayKey` can still succeed for another match. */
const rewardClaimable = (progress: KessenProgress | null, dayKey: string) =>
  !!progress &&
  progress.rankedRewardDay <= dayKey &&
  (progress.rankedRewardDay !== dayKey ||
    progress.rankedRewardsToday < KESSEN_RANKED_DAILY_REWARDED_WINS);

const voidResult = (): KessenPvpResult => ({
  winner: null,
  endedBy: "void",
  loserBy: null,
  ratings: null,
  reward: null,
  note: null,
  settling: false,
});

/** The result stored with the ending write until the settled result replaces it. */
const unsettledResult = (planned: KessenPvpResult): KessenPvpResult => ({
  ...planned,
  ratings: null,
  reward: null,
  note: null,
  settling: true,
});

const borrowedIds = (seat: KessenDuelSeat) =>
  [...new Set(seat.deck.borrowed.map((entry) => entry.itemId))].sort();

/** A stored result as `seat` sees it; a duel without one ended void. */
const viewResult = (
  result: KessenPvpResult | null,
  seat: Seat,
): KessenPvpViewResult => {
  const stored = result ?? voidResult();
  const outcome =
    stored.endedBy === "void"
      ? "void"
      : stored.winner === null
        ? "draw"
        : stored.winner === seat
          ? "win"
          : "loss";
  return {
    winner: stored.winner,
    outcome,
    endedBy: stored.endedBy,
    loserBy: stored.loserBy,
    rating: stored.ratings
      ? { you: stored.ratings[seat], opponent: stored.ratings[other(seat)] }
      : null,
    reward:
      stored.reward && stored.reward.seat === seat
        ? { ryo: stored.reward.ryo, packItemId: stored.reward.packItemId }
        : null,
    note: stored.note,
    settling: stored.settling,
  };
};

/** A decision of one seat for `advanceKessenDuel`. */
export type KessenDuelDecision =
  | { seat: Seat; action: KessenAction; version: number }
  | { seat: Seat; concede: true };

/** What `advanceKessenDuel` did. */
export interface KessenDuelAdvance {
  /** The row as it stands after this call (refetched when another request won). */
  row: KessenMatch;
  /** Unredacted events this call committed, oldest first. */
  events: KessenEvent[];
  /** Why the decision was not applied; null when it was, or when none was given. */
  refused: string | null;
  /** Another request changed the duel first; nothing of this call was written. */
  lost: boolean;
  /** What the settlement paid, and to whom. */
  paid: { userId: string; ryo: number; grants: ItemGrant[] } | null;
}

/** One player of `createKessenDuel`. */
export interface KessenDuelSeat {
  player: KessenPvpPlayer;
  deck: {
    leaderId: string;
    cards: { itemId: string; count: number }[];
    borrowed: { itemId: string; count: number }[];
  };
}

/** How a duel ends, in engine seats. */
export interface DuelEnding {
  winner: Seat | null;
  endedBy: KessenPvpEnd;
  loserBy: Seat | null;
}
