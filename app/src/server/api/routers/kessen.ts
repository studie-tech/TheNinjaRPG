import { nanoid } from "nanoid";
import { z } from "zod";
import { getKessenPayoutUserUpdate } from "@/deltas/kessen";
import { getQuestChallengeUserUpdate } from "@/deltas/questChallenge";
import {
  KESSEN_DAILY_DROP_ROLLS,
  KESSEN_DAILY_REWARDED_MATCHES,
  type KessenTier,
} from "@/drizzle/constants";
import type { KessenMatch, KessenNpcProgress, KessenProgress } from "@/drizzle/schema";
import {
  academyLessonFor,
  academyLessonLockReason,
  academyLessonStart,
  academyLessonsCompleted,
  academyProgress,
  finishedFirstLesson,
  isAcademyLessonKey,
  KESSEN_ACADEMY_LESSON_KEYS,
  KESSEN_ACADEMY_NPC,
} from "@/libs/kessen/academy";
import {
  catalogFingerprint,
  kessenCatalogCards,
  ownedCardCounts,
  snapshotCatalog,
} from "@/libs/kessen/catalog";
import {
  buildPlayerDeck,
  expandDeckCards,
  KESSEN_DECK_FACTIONS,
  KESSEN_RARITY_ORDER,
  loanerFaction,
} from "@/libs/kessen/deck";
import {
  actingSeats,
  applyAction,
  createMatch,
  matchInputProblem,
  redactEvents,
  viewFor,
} from "@/libs/kessen/engine";
import {
  homeFaction,
  KESSEN_CIRCUIT_MODES,
  KESSEN_NPCS,
  type KessenCircuitProgress,
  type KessenNpc,
  type KessenNpcKey,
  KessenNpcKeys,
  kessenNpc,
  momoFaction,
  npcLockReason,
  npcMatchPool,
  npcVariant,
} from "@/libs/kessen/npcs";
import { runNpcReplies, tierOfMode } from "@/libs/kessen/npcTurns";
import { countPlays, weeklyWinsFor } from "@/libs/kessen/rewards";
import { CARD_ENGINE_VERSION } from "@/libs/kessen/rules";
import type { KessenEvent, SeatSetup } from "@/libs/kessen/types";
import { findQuestChallenge } from "@/libs/quest/challenge";
import {
  findKessenDeck,
  findKessenMatch,
  findKessenNpcProgressRows,
  findKessenPlayer,
  findKessenProgress,
  insertKessenMatch,
  insertKessenProgressIfMissing,
  kessenMatchIsActive,
  listActiveKessenMatches,
  listKessenCards,
  listKessenDecks,
  listKessenFirstWinChoices,
  listKessenPackItems,
  listKessenPackStacks,
  listOwnedKessenCardCounts,
  updateKessenMatchesForConcede,
  updateKessenMatchForExpiry,
  updateKessenMatchForTurn,
  updateKessenMatchResult,
} from "@/queries/kessen";
import { listActiveKessenMatchesForPlayers } from "@/queries/kessenPvp";
import { fetchUser } from "@/queries/profile";
import { fetchQuestTrackerState } from "@/queries/quests";
import { fetchUpdatedUser, type UserWithRelations } from "@/routers/profile";
import {
  cdnCachedProcedure,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { grantUserItems } from "@/server/utils/itemGrants";
import {
  kessenPackOdds,
  kessenPackSlots,
  kessenPityCountdown,
} from "@/server/utils/kessenPacks";
import {
  kessenObjectiveTrackers,
  kessenTrackerUser,
  planKessenFinish,
  resumeKessenSettlement,
  settleKessenPayout,
  unsettledKessenResult,
} from "@/server/utils/kessenPayout";
import { recordQuestChallengeWin } from "@/server/utils/questChallenge";
import { getUtcDayKey, periodStart } from "@/utils/time";
import { parseJsonFields } from "@/utils/typeutils";
import {
  type KessenCatalog,
  type KessenCatalogEntry,
  type KessenCircuitEntry,
  type KessenHub,
  type KessenMatchPayload,
  type KessenMatchQuery,
  type KessenMatchResult,
  type KessenMode,
  type KessenPackEntry,
  type KessenStoredMatch,
  kessenActionSchema,
  kessenDeckSourceSchema,
} from "@/validators/kessen";
import {
  type QuestChallengeRequest,
  questChallengeRequestSchema,
} from "@/validators/questChallenge";

const matchIdSchema = z.string().min(1).max(191);

/**
 * Kessen NPC matches. A turn is one read, the pure engine plus the AI's replies, and one
 * compare-and-set write on the match version; a finishing turn pays in the same request
 * after its status CAS.
 */
export const kessenRouter = createTRPCRouter({
  getCatalog: cdnCachedProcedure
    .meta({ mcp: { description: "Get the Kessen card catalog and card packs" } })
    .query(async ({ ctx }): Promise<KessenCatalog> => {
      const [cardRows, packRows] = await Promise.all([
        listKessenCards(ctx.drizzle),
        listKessenPackItems(ctx.drizzle),
      ]);
      return buildCatalog(cardRows, packRows);
    }),

  getHub: protectedProcedure
    .meta({
      mcp: { description: "Get the player's Kessen progress, decks and Circuit" },
    })
    .input(z.object({}).nullish())
    .query(async ({ ctx }): Promise<KessenHub> => {
      const userId = ctx.userId;
      const [
        progressRows,
        npcRows,
        ownedRows,
        packs,
        decks,
        active,
        playerRows,
        choices,
      ] = await Promise.all([
        findKessenProgress(ctx.drizzle, userId),
        findKessenNpcProgressRows(ctx.drizzle, userId),
        listOwnedKessenCardCounts(ctx.drizzle, userId),
        listKessenPackStacks(ctx.drizzle, userId),
        listKessenDecks(ctx.drizzle, userId),
        listActiveKessenMatches(ctx.drizzle, userId),
        findKessenPlayer(ctx.drizzle, userId),
        listKessenFirstWinChoices(ctx.drizzle, userId),
      ]);
      const counts = ownedCardCounts(ownedRows);
      return buildHub({
        now: new Date(),
        progress: progressRows[0] ?? null,
        npcRows,
        owned: counts.free,
        listed: counts.listed,
        packs,
        decks,
        active,
        choices,
        player: playerRows[0] ?? null,
      });
    }),

  getMatch: protectedProcedure
    .meta({ mcp: { description: "Get one of the player's Kessen matches" } })
    .input(z.object({ matchId: matchIdSchema }))
    .query(async ({ ctx, input }): Promise<KessenMatchQuery> => {
      const [found] = await findKessenMatch(ctx.drizzle, ctx.userId, input.matchId);
      if (!found) return { match: null };
      // A finishing request that ended before its payout was settled is finished here.
      const { row } = await resumeKessenSettlement(ctx.drizzle, found);
      return { match: toPayload(row) };
    }),

  /**
   * Start a Circuit match, or a quest challenge match for an active
   * `win_kessen_challenge` objective whose location the caller stands on. A challenge
   * takes its opponent and AI tier from the objective, never from the request, plays the
   * opponent's signature deck and needs no Circuit unlock.
   */
  startMatch: protectedProcedure
    .meta({ mcp: { description: "Start a Kessen match against a Circuit NPC" } })
    .input(
      z.object({
        npcKey: z.enum(KessenNpcKeys),
        mode: z.enum(KESSEN_CIRCUIT_MODES),
        deck: kessenDeckSourceSchema,
        replaceActive: z.boolean().optional(),
        challenge: questChallengeRequestSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<KessenStartResult> => {
      const userId = ctx.userId;
      const now = new Date();
      const dayKey = getUtcDayKey(now);
      const deckId = input.deck.source === "loaner" ? null : input.deck.deckId;
      const [
        catalogRows,
        anyActive,
        progressRows,
        npcRows,
        ownedRows,
        deckRows,
        playerRows,
        questUser,
      ] = await Promise.all([
        listKessenCards(ctx.drizzle),
        listActiveKessenMatchesForPlayers(ctx.drizzle, [userId]),
        findKessenProgress(ctx.drizzle, userId),
        findKessenNpcProgressRows(ctx.drizzle, userId),
        listOwnedKessenCardCounts(ctx.drizzle, userId),
        deckId ? findKessenDeck(ctx.drizzle, userId, deckId) : Promise.resolve([]),
        findKessenPlayer(ctx.drizzle, userId),
        input.challenge
          ? fetchUpdatedUser({
              client: ctx.drizzle,
              userId,
              rejectIsolatedPyramid: true,
            })
          : undefined,
      ]);
      const quest = input.challenge
        ? findTableChallenge(questUser?.user, input.challenge)
        : null;
      if (quest && "message" in quest) return errorResponse(quest.message);
      const mode = quest ? "standard" : input.mode;
      const npc = kessenNpc(quest?.npcKey ?? input.npcKey) as KessenNpc;
      const progress = progressRows[0] ?? null;
      const player = playerRows[0] ?? null;
      const home = homeFaction(
        player?.villageName,
        player?.isOutlaw ?? false,
        progress?.starterFaction,
      );
      const lock = quest
        ? null
        : npcLockReason(npc, mode, circuitProgress(progress, npcRows, home));
      if (lock) return errorResponse(lock);
      const active = anyActive.filter((entry) => entry.kind === "NPC");
      const busy = activeMatchRejection(anyActive, active, input.replaceActive);
      if (busy) return busy;

      const pool = snapshotCatalog(kessenCatalogCards(catalogRows));
      const variant = npcVariant(npc, mode);
      if (!variant) return errorResponse("This opponent has no such match.");
      const deck = buildPlayerDeck({
        source: input.deck,
        deckRow: deckRows[0] ?? null,
        userId,
        dayKey,
        pool,
        owned: ownedCardCounts(ownedRows).free,
      });
      if ("error" in deck) return errorResponse(deck.error);
      const aiDeck = expandDeckCards(variant.deck.cards);
      const setup = {
        seed: nanoid(),
        seats: [
          { leaderId: deck.leaderId, deck: expandDeckCards(deck.cards) },
          { leaderId: variant.deck.leaderId, deck: aiDeck },
        ] as [SeatSetup, SeatSetup],
        rules: variant.rules,
        cards: pool,
      };
      // An NPC deck can name a card staff removed from the catalog.
      if (matchInputProblem(setup))
        return errorResponse("This opponent's cards are not available right now.");

      const engine = createMatch(setup);
      return openNpcMatch(ctx.drizzle, {
        userId,
        npc,
        tier: quest?.tier ?? tierOfMode(npc, mode),
        deckId,
        now,
        active,
        progressMissing: !progress,
        opening: {
          engine,
          mode,
          lesson: null,
          challenge: quest ? input.challenge : null,
          pool: npcMatchPool(
            npc,
            mode,
            engine.seats.map((seat) => seat.faction),
            pool,
          ),
          aiDeck,
          borrowed: [...new Set(deck.borrowed.map((entry) => entry.itemId))].sort(),
          plays: [0, 0],
          result: null,
        },
      });
    }),

  startLesson: protectedProcedure
    .meta({ mcp: { description: "Start a Kessen Academy lesson at Lemu's table" } })
    .input(
      z.object({
        lessonKey: z.enum(KESSEN_ACADEMY_LESSON_KEYS),
        replaceActive: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<KessenStartResult> => {
      const userId = ctx.userId;
      const now = new Date();
      const [catalogRows, anyActive, progressRows] = await Promise.all([
        listKessenCards(ctx.drizzle),
        listActiveKessenMatchesForPlayers(ctx.drizzle, [userId]),
        findKessenProgress(ctx.drizzle, userId),
      ]);
      const progress = progressRows[0] ?? null;
      const lock = academyLessonLockReason(
        input.lessonKey,
        academyLessonsCompleted(progress?.academy),
      );
      if (lock) return errorResponse(lock);
      const active = anyActive.filter((entry) => entry.kind === "NPC");
      const busy = activeMatchRejection(anyActive, active, input.replaceActive);
      if (busy) return busy;
      const start = academyLessonStart(
        input.lessonKey,
        snapshotCatalog(kessenCatalogCards(catalogRows)),
      );
      // A lesson whose cards staff removed or changed so its taught line fails stays shut.
      if ("error" in start)
        return errorResponse("This lesson is not available right now.");
      const npc = kessenNpc(KESSEN_ACADEMY_NPC) as KessenNpc;
      return openNpcMatch(ctx.drizzle, {
        userId,
        npc,
        tier: tierOfMode(npc, "lesson"),
        deckId: null,
        now,
        active,
        progressMissing: !progress,
        opening: {
          engine: start.state,
          mode: "lesson",
          lesson: input.lessonKey,
          // The lesson's own cards: Lemu follows a script, so it needs no card pool.
          pool: Object.values(start.state.cards),
          aiDeck: [],
          borrowed: [],
          plays: [0, 0],
          result: null,
        },
      });
    }),

  playTurn: protectedProcedure
    .meta({ mcp: { description: "Play one Kessen decision; the NPC replies" } })
    .input(
      z.object({
        matchId: matchIdSchema,
        version: z.number().int().min(1),
        action: kessenActionSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId;
      const now = new Date();
      const [row] = await findKessenMatch(ctx.drizzle, userId, input.matchId);
      const rejected = await rejectTurn(ctx.drizzle, row, input.version, now);
      if (rejected) return { ...rejected, events: [] as KessenEvent[] };
      const match = row as KessenMatch;
      const stored = storedOf(match);
      const npc = kessenNpc(match.npcKey ?? "") as KessenNpc;
      const tier = match.tier as KessenTier;

      if (!actingSeats(stored.engine).includes(0)) {
        return {
          ...errorResponse("It is not your turn."),
          match: toPayload(match),
          events: [] as KessenEvent[],
        };
      }
      const human = applyAction(stored.engine, 0, input.action);
      if (!human.ok) {
        return {
          ...errorResponse(human.reason),
          match: toPayload(match),
          events: [] as KessenEvent[],
        };
      }
      const ai = runNpcReplies({ ...stored, engine: human.state }, npc, tier);
      const events = [...human.events, ...ai.events];
      const redacted = redactEvents(events, 0);
      const next: KessenStoredMatch = {
        ...stored,
        engine: ai.engine,
        plays: addPlays(stored.plays, events),
      };

      if (ai.engine.phase !== "over") {
        const write = await updateKessenMatchForTurn(ctx.drizzle, match, {
          state: next,
          now,
        });
        if (write.rowsAffected !== 1) return staleTurn(ctx.drizzle, userId, match.id);
        return {
          success: true,
          message: "",
          match: toPayload({
            ...match,
            version: match.version + 1,
            state: asJson(next),
          }),
          events: redacted,
        };
      }

      // The match ended through play: read what the payout needs, then claim the match.
      // A quest challenge win records its objective first, while the match is still
      // ACTIVE at this version, so a failed recording leaves the turn unplayed and the
      // player plays it again in full.
      const winner = ai.engine.result?.winner ?? null;
      const challenge = stored.challenge ?? null;
      const objectivePossible = winner === 0 && stored.mode !== "lesson" && !challenge;
      const [progressRows, npcRows, ownedRows, questUser, questState, recorded] =
        await Promise.all([
          findKessenProgress(ctx.drizzle, userId),
          findKessenNpcProgressRows(ctx.drizzle, userId, npc.key),
          listOwnedKessenCardCounts(ctx.drizzle, userId),
          objectivePossible ? fetchUser(ctx.drizzle, userId) : null,
          objectivePossible ? fetchQuestTrackerState(ctx.drizzle, userId) : null,
          challenge && winner === 0
            ? recordQuestChallengeWin({
                client: ctx.drizzle,
                userId,
                challenge,
                task: "win_kessen_challenge",
                runIsActive: kessenMatchIsActive(ctx.drizzle, {
                  id: match.id,
                  userId,
                  version: match.version,
                }),
              })
            : null,
        ]);
      if (recorded && !recorded.ok) {
        return {
          ...errorResponse(recorded.message),
          match: toPayload(match),
          events: [] as KessenEvent[],
        };
      }
      const plan = planKessenFinish({
        dropSeed: match.seed,
        npc,
        tier,
        stored: next,
        startedAt: match.startedAt,
        now,
        progress: progressRows[0] ?? null,
        npcProgress: npcRows[0] ?? null,
        owned: ownedCardCounts(ownedRows).all,
      });
      // The status CAS stores a result that pays nothing plus the plan; the settled
      // result replaces both once the claims ran, and `resumeKessenSettlement` finishes
      // a match whose request ends in between.
      const finished: KessenStoredMatch = {
        ...next,
        result: unsettledKessenResult(plan),
        settlement: plan,
      };
      const claim = await updateKessenMatchForTurn(ctx.drizzle, match, {
        state: finished,
        now,
        status: "FINISHED",
        rewarded: false,
      });
      if (claim.rowsAffected !== 1) return staleTurn(ctx.drizzle, userId, match.id);

      const settled = await settleKessenPayout({
        client: ctx.drizzle,
        userId,
        match: {
          id: match.id,
          npcKey: npc.key,
          version: match.version + 1,
          finishedAt: now,
        },
        state: finished,
        plan,
        questData: kessenObjectiveTrackers(
          kessenTrackerUser(questUser, questState),
          plan.objective,
        ),
        now,
      });
      if (!settled) return staleTurn(ctx.drizzle, userId, match.id);
      const completedFor = recorded?.ok ? recorded.completedFor : undefined;
      return {
        success: true,
        message: challenge
          ? challengeResultMessage(winner, !!completedFor)
          : resultMessage(settled.result),
        match: toPayload({
          ...match,
          status: "FINISHED",
          rewarded: settled.result.rewarded,
          version: settled.version,
          state: asJson(settled.state),
          finishedAt: now,
        }),
        events: redacted,
        granted: settled.grants,
        ...(challenge
          ? getQuestChallengeUserUpdate(
              completedFor,
              recorded?.ok ? recorded.battle : undefined,
            )
          : getKessenPayoutUserUpdate(settled.ryo)),
      };
    }),

  concede: protectedProcedure
    .meta({ mcp: { description: "Concede a Kessen match without a reward" } })
    .input(z.object({ matchId: matchIdSchema, version: z.number().int().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const [row] = await findKessenMatch(ctx.drizzle, ctx.userId, input.matchId);
      const rejected = await rejectTurn(ctx.drizzle, row, input.version, now);
      if (rejected) return rejected;
      const match = row as KessenMatch;
      const conceded: KessenStoredMatch = {
        ...storedOf(match),
        result: { ...UNREWARDED_RESULT, winner: 1, reason: CONCEDED_REASON },
      };
      const write = await updateKessenMatchForTurn(ctx.drizzle, match, {
        state: conceded,
        now,
        status: "CONCEDED",
        rewarded: false,
      });
      if (write.rowsAffected !== 1) return staleTurn(ctx.drizzle, ctx.userId, match.id);
      return {
        success: true,
        message: "You conceded the match.",
        match: toPayload({
          ...match,
          status: "CONCEDED",
          version: match.version + 1,
          state: asJson(conceded),
          finishedAt: now,
        }),
      };
    }),

  claimFirstWinChoice: protectedProcedure
    .meta({ mcp: { description: "Pick the card a Kessen first win lets you choose" } })
    .input(z.object({ matchId: matchIdSchema, itemId: z.string().min(1).max(191) }))
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const [found] = await findKessenMatch(ctx.drizzle, ctx.userId, input.matchId);
      if (!found) return errorResponse("Match not found.");
      const { row } = await resumeKessenSettlement(ctx.drizzle, found);
      const stored = storedOf(row);
      const choice = stored.result?.firstWin?.choice;
      if (
        row.status !== "FINISHED" ||
        !stored.result?.firstWin ||
        (choice?.kind !== "items" && choice?.kind !== "unownedLegendary")
      ) {
        return errorResponse("This match has no reward to choose.");
      }
      if (choice.claimed !== null)
        return errorResponse("You already chose this reward.");
      if (!choice.options.includes(input.itemId)) {
        return errorResponse("That card is not one of the choices.");
      }
      const result: KessenMatchResult = {
        ...stored.result,
        firstWin: {
          ...stored.result.firstWin,
          choice: { ...choice, claimed: input.itemId },
        },
      };
      const state: KessenStoredMatch = { ...stored, result };
      const write = await updateKessenMatchResult(ctx.drizzle, row, {
        state,
        rewarded: row.rewarded,
        now,
      });
      if (write.rowsAffected !== 1)
        return errorResponse("You already chose this reward.");
      const granted = [{ itemId: input.itemId, quantity: 1 }];
      await grantUserItems(ctx.drizzle, ctx.userId, granted);
      return {
        success: true,
        message: "Reward claimed.",
        match: toPayload({ ...row, version: row.version + 1, state: asJson(state) }),
        granted,
      };
    }),
});

const STARTING_MESSAGE = "Another match is starting; try again in a moment.";

/** A rejected start; the ids name the match that blocks it. */
type KessenStartFailure = {
  success: false;
  message: string;
  activeMatchId?: string;
  activeDuelId?: string;
};
type KessenStartResult =
  | KessenStartFailure
  | { success: true; message: string; match: KessenMatchPayload };
const CONCEDED_REASON = "Conceded matches pay no reward.";

const UNREWARDED_RESULT: KessenMatchResult = {
  winner: null,
  rewarded: false,
  reason: null,
  ryo: 0,
  drops: [],
  firstWin: null,
  weeklyFirstWinPack: false,
  lessonCompleted: false,
  academy: null,
};

/**
 * Why the player cannot start another NPC match: a duel in progress is never replaced
 * (conceding it would hand the opponent a win), and an active NPC match is replaced only
 * on request. Null when the start may go ahead.
 */
const activeMatchRejection = (
  anyActive: Awaited<ReturnType<typeof listActiveKessenMatchesForPlayers>>,
  active: readonly { id: string }[],
  replaceActive: boolean | undefined,
): KessenStartFailure | null => {
  const duel = anyActive.find((entry) => entry.kind !== "NPC");
  if (duel) {
    return {
      ...errorResponse("Finish or concede your Kessen duel first."),
      activeDuelId: duel.id,
    };
  }
  if (active.length > 0 && !replaceActive) {
    return {
      ...errorResponse("Finish or concede your current Kessen match first."),
      activeMatchId: active[0]?.id,
    };
  }
  return null;
};

/**
 * Stores a new NPC or lesson match after the NPC's opening replies, conceding the
 * active NPC matches it replaces.
 */
const openNpcMatch = async (
  client: DrizzleClient,
  input: {
    userId: string;
    npc: KessenNpc;
    tier: KessenTier;
    deckId: string | null;
    now: Date;
    active: readonly { id: string }[];
    progressMissing: boolean;
    opening: KessenStoredMatch;
  },
): Promise<KessenStartResult> => {
  const { userId, opening, now, active } = input;
  const ai = runNpcReplies(opening, input.npc, input.tier);
  const stored: KessenStoredMatch = {
    ...opening,
    engine: ai.engine,
    plays: addPlays(opening.plays, ai.events),
  };
  const row: KessenMatch = {
    id: nanoid(),
    kind: "NPC",
    userId,
    opponentId: null,
    npcKey: input.npc.key,
    tier: input.tier,
    deckId: input.deckId,
    status: "ACTIVE",
    version: 1,
    engineVersion: CARD_ENGINE_VERSION,
    seed: opening.engine.seed,
    state: stored as unknown as Record<string, unknown>,
    rewarded: false,
    rated: false,
    turnDeadline: null,
    startedAt: now,
    updatedAt: now,
    finishedAt: null,
  };
  await Promise.all([
    insertKessenMatch(client, { ...row, state: stored }),
    active.length > 0
      ? updateKessenMatchesForConcede(
          client,
          userId,
          active.map((entry) => entry.id),
          now,
        )
      : null,
    input.progressMissing ? insertKessenProgressIfMissing(client, userId) : null,
  ]);
  // One ACTIVE match per player, NPC or duel. A concurrent start is invisible to the
  // reads above, so the check repeats after the insert: whichever start then sees
  // another ACTIVE match concedes its own. Two starts that see each other both
  // concede and the player starts again; two matches never both stay ACTIVE.
  const after = await listActiveKessenMatchesForPlayers(client, [userId]);
  if (after.some((entry) => entry.id !== row.id)) {
    await updateKessenMatchesForConcede(client, userId, [row.id], now);
    return errorResponse(STARTING_MESSAGE);
  }
  return {
    success: true,
    message: stored.mode === "lesson" ? "Lesson started." : "Match started.",
    match: toPayload(row),
  };
};

/**
 * Rejections shared by turns and concessions: a missing or ended match, retired rules
 * (the match expires unrewarded) and a stale version (the fresh match is returned).
 */
const rejectTurn = async (
  client: DrizzleClient,
  row: KessenMatch | undefined,
  version: number,
  now: Date,
) => {
  if (!row) return errorResponse("Match not found.");
  if (row.status !== "ACTIVE") {
    const { row: current } = await resumeKessenSettlement(client, row);
    return { ...errorResponse("This match is over."), match: toPayload(current) };
  }
  if (row.engineVersion !== CARD_ENGINE_VERSION) {
    const write = await updateKessenMatchForExpiry(client, row, now);
    if (write.rowsAffected !== 1) return staleTurn(client, row.userId, row.id);
    return {
      ...errorResponse(
        "The Kessen rules changed since this match began, so it ended without a reward.",
      ),
      match: toPayload({
        ...row,
        status: "EXPIRED",
        version: row.version + 1,
        finishedAt: now,
      }),
    };
  }
  if (row.version !== version) {
    return {
      ...errorResponse(
        "This match moved on in another window; showing the latest turn.",
      ),
      match: toPayload(row),
    };
  }
  return null;
};

/** A lost version CAS: the fresh match, so the client reconciles. */
const staleTurn = async (client: DrizzleClient, userId: string, matchId: string) => {
  const [fresh] = await findKessenMatch(client, userId, matchId);
  return {
    ...errorResponse("This match moved on in another window; showing the latest turn."),
    match: fresh ? toPayload(fresh) : undefined,
    events: [] as KessenEvent[],
  };
};

/** The player's view of a match row. */
const toPayload = (row: KessenMatch): KessenMatchPayload => {
  const stored = storedOf(row);
  const retired = row.status === "ACTIVE" && row.engineVersion !== CARD_ENGINE_VERSION;
  return {
    id: row.id,
    version: row.version,
    status: retired ? "EXPIRED" : row.status,
    npcKey: row.npcKey as KessenNpcKey,
    mode: stored.mode,
    lesson: stored.lesson ?? null,
    tier: row.tier as KessenTier,
    startedAt: row.startedAt,
    challenge: stored.challenge ?? null,
    view: viewFor(stored.engine, 0),
    borrowed: stored.borrowed ?? [],
    result: stored.result ?? null,
  };
};

const storedOf = (row: Pick<KessenMatch, "state">) =>
  row.state as unknown as KessenStoredMatch;

const asJson = (stored: KessenStoredMatch) =>
  stored as unknown as Record<string, unknown>;

const addPlays = (
  plays: [number, number],
  events: readonly KessenEvent[],
): [number, number] => {
  const added = countPlays(events);
  return [plays[0] + added[0], plays[1] + added[1]];
};

const resultMessage = (result: KessenMatchResult) => {
  const outcome =
    result.winner === 0 ? "You won!" : result.winner === 1 ? "You lost." : "A draw.";
  if (result.lessonCompleted)
    return result.ryo > 0
      ? `${outcome} Lesson complete: +${result.ryo} ryo.`
      : `${outcome} Lesson complete.`;
  if (result.academy) return outcome;
  if (!result.rewarded) return result.reason ? `${outcome} ${result.reason}` : outcome;
  return result.ryo > 0 ? `${outcome} +${result.ryo} ryo.` : outcome;
};

/** The outcome of a quest challenge match, pointing on to the logbook or another try. */
const challengeResultMessage = (winner: number | null, objectiveDone: boolean) =>
  winner !== 0
    ? `${winner === 1 ? "You lost." : "A draw."} Take your seat again when you are ready.`
    : objectiveDone
      ? "You won! Continue the quest in your logbook."
      : "You won, but this quest objective is no longer open.";

/**
 * The opponent and AI tier of an active `win_kessen_challenge` objective the player
 * stands on, or why its match cannot start. The objective's location is the one rolled
 * for this player.
 */
const findTableChallenge = (
  user: UserWithRelations | undefined,
  request: QuestChallengeRequest,
): { npcKey: KessenNpcKey; tier: KessenTier } | { message: string } => {
  if (!user) return { message: "User not found." };
  const found = findQuestChallenge(user, request, "win_kessen_challenge");
  if (!found || found.done || !found.available)
    return { message: "This duel is not an open objective of your active quests." };
  const { objective } = found;
  if (!found.atLocation)
    return {
      message: objective.hideLocation
        ? "You are not at this position."
        : `Travel to sector ${objective.sector} at [${objective.longitude}, ${objective.latitude}] to take your seat there.`,
    };
  return { npcKey: objective.npcKey, tier: objective.tier };
};

const circuitProgress = (
  progress: KessenProgress | null,
  npcRows: readonly KessenNpcProgress[],
  home: KessenCircuitProgress["homeFaction"],
): KessenCircuitProgress => ({
  lessonCompleted: finishedFirstLesson(progress?.academy),
  beaten: npcRows.filter((row) => row.firstWinAt).map((row) => row.npcKey),
  ascendedBeaten: npcRows
    .filter((row) => row.ascendedFirstWinAt)
    .map((row) => row.npcKey),
  homeFaction: home,
});

const FACTION_ORDER = [...KESSEN_DECK_FACTIONS, "NEUTRAL"] as const;

/** The public catalog: engine cards with display fields, numbered for the collection book. */
const buildCatalog = (
  cardRows: Awaited<ReturnType<typeof listKessenCards>>,
  packRows: Awaited<ReturnType<typeof listKessenPackItems>>,
): KessenCatalog => {
  const cards = kessenCatalogCards(cardRows);
  const display = new Map(cardRows.map((row) => [row.id, row]));
  const numbered = cards
    .filter(
      (card) =>
        card.isCollectible && card.kind !== "LEADER" && card.variant === "STANDARD",
    )
    .sort(
      (a, b) =>
        FACTION_ORDER.indexOf(a.faction) - FACTION_ORDER.indexOf(b.faction) ||
        KESSEN_RARITY_ORDER.indexOf(a.rarity) - KESSEN_RARITY_ORDER.indexOf(b.rarity) ||
        a.name.localeCompare(b.name),
    );
  const numbers = new Map(numbered.map((card, index) => [card.id, index + 1]));
  const entries: KessenCatalogEntry[] = cards
    .map((card) => {
      const row = display.get(card.id);
      const data = row?.cardData;
      return {
        ...card,
        image: row?.image ?? "",
        artUrl: data?.artUrl ?? "",
        focalX: data?.focalX ?? 50,
        focalY: data?.focalY ?? 35,
        flavor: data?.flavor ?? "",
        abilityName:
          card.kind === "LEADER" ? leaderAbilityName(row?.description ?? "") : null,
        number: numbers.get(card.id) ?? null,
      };
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const byId = new Map(cards.map((card) => [card.id, card]));
  const packs: KessenPackEntry[] = packRows
    .map((row) => ({
      id: row.id,
      name: row.name,
      image: row.image,
      description: row.description,
      odds: kessenPackOdds(row.effects, byId),
      slots: kessenPackSlots(row.effects),
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { fingerprint: catalogFingerprint(cards), cards: entries, packs };
};

/**
 * A leader's ability title. Leader descriptions read "<title>: <ability text>", so the
 * title is the text before the first colon; null when the description has no title.
 */
const leaderAbilityName = (description: string) => {
  const title = /^([^:\n]{1,40}):\s/.exec(description)?.[1]?.trim();
  return title ? title : null;
};

const titleCase = (value: string) => value.charAt(0) + value.slice(1).toLowerCase();

/** The Card Hall lobby from one snapshot of the player's Kessen rows; never writes. */
const buildHub = (input: {
  now: Date;
  progress: KessenProgress | null;
  npcRows: readonly KessenNpcProgress[];
  owned: Record<string, number>;
  listed: Record<string, number>;
  packs: KessenHub["packs"];
  decks: KessenHub["decks"];
  active: Awaited<ReturnType<typeof listActiveKessenMatches>>;
  choices: Awaited<ReturnType<typeof listKessenFirstWinChoices>>;
  player: Awaited<ReturnType<typeof findKessenPlayer>>[number] | null;
}): KessenHub => {
  const { progress } = input;
  const dayKey = getUtcDayKey(input.now);
  const weekKey = getUtcDayKey(periodStart("weekly", input.now));
  const home = homeFaction(
    input.player?.villageName,
    input.player?.isOutlaw ?? false,
    progress?.starterFaction,
  );
  const circuit = circuitProgress(progress, input.npcRows, home);
  const lessonsDone = academyLessonsCompleted(progress?.academy);
  const byNpc = new Map(input.npcRows.map((row) => [row.npcKey, row]));
  const sameDay = progress?.dayKey === dayKey;
  const entries: KessenCircuitEntry[] = KESSEN_NPCS.map((npc) => {
    const record = byNpc.get(npc.key);
    return {
      key: npc.key,
      name: npc.name,
      title: npc.title,
      location:
        npc.key === "momo"
          ? `${titleCase(momoFaction(dayKey))} teahouse`
          : npc.location,
      image: npc.image,
      faction: npc.faction,
      boss: npc.boss,
      champion: npc.champion,
      tier: npc.standard.tier,
      ascendedTier: npc.ascended?.tier ?? null,
      lockReason: npcLockReason(npc, "standard", circuit),
      ascendedLockReason: npc.ascended ? npcLockReason(npc, "ascended", circuit) : null,
      wins: record?.wins ?? 0,
      firstWinAt: record?.firstWinAt ?? null,
      ascendedFirstWinAt: record?.ascendedFirstWinAt ?? null,
      firstWinPreview: record?.firstWinAt
        ? []
        : npc.standard.firstWin.items.map((entry) => entry.itemId),
      houseRule: npc.standard.houseRule ?? npc.ascended?.houseRule ?? null,
      teaches: [...npc.teaches],
      recommendedLesson: academyLessonFor(npc.teaches, lessonsDone),
    };
  });
  const active = input.active[0];
  const lessonCompleted = finishedFirstLesson(progress?.academy);
  return {
    progress: {
      lessonCompleted,
      starterGranted: progress?.starterGranted ?? false,
      starterFaction:
        KESSEN_DECK_FACTIONS.find((faction) => faction === progress?.starterFaction) ??
        null,
      seenKeywords: progress?.seenKeywords ?? [],
    },
    owned: input.owned,
    listed: input.listed,
    packs: input.packs,
    decks: input.decks,
    circuit: entries,
    today: {
      rewarded: sameDay ? (progress?.rewardedToday ?? 0) : 0,
      rewardedCap: KESSEN_DAILY_REWARDED_MATCHES,
      drops: sameDay ? (progress?.dropsToday ?? 0) : 0,
      dropsCap: KESSEN_DAILY_DROP_ROLLS,
    },
    week: {
      firstWinPack: weeklyWinsFor(progress ?? null, weekKey) === 0,
    },
    activeMatch: active
      ? {
          id: active.id,
          npcKey: active.npcKey as KessenNpcKey,
          mode: (active.mode ?? "standard") as KessenMode,
          lesson: isAcademyLessonKey(active.lesson) ? active.lesson : null,
          challenge:
            active.challengeQuestId && active.challengeObjectiveId
              ? {
                  questId: active.challengeQuestId,
                  objectiveId: active.challengeObjectiveId,
                }
              : null,
          ...matchStanding(active.standing),
        }
      : null,
    pendingPicks: input.choices
      .filter(
        (row) =>
          (row.kind === "items" || row.kind === "unownedLegendary") &&
          (row.options ?? 0) > 0 &&
          row.claimedType === "NULL",
      )
      .map((row) => ({ matchId: row.id, npcKey: row.npcKey as KessenNpcKey })),
    academy: academyProgress(progress?.academy, progress?.academyGraduatedMatchId),
    homeFaction: home,
    loanerFaction: loanerFaction(home, dayKey),
    needsLesson: !lessonCompleted,
    needsStarter: lessonCompleted && !(progress?.starterGranted ?? false),
    pity: kessenPityCountdown({
      packsSinceEpic: progress?.packsSinceEpic ?? 0,
      packsSinceLegendary: progress?.packsSinceLegendary ?? 0,
    }),
    autoSellSurplus: progress?.autoSellSurplus ?? false,
  };
};

/**
 * Where an active match stands, from the engine fields `listActiveKessenMatches` reads:
 * the round, rounds won by each side and whether the player acts next (their pending
 * mulligan, else their turn). Missing fields read as the opening of Round 1.
 */
const matchStanding = (
  text: string | null,
): Pick<NonNullable<KessenHub["activeMatch"]>, "round" | "roundWins" | "yourTurn"> => {
  const fields = parseJsonFields(text);
  const winners = Array.isArray(fields.winners) ? fields.winners : [];
  return {
    round: typeof fields.round === "number" ? fields.round : 1,
    roundWins: [
      winners.filter((winner) => winner === 0).length,
      winners.filter((winner) => winner === 1).length,
    ],
    yourTurn: fields.phase === "mulligan" ? fields.mull != null : fields.turn === 0,
  };
};
