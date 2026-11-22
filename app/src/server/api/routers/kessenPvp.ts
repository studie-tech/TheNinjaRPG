import { nanoid } from "nanoid";
import { after } from "next/server";
import { z } from "zod";
import { getKessenPayoutUserUpdate } from "@/deltas/kessen";
import {
  KESSEN_CHALLENGE_EXPIRY_SECONDS,
  KESSEN_CHALLENGE_HOURLY_LIMIT,
  KESSEN_CHALLENGE_MAX_PENDING,
  KESSEN_RANKED_CLAIM_TIMEOUT_SECONDS,
  KESSEN_RANKED_DAILY_REWARDED_WINS,
  KESSEN_RANKED_LEADERBOARD_SIZE,
  KESSEN_RANKED_PAIR_DAILY_RATED,
  KESSEN_RANKED_QUEUE_HEARTBEAT_SECONDS,
  KESSEN_RANKED_START_RATING,
  KESSEN_RANKED_WEEKLY_PACK_WINS,
  KESSEN_RANKED_WIN_RYO,
} from "@/drizzle/constants";
import type { KessenProgress, UserRequest } from "@/drizzle/schema";
import { finishedFirstLesson } from "@/libs/kessen/academy";
import {
  kessenCatalogCards,
  ownedCardCounts,
  snapshotCatalog,
} from "@/libs/kessen/catalog";
import { buildPlayerDeck } from "@/libs/kessen/deck";
import { redactEvents } from "@/libs/kessen/engine";
import { pickKessenOpponent } from "@/libs/kessen/pvp";
import type { KessenEvent, Seat } from "@/libs/kessen/types";
import { getServerPusher } from "@/libs/pusher";
import {
  findKessenDeck,
  listKessenCards,
  listOwnedKessenCardCounts,
} from "@/queries/kessen";
import {
  countKessenRankedQueue,
  countKessenRatingsAbove,
  deleteKessenRankedQueueForLeave,
  deleteKessenRankedQueueRows,
  findKessenPvpMatch,
  findKessenRankedQueueRow,
  insertKessenRankedQueue,
  listActiveKessenMatchesForPlayers,
  listKessenBlacklistBetween,
  listKessenDuelists,
  listKessenLeaderboard,
  listKessenProgressRows,
  listKessenRankedQueue,
  listKessenRatedPairs,
  updateKessenRankedQueueForClaim,
  updateKessenRankedQueueForRelease,
  updateKessenRankedQueueSeen,
  updateUserRequestForExpireKessenChallenges,
} from "@/queries/kessenPvp";
import { fetchRequests, insertRequest } from "@/queries/sparring";
import { fetchRequest, updateRequestState } from "@/routers/sparring";
import { createTRPCRouter, errorResponse, protectedProcedure } from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import {
  advanceKessenDuel,
  createKessenDuel,
  type KessenDuelAdvance,
  type KessenDuelDecision,
  type KessenDuelSeat,
  kessenDuelLog,
  kessenDuelPayload,
  kessenDuelSeat,
} from "@/server/utils/kessenPvp";
import { isMysqlDuplicateKeyError } from "@/server/utils/mysqlErrors";
import { notifyKessenChallenge } from "@/server/utils/push/kessen";
import { getUtcDayKey, periodStart } from "@/utils/time";
import {
  decodeKessenDeckSource,
  encodeKessenDeckSource,
  type KessenChallenge,
  type KessenDeckSource,
  type KessenLeaderboard,
  type KessenLeaderboardEntry,
  type KessenPvpActiveMatch,
  type KessenPvpLobby,
  type KessenPvpMatchQuery,
  kessenActionSchema,
  kessenDeckSourceSchema,
} from "@/validators/kessen";

const idSchema = z.string().min(1).max(191);

/**
 * Live Kessen duels between players: friendly challenges (no rewards, no rating) and the
 * ranked queue (Elo rating, modest ryo and a weekly pack). Every duel change is one
 * version CAS followed by a `{ version }` push on the duel's channel; each seat
 * refetches its own redacted view with `getMatch`, which also applies clocks that ran out.
 */
export const kessenPvpRouter = createTRPCRouter({
  getLobby: protectedProcedure
    .meta({ mcp: { description: "Get the player's Kessen duel lobby" } })
    .input(z.object({}).nullish())
    .query(async ({ ctx }): Promise<KessenPvpLobby> => {
      const userId = ctx.userId;
      const now = new Date();
      const [progressRows, active, requests, queueRows, queueCount] = await Promise.all(
        [
          listKessenProgressRows(ctx.drizzle, [userId]),
          listActiveKessenMatchesForPlayers(ctx.drizzle, [userId]),
          fetchRequests(
            ctx.drizzle,
            ["KESSEN"],
            KESSEN_CHALLENGE_EXPIRY_SECONDS,
            userId,
          ),
          findKessenRankedQueueRow(ctx.drizzle, userId),
          countKessenRankedQueue(ctx.drizzle, heartbeatSince(now)),
        ],
      );
      const progress = progressRows[0] ?? null;
      const queue = queueRows[0];
      return {
        lessonCompleted: finishedFirstLesson(progress?.academy),
        ranked: rankedSummary(progress, now),
        activeMatch: activeDuelOf(active, userId),
        challenges: requests
          .filter((request) => request.status === "PENDING")
          .map((request) => challengeOf(request, userId)),
        queue: queue ? { queuedAt: queue.queuedAt, matchId: queue.matchId } : null,
        queueCount: queueCount[0]?.queued ?? 0,
      };
    }),

  getMatch: protectedProcedure
    .meta({ mcp: { description: "Get one of the player's Kessen duels" } })
    .input(z.object({ matchId: idSchema }))
    .query(async ({ ctx, input }): Promise<KessenPvpMatchQuery> => {
      const now = new Date();
      const [found] = await findKessenPvpMatch(ctx.drizzle, ctx.userId, input.matchId);
      if (!found) return { match: null, log: null };
      // Reading a duel applies the clocks that ran out, so the waiting seat ends an
      // idle opponent's turn by refetching once the deadline passed.
      const advanced = await advanceKessenDuel(ctx.drizzle, found, { now });
      const match = kessenDuelPayload(
        advanced.row,
        kessenDuelSeat(advanced.row, ctx.userId),
        now,
      );
      return { match, log: kessenDuelLog(advanced.row, match) };
    }),

  playTurn: protectedProcedure
    .meta({ mcp: { description: "Play one Kessen duel decision" } })
    .input(
      z.object({
        matchId: idSchema,
        version: z.number().int().min(1),
        action: kessenActionSchema,
      }),
    )
    .mutation(async ({ ctx, input }) =>
      decideDuel(ctx.drizzle, ctx.userId, input.matchId, (seat) => ({
        seat,
        action: input.action,
        version: input.version,
      })),
    ),

  concede: protectedProcedure
    .meta({ mcp: { description: "Concede a Kessen duel" } })
    .input(z.object({ matchId: idSchema }))
    .mutation(async ({ ctx, input }) =>
      decideDuel(ctx.drizzle, ctx.userId, input.matchId, (seat) => ({
        seat,
        concede: true,
      })),
    ),

  createChallenge: protectedProcedure
    .meta({
      mcp: { description: "Challenge another player to a friendly Kessen duel" },
    })
    .input(z.object({ targetId: idSchema, deck: kessenDeckSourceSchema }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId;
      const now = new Date();
      if (input.targetId === userId)
        return errorResponse("You cannot challenge yourself.");
      const ids = [userId, input.targetId];
      const [
        players,
        blacklist,
        progressRows,
        active,
        requests,
        catalogRows,
        deckRows,
        ownedRows,
      ] = await Promise.all([
        listKessenDuelists(ctx.drizzle, ids),
        listKessenBlacklistBetween(ctx.drizzle, userId, [input.targetId]),
        listKessenProgressRows(ctx.drizzle, ids),
        listActiveKessenMatchesForPlayers(ctx.drizzle, ids),
        fetchRequests(ctx.drizzle, ["KESSEN"], 3600, userId),
        listKessenCards(ctx.drizzle),
        deckRowsFor(ctx.drizzle, userId, input.deck),
        listOwnedKessenCardCounts(ctx.drizzle, userId),
        // Housekeeping: frees the pair slot of a challenge that expired unanswered.
        updateUserRequestForExpireKessenChallenges(
          ctx.drizzle,
          challengeCutoff(now),
          ids,
        ),
      ]);
      const me = players.find((entry) => entry.userId === userId);
      const target = players.find((entry) => entry.userId === input.targetId);
      if (!isActivePlayer(me))
        return errorResponse("Your character cannot duel right now.");
      if (!isActivePlayer(target))
        return errorResponse("Choose another active player to challenge.");
      if (blacklist.length > 0)
        return errorResponse("You cannot challenge this player.");
      const lesson = (id: string) =>
        finishedFirstLesson(progressRows.find((row) => row.userId === id)?.academy);
      if (!lesson(userId))
        return errorResponse("Finish Lemu's first Academy lesson first.");
      if (!lesson(input.targetId))
        return errorResponse("That player has not learned Kessen yet.");
      if (active.some((row) => seatOf(row, userId) !== null))
        return errorResponse("Finish your current Kessen match first.");
      if (active.some((row) => seatOf(row, input.targetId) !== null))
        return errorResponse("That player is in a match right now.");
      const live = requests.filter((request) => isLiveChallenge(request, now));
      if (live.some((request) => involves(request, input.targetId)))
        return errorResponse("You already have a pending challenge with this player.");
      if (
        live.filter((request) => request.senderId === userId).length >=
        KESSEN_CHALLENGE_MAX_PENDING
      )
        return errorResponse(
          `You can have up to ${KESSEN_CHALLENGE_MAX_PENDING} pending challenges.`,
        );
      if (
        requests.filter((request) => request.senderId === userId).length >=
        KESSEN_CHALLENGE_HOURLY_LIMIT
      )
        return errorResponse("You sent too many challenges; try again later.");
      const deck = buildDuelDeck({
        userId,
        source: input.deck,
        deckRow: deckRows[0] ?? null,
        catalogRows,
        ownedRows,
        now,
      });
      if ("error" in deck) return errorResponse(deck.error);

      // The pair's unique pending slot decides between concurrent challenges.
      try {
        await insertRequest(
          ctx.drizzle,
          userId,
          input.targetId,
          "KESSEN",
          undefined,
          encodeKessenDeckSource(input.deck),
        );
      } catch (error) {
        if (isMysqlDuplicateKeyError(error))
          return errorResponse(
            "You already have a pending challenge with this player.",
          );
        throw error;
      }
      after(() =>
        getServerPusher().trigger(input.targetId, "event", {
          type: "userMessage",
          message: `${me.username} challenged you to a Kessen duel.`,
          route: "/kessen?tab=duels",
          routeText: "Answer",
          kessen: { event: "challengeReceived" },
        }),
      );
      notifyKessenChallenge(ctx.drizzle, input.targetId);
      return { success: true, message: `Challenge sent to ${target.username}.` };
    }),

  acceptChallenge: protectedProcedure
    .meta({ mcp: { description: "Accept a friendly Kessen challenge with a deck" } })
    .input(z.object({ requestId: idSchema, deck: kessenDeckSourceSchema }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId;
      const now = new Date();
      const request = await fetchRequest(ctx.drizzle, input.requestId, "KESSEN", {
        allowMissing: true,
      });
      if (!request) return errorResponse("This challenge is no longer available.");
      if (request.receiverId !== userId)
        return errorResponse("Not your challenge to accept.");
      if (request.status !== "PENDING")
        return errorResponse("This challenge is no longer pending.");
      if (request.createdAt < challengeCutoff(now)) {
        await updateRequestState(
          ctx.drizzle,
          request.id,
          "EXPIRED",
          "KESSEN",
          undefined,
          "PENDING",
        );
        return errorResponse("This challenge has expired.");
      }
      const senderId = request.senderId;
      const senderDeck = decodeKessenDeckSource(request.relatedId);
      const ids = [senderId, userId];
      const [
        players,
        blacklist,
        active,
        catalogRows,
        senderDecks,
        myDecks,
        senderOwned,
        myOwned,
      ] = await Promise.all([
        listKessenDuelists(ctx.drizzle, ids),
        listKessenBlacklistBetween(ctx.drizzle, userId, [senderId]),
        listActiveKessenMatchesForPlayers(ctx.drizzle, ids),
        listKessenCards(ctx.drizzle),
        senderDeck ? deckRowsFor(ctx.drizzle, senderId, senderDeck) : [],
        deckRowsFor(ctx.drizzle, userId, input.deck),
        listOwnedKessenCardCounts(ctx.drizzle, senderId),
        listOwnedKessenCardCounts(ctx.drizzle, userId),
      ]);
      const sender = players.find((entry) => entry.userId === senderId);
      const me = players.find((entry) => entry.userId === userId);
      if (!isActivePlayer(me))
        return errorResponse("Your character cannot duel right now.");
      if (!isActivePlayer(sender))
        return errorResponse("The challenger is no longer available.");
      if (blacklist.length > 0)
        return errorResponse("You cannot accept this challenge.");
      if (active.some((row) => seatOf(row, userId) !== null))
        return errorResponse("Finish your current Kessen match first.");
      if (active.some((row) => seatOf(row, senderId) !== null))
        return errorResponse("The challenger is in another match right now.");
      const mine = buildDuelDeck({
        userId,
        source: input.deck,
        deckRow: myDecks[0] ?? null,
        catalogRows,
        ownedRows: myOwned,
        now,
      });
      if ("error" in mine) return errorResponse(mine.error);
      const theirs = senderDeck
        ? buildDuelDeck({
            userId: senderId,
            source: senderDeck,
            deckRow: senderDecks[0] ?? null,
            catalogRows,
            ownedRows: senderOwned,
            now,
          })
        : { error: "missing" };
      if ("error" in theirs) {
        await updateRequestState(
          ctx.drizzle,
          request.id,
          "CANCELLED",
          "KESSEN",
          undefined,
          "PENDING",
        );
        return errorResponse(
          "The challenger's deck is no longer valid, so the challenge was withdrawn.",
        );
      }

      // Accepting is a CAS on the pending request, so only one of accept, reject and
      // cancel wins; the match is created by the winning accept only.
      const matchId = nanoid();
      const claim = await updateRequestState(
        ctx.drizzle,
        request.id,
        "ACCEPTED",
        "KESSEN",
        matchId,
        "PENDING",
      );
      if (!claim.success) return errorResponse("This challenge is no longer pending.");
      const created = await createKessenDuel(ctx.drizzle, {
        matchId,
        kind: "FRIENDLY",
        now,
        catalogRows,
        startedBy: userId,
        seats: [
          { player: duelPlayer(sender, null), deck: theirs },
          { player: duelPlayer(me, null), deck: mine },
        ],
      });
      if ("error" in created) return errorResponse(created.error);
      return {
        success: true,
        message: "Challenge accepted. The duel begins.",
        match: kessenDuelPayload(created.row, 1, now),
      };
    }),

  rejectChallenge: protectedProcedure
    .meta({ mcp: { description: "Decline a friendly Kessen challenge" } })
    .input(z.object({ requestId: idSchema }))
    .mutation(async ({ ctx, input }) => {
      const request = await fetchRequest(ctx.drizzle, input.requestId, "KESSEN", {
        allowMissing: true,
      });
      if (!request) return errorResponse("This challenge is no longer available.");
      if (request.receiverId !== ctx.userId)
        return errorResponse("Not your challenge to decline.");
      if (request.status !== "PENDING")
        return errorResponse("This challenge is no longer pending.");
      return answerChallenge(ctx.drizzle, request, "REJECTED", "Challenge declined.");
    }),

  cancelChallenge: protectedProcedure
    .meta({ mcp: { description: "Withdraw a friendly Kessen challenge you sent" } })
    .input(z.object({ requestId: idSchema }))
    .mutation(async ({ ctx, input }) => {
      const request = await fetchRequest(ctx.drizzle, input.requestId, "KESSEN", {
        allowMissing: true,
      });
      if (!request) return errorResponse("This challenge is no longer available.");
      if (request.senderId !== ctx.userId)
        return errorResponse("Only the challenger can withdraw this challenge.");
      if (request.status !== "PENDING")
        return errorResponse("This challenge is no longer pending.");
      return answerChallenge(ctx.drizzle, request, "CANCELLED", "Challenge withdrawn.");
    }),

  joinRankedQueue: protectedProcedure
    .meta({ mcp: { description: "Join the ranked Kessen queue with a deck" } })
    .input(z.object({ deck: kessenDeckSourceSchema }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId;
      const now = new Date();
      const [players, progressRows, queued, active, catalogRows, deckRows, ownedRows] =
        await Promise.all([
          listKessenDuelists(ctx.drizzle, [userId]),
          listKessenProgressRows(ctx.drizzle, [userId]),
          findKessenRankedQueueRow(ctx.drizzle, userId),
          listActiveKessenMatchesForPlayers(ctx.drizzle, [userId]),
          listKessenCards(ctx.drizzle),
          deckRowsFor(ctx.drizzle, userId, input.deck),
          listOwnedKessenCardCounts(ctx.drizzle, userId),
        ]);
      const progress = progressRows[0];
      if (!isActivePlayer(players[0]))
        return errorResponse("Your character cannot duel right now.");
      if (!progress || !finishedFirstLesson(progress.academy))
        return errorResponse("Finish Lemu's first Academy lesson first.");
      if (queued[0]) return errorResponse("You are already in the ranked queue.");
      if (active.length > 0)
        return errorResponse("Finish your current Kessen match first.");
      const deck = buildDuelDeck({
        userId,
        source: input.deck,
        deckRow: deckRows[0] ?? null,
        catalogRows,
        ownedRows,
        now,
      });
      if ("error" in deck) return errorResponse(deck.error);
      try {
        await insertKessenRankedQueue(ctx.drizzle, {
          userId,
          rating: progress.rating,
          deck: input.deck,
          now,
        });
      } catch (error) {
        if (isMysqlDuplicateKeyError(error))
          return errorResponse("You are already in the ranked queue.");
        throw error;
      }
      const status = await matchRankedQueue(ctx.drizzle, userId, now);
      return {
        ...status,
        success: true,
        message: status.message || "Searching for an opponent.",
      };
    }),

  leaveRankedQueue: protectedProcedure
    .meta({ mcp: { description: "Leave the ranked Kessen queue" } })
    .mutation(async ({ ctx }) => {
      const left = await deleteKessenRankedQueueForLeave(ctx.drizzle, ctx.userId);
      if (left.rowsAffected === 1)
        return { success: true, message: "You left the queue." };
      const [[row], active] = await Promise.all([
        findKessenRankedQueueRow(ctx.drizzle, ctx.userId),
        listActiveKessenMatchesForPlayers(ctx.drizzle, [ctx.userId]),
      ]);
      const matchId =
        row?.matchId ?? active.find((entry) => entry.kind === "RANKED")?.id ?? null;
      if (matchId)
        return {
          ...errorResponse("An opponent was found; your duel is starting."),
          matchId,
        };
      return errorResponse("You are not in the ranked queue.");
    }),

  checkRankedQueue: protectedProcedure
    .meta({
      mcp: { description: "Poll the ranked Kessen queue and look for an opponent" },
    })
    .mutation(async ({ ctx }) => {
      const status = await matchRankedQueue(ctx.drizzle, ctx.userId, new Date());
      return { ...status, success: status.inQueue || !!status.matchId };
    }),

  getLeaderboard: protectedProcedure
    .meta({ mcp: { description: "Get the ranked Kessen ladder" } })
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(KESSEN_RANKED_LEADERBOARD_SIZE).optional(),
        })
        .nullish(),
    )
    .query(async ({ ctx, input }): Promise<KessenLeaderboard> => {
      const limit = input?.limit ?? KESSEN_RANKED_LEADERBOARD_SIZE;
      const [rows, mine] = await Promise.all([
        listKessenLeaderboard(ctx.drizzle, limit),
        listKessenProgressRows(ctx.drizzle, [ctx.userId]),
      ]);
      const entries: KessenLeaderboardEntry[] = rows.map((row, index) => ({
        rank: index + 1,
        ...row,
      }));
      const listed = entries.find((entry) => entry.userId === ctx.userId);
      const progress = mine[0];
      if (listed || !progress || progress.rankedPlayed === 0)
        return { entries, you: listed ?? null };
      const [[above], [player]] = await Promise.all([
        countKessenRatingsAbove(ctx.drizzle, progress.rating),
        listKessenDuelists(ctx.drizzle, [ctx.userId]),
      ]);
      return {
        entries,
        you: {
          rank: (above?.above ?? 0) + 1,
          userId: ctx.userId,
          username: player?.username ?? "",
          avatar: player?.avatar ?? null,
          level: player?.level ?? 1,
          rating: progress.rating,
          wins: progress.rankedWins,
          losses: progress.rankedLosses,
          draws: progress.rankedDraws,
        },
      };
    }),
});

/**
 * One seat's decision on a duel (a play or a concession). A lost version CAS is retried
 * once on the fresh row for decisions that do not depend on the other seat's (a
 * mulligan or a concession); anything else returns the fresh duel for the client to
 * decide again.
 */
const decideDuel = async (
  client: DrizzleClient,
  userId: string,
  matchId: string,
  decide: (seat: Seat) => KessenDuelDecision,
) => {
  const now = new Date();
  let [row] = await findKessenPvpMatch(client, userId, matchId);
  if (!row)
    return { ...errorResponse("Match not found."), events: [] as KessenEvent[] };
  const seat = kessenDuelSeat(row, userId);
  const decision = decide(seat);
  let outcome: KessenDuelAdvance = await advanceKessenDuel(client, row, {
    now,
    decision,
  });
  const retriable = "concede" in decision || decision.action.t === "mull";
  if (outcome.lost && retriable) {
    row = outcome.row;
    outcome = await advanceKessenDuel(client, row, {
      now,
      decision:
        "concede" in decision ? decision : { ...decision, version: row.version },
    });
  }
  const match = kessenDuelPayload(outcome.row, seat, now);
  const events = redactEvents(outcome.events, seat);
  const paid = outcome.paid?.userId === userId ? outcome.paid : null;
  if (outcome.refused) return { ...errorResponse(outcome.refused), match, events };
  return {
    success: true,
    message: "concede" in decision ? "You conceded the duel." : "",
    match,
    events,
    granted: paid?.grants ?? [],
    ...getKessenPayoutUserUpdate(paid?.ryo ?? 0),
  };
};

/**
 * The ranked queue for one player, polled every few seconds: records the poll, returns
 * the duel a claim already created, and otherwise looks for an opponent and claims both
 * queue rows with one guarded statement before creating the duel.
 */
const matchRankedQueue = async (client: DrizzleClient, userId: string, now: Date) => {
  const since = heartbeatSince(now);
  const [rows, blacklist, pairs, active, queueCount] = await Promise.all([
    listKessenRankedQueue(client, userId, since),
    listKessenBlacklistBetween(client, userId),
    listKessenRatedPairs(client, userId, periodStart("daily", now)),
    listActiveKessenMatchesForPlayers(client, [userId]),
    countKessenRankedQueue(client, since),
    updateKessenRankedQueueSeen(client, userId, now),
  ]);
  const count = queueCount[0]?.queued ?? 0;
  const mine = rows.find((row) => row.userId === userId);
  const status = (patch: { message?: string; matchId?: string | null } = {}) => ({
    inQueue: !!mine && !patch.matchId,
    queuedAt: mine?.queuedAt ?? null,
    queueCount: count,
    matchId: patch.matchId ?? null,
    message: patch.message ?? "",
  });
  if (!mine) {
    // The other player's poll created the duel and removed both rows.
    const duel = active.find((row) => row.kind === "RANKED");
    return duel
      ? status({ matchId: duel.id, message: "Opponent found." })
      : { ...status(), inQueue: false };
  }
  if (mine.matchId) {
    const [created] = await findKessenPvpMatch(client, userId, mine.matchId);
    if (created) {
      await deleteKessenRankedQueueRows(client, [userId], mine.matchId);
      return status({ matchId: created.id, message: "Opponent found." });
    }
    // A claim whose duel never appeared (its request died) is released for a rematch.
    const claimedAt = mine.matchedAt?.getTime() ?? 0;
    if (now.getTime() - claimedAt > KESSEN_RANKED_CLAIM_TIMEOUT_SECONDS * 1000)
      await updateKessenRankedQueueForRelease(
        client,
        rows.filter((row) => row.matchId === mine.matchId).map((row) => row.userId),
        mine.matchId,
      );
    return status();
  }
  if (active.length > 0) {
    await deleteKessenRankedQueueRows(client, [userId]);
    return {
      ...status({ message: "Finish your current Kessen match first." }),
      inQueue: false,
    };
  }
  const excluded = new Set<string>();
  for (const entry of blacklist) {
    excluded.add(entry.creatorUserId);
    excluded.add(entry.targetUserId);
  }
  const pairCounts = new Map<string, number>();
  for (const pair of pairs) {
    const opponent = pair.userId === userId ? pair.opponentId : pair.userId;
    if (opponent) pairCounts.set(opponent, (pairCounts.get(opponent) ?? 0) + 1);
  }
  for (const [opponent, played] of pairCounts)
    if (played >= KESSEN_RANKED_PAIR_DAILY_RATED) excluded.add(opponent);
  const candidates = rows.filter(
    (row) => row.matchId === null && row.seenAt >= since && row.userId !== userId,
  );
  const opponent = pickKessenOpponent(mine, candidates, { now, excluded });
  if (!opponent) return status();

  const matchId = nanoid();
  const claim = await updateKessenRankedQueueForClaim(client, {
    userIds: [userId, opponent.userId],
    matchId,
    now,
  });
  if (claim.rowsAffected !== 2) return status();
  const ids = [userId, opponent.userId];
  const [
    players,
    progressRows,
    others,
    catalogRows,
    myDecks,
    theirDecks,
    myOwned,
    theirOwned,
  ] = await Promise.all([
    listKessenDuelists(client, ids),
    listKessenProgressRows(client, ids),
    listActiveKessenMatchesForPlayers(client, ids),
    listKessenCards(client),
    deckRowsFor(client, userId, mine.deck as KessenDeckSource),
    deckRowsFor(client, opponent.userId, opponent.deck as KessenDeckSource),
    listOwnedKessenCardCounts(client, userId),
    listOwnedKessenCardCounts(client, opponent.userId),
  ]);
  const build = (
    entry: typeof mine,
    deckRows: typeof myDecks,
    ownedRows: typeof myOwned,
  ) => {
    const source = kessenDeckSourceSchema.safeParse(entry.deck);
    return source.success
      ? buildDuelDeck({
          userId: entry.userId,
          source: source.data,
          deckRow: deckRows[0] ?? null,
          catalogRows,
          ownedRows,
          now,
        })
      : { error: "Your queued deck is not valid." };
  };
  const myDeck = build(mine, myDecks, myOwned);
  const theirDeck = build(opponent, theirDecks, theirOwned);
  const me = players.find((entry) => entry.userId === userId);
  const them = players.find((entry) => entry.userId === opponent.userId);
  const drop = async (dropped: string[], message: string) => {
    // The claimed rows of players who cannot duel leave the queue; the others match again.
    await Promise.all([
      deleteKessenRankedQueueRows(client, dropped),
      updateKessenRankedQueueForRelease(client, ids, matchId),
    ]);
    return dropped.includes(userId)
      ? { ...status({ message }), inQueue: false }
      : status();
  };
  if ("error" in myDeck || !isActivePlayer(me))
    return drop(
      [userId],
      "error" in myDeck ? myDeck.error : "Your character cannot duel right now.",
    );
  if (others.some((row) => seatOf(row, userId) !== null))
    return drop([userId], "Finish your current Kessen match first.");
  if (
    "error" in theirDeck ||
    !isActivePlayer(them) ||
    others.some((row) => seatOf(row, opponent.userId) !== null)
  )
    return drop([opponent.userId], "");
  const ratingOf = (id: string) =>
    progressRows.find((row) => row.userId === id)?.rating ?? KESSEN_RANKED_START_RATING;
  const mineSeat: KessenDuelSeat = {
    player: duelPlayer(me, ratingOf(userId)),
    deck: myDeck,
  };
  const theirSeat: KessenDuelSeat = {
    player: duelPlayer(them, ratingOf(opponent.userId)),
    deck: theirDeck,
  };
  // The player who waited longer takes seat 0; the opening coin decides who plays first.
  const seats: [KessenDuelSeat, KessenDuelSeat] =
    opponent.queuedAt < mine.queuedAt ? [theirSeat, mineSeat] : [mineSeat, theirSeat];
  const created = await createKessenDuel(client, {
    matchId,
    kind: "RANKED",
    now,
    catalogRows,
    startedBy: userId,
    seats,
  });
  if ("error" in created) {
    await updateKessenRankedQueueForRelease(client, ids, matchId);
    return status();
  }
  await deleteKessenRankedQueueRows(client, ids, matchId);
  return status({ matchId, message: "Opponent found." });
};

/** Moves a pending challenge to its answer (CAS on PENDING) and tells the other player. */
const answerChallenge = async (
  client: DrizzleClient,
  request: UserRequest,
  status: "REJECTED" | "CANCELLED",
  message: string,
) => {
  const result = await updateRequestState(
    client,
    request.id,
    status,
    "KESSEN",
    undefined,
    "PENDING",
  );
  if (!result.success) return errorResponse("This challenge is no longer pending.");
  const notified = status === "REJECTED" ? request.senderId : request.receiverId;
  after(() =>
    getServerPusher().trigger(notified, "event", {
      type: "kessenChallenge",
      event: status === "REJECTED" ? "rejected" : "cancelled",
      requestId: request.id,
    }),
  );
  return { success: true, message };
};

/** The saved deck a source names, read in the caller's first wave; none for a loaner. */
const deckRowsFor = (
  client: DrizzleClient,
  userId: string,
  source: KessenDeckSource,
) =>
  source.source === "loaner"
    ? Promise.resolve([])
    : findKessenDeck(client, userId, source.deckId);

/** A player's deck for a duel from their saved deck, owned cards and the catalog. */
const buildDuelDeck = (input: {
  userId: string;
  source: KessenDeckSource;
  deckRow: { leaderItemId: string; cards: { itemId: string; count: number }[] } | null;
  catalogRows: Awaited<ReturnType<typeof listKessenCards>>;
  ownedRows: Awaited<ReturnType<typeof listOwnedKessenCardCounts>>;
  now: Date;
}) => {
  const deck = buildPlayerDeck({
    source: input.source,
    deckRow: input.deckRow,
    userId: input.userId,
    dayKey: getUtcDayKey(input.now),
    pool: snapshotCatalog(kessenCatalogCards(input.catalogRows)),
    owned: ownedCardCounts(input.ownedRows).free,
  });
  if ("error" in deck) return deck;
  return { leaderId: deck.leaderId, cards: deck.cards, borrowed: deck.borrowed };
};

type Duelist = Awaited<ReturnType<typeof listKessenDuelists>>[number];

const isActivePlayer = (player: Duelist | undefined): player is Duelist =>
  !!player && !player.isAi && !player.isBanned && !player.deletionAt;

const duelPlayer = (player: Duelist, rating: number | null) => ({
  userId: player.userId,
  username: player.username,
  avatar: player.avatar,
  level: player.level,
  villageName: player.villageName,
  rating,
});

type ActiveRow = Awaited<ReturnType<typeof listActiveKessenMatchesForPlayers>>[number];

const seatOf = (
  row: Pick<ActiveRow, "userId" | "opponentId">,
  userId: string,
): Seat | null => (row.userId === userId ? 0 : row.opponentId === userId ? 1 : null);

const challengeCutoff = (now: Date) =>
  new Date(now.getTime() - KESSEN_CHALLENGE_EXPIRY_SECONDS * 1000);

const heartbeatSince = (now: Date) =>
  new Date(now.getTime() - KESSEN_RANKED_QUEUE_HEARTBEAT_SECONDS * 1000);

const involves = (
  request: Pick<UserRequest, "senderId" | "receiverId">,
  userId: string,
) => request.senderId === userId || request.receiverId === userId;

const isLiveChallenge = (
  request: Pick<UserRequest, "status" | "createdAt">,
  now: Date,
) => request.status === "PENDING" && request.createdAt >= challengeCutoff(now);

type RequestRow = Awaited<ReturnType<typeof fetchRequests>>[number];

const challengeOf = (request: RequestRow, userId: string): KessenChallenge => {
  const outgoing = request.senderId === userId;
  const other = outgoing ? request.receiver : request.sender;
  return {
    id: request.id,
    outgoing,
    status: request.status,
    createdAt: request.createdAt,
    expiresAt: new Date(
      request.createdAt.getTime() + KESSEN_CHALLENGE_EXPIRY_SECONDS * 1000,
    ),
    opponent: {
      userId: outgoing ? request.receiverId : request.senderId,
      username: other?.username ?? "",
      level: other?.level ?? 1,
      rank: other?.rank ?? "STUDENT",
      villageName: other?.village?.name ?? null,
    },
    matchId: request.status === "ACCEPTED" ? request.relatedId : null,
  };
};

const rankedSummary = (
  progress: KessenProgress | null,
  now: Date,
): KessenPvpLobby["ranked"] => {
  const dayKey = getUtcDayKey(now);
  const weekKey = getUtcDayKey(periodStart("weekly", now));
  return {
    rating: progress?.rating ?? KESSEN_RANKED_START_RATING,
    played: progress?.rankedPlayed ?? 0,
    wins: progress?.rankedWins ?? 0,
    losses: progress?.rankedLosses ?? 0,
    draws: progress?.rankedDraws ?? 0,
    rewardedToday:
      progress?.rankedRewardDay === dayKey ? progress.rankedRewardsToday : 0,
    rewardedCap: KESSEN_RANKED_DAILY_REWARDED_WINS,
    weeklyWins: progress?.rankedWeekKey === weekKey ? progress.rankedWeeklyWins : 0,
    weeklyPackWins: KESSEN_RANKED_WEEKLY_PACK_WINS,
    winRyo: KESSEN_RANKED_WIN_RYO,
  };
};

/** The lobby's summary of the player's duel in progress, from the active-match read. */
const activeDuelOf = (
  active: readonly ActiveRow[],
  userId: string,
): KessenPvpActiveMatch | null => {
  const row = active.find((entry) => entry.kind !== "NPC");
  const seat = row ? seatOf(row, userId) : null;
  if (!row || seat === null) return null;
  const standing = parseStanding(row.standing);
  const names = Array.isArray(standing.names) ? standing.names : [];
  const opponentSeat = seat === 0 ? 1 : 0;
  return {
    id: row.id,
    kind: row.kind as KessenPvpActiveMatch["kind"],
    seat,
    opponent: {
      userId: (opponentSeat === 0 ? row.userId : row.opponentId) ?? "",
      username: typeof names[opponentSeat] === "string" ? names[opponentSeat] : "",
    },
    deadline: row.turnDeadline,
    yourTurn:
      standing.phase === "mulligan"
        ? standing[`mull${seat}`] != null
        : standing.phase === "play" && standing.turn === seat,
  };
};

const parseStanding = (text: string | null): Record<string, unknown> => {
  if (!text) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};
