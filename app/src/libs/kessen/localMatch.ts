/**
 * A Kessen match held entirely in the browser, for visitors without a character: a
 * Circuit NPC with today's loaner deck, or an Academy lesson at Lemu's table. It runs the
 * same engine, NPC tiers and lesson scripts as a server match and answers with the same
 * payload the match table renders, but nothing is stored, rewarded or sent anywhere.
 */
import type { KessenTier } from "@/drizzle/constants";
import { getUtcDayKey } from "@/utils/time";
import type { KessenMatchPayload } from "@/validators/kessen";
import {
  academyLessonStart,
  KESSEN_ACADEMY_NPC,
  type KessenAcademyLessonKey,
} from "./academy";
import { snapshotCatalog } from "./catalog";
import { type DeckFaction, expandDeckCards, loanerDeck } from "./deck";
import {
  actingSeats,
  applyAction,
  createMatch,
  matchInputProblem,
  redactEvents,
  viewFor,
} from "./engine";
import { type KessenNpc, type KessenNpcKey, kessenNpc, npcVariant } from "./npcs";
import { type KessenNpcTable, runNpcReplies, tierOfMode } from "./npcTurns";
import type { KessenAction, KessenCard, KessenEvent, SeatSetup } from "./types";

/** A match in the browser: the full engine state and what the payload names. */
export interface LocalKessenMatch {
  id: string;
  /** Counts the decisions applied, as the server's version does. */
  version: number;
  status: KessenMatchPayload["status"];
  npcKey: KessenNpcKey;
  tier: KessenTier;
  startedAt: Date;
  table: KessenNpcTable;
  /** The loaner's card ids, as a server match names borrowed cards. */
  borrowed: string[];
}

/** A started or advanced match, with the payload and the events seat 0 may see. */
export interface LocalMatchStep {
  ok: true;
  match: LocalKessenMatch;
  payload: KessenMatchPayload;
  events: KessenEvent[];
}

/** A decision or start the match refused, with the reason for display. */
export interface LocalMatchRefusal {
  ok: false;
  message: string;
  /** The unchanged match, when there is one. */
  payload?: KessenMatchPayload;
}

/**
 * A Circuit match against `npcKey` in its standard mode, played with today's loaner deck
 * of `faction` over `cards` (the public catalog). `seed` decides the shuffle and the
 * NPC's choices, so one seed always plays out the same way for the same decisions.
 */
export const startLocalNpcMatch = (input: {
  npcKey: KessenNpcKey;
  faction: DeckFaction;
  cards: Iterable<KessenCard>;
  seed: string;
  id: string;
  now?: Date;
}): LocalMatchStep | LocalMatchRefusal => {
  const npc = kessenNpc(input.npcKey);
  const variant = npc ? npcVariant(npc, "standard") : null;
  if (!npc || !variant) return refusal("This opponent has no such match.");
  const now = input.now ?? new Date();
  const pool = snapshotCatalog(input.cards);
  const deck = loanerDeck({
    userId: GUEST_ID,
    dayKey: getUtcDayKey(now),
    faction: input.faction,
    cards: pool,
  });
  const aiDeck = expandDeckCards(variant.deck.cards);
  const setup = {
    seed: input.seed,
    seats: [
      { leaderId: deck.leaderId, deck: expandDeckCards(deck.cards) },
      { leaderId: variant.deck.leaderId, deck: aiDeck },
    ] as [SeatSetup, SeatSetup],
    rules: variant.rules,
    cards: pool,
  };
  if (matchInputProblem(setup))
    return refusal("This opponent's cards are not available right now.");
  return openMatch({
    id: input.id,
    npc,
    now,
    borrowed: [...new Set(deck.cards.map((entry) => entry.itemId))].sort(),
    table: {
      engine: createMatch(setup),
      mode: "standard",
      lesson: null,
      pool,
      aiDeck,
    },
  });
};

/** An Academy lesson at Lemu's table over `cards` (the public catalog). */
export const startLocalLesson = (input: {
  lessonKey: KessenAcademyLessonKey;
  cards: Iterable<KessenCard>;
  id: string;
  now?: Date;
}): LocalMatchStep | LocalMatchRefusal => {
  const npc = kessenNpc(KESSEN_ACADEMY_NPC);
  const start = academyLessonStart(input.lessonKey, snapshotCatalog(input.cards));
  if (!npc || "error" in start)
    return refusal("This lesson is not available right now.");
  return openMatch({
    id: input.id,
    npc,
    now: input.now ?? new Date(),
    borrowed: [],
    table: {
      engine: start.state,
      mode: "lesson",
      lesson: input.lessonKey,
      // Lemu follows a script, so the lesson needs only its own cards.
      pool: Object.values(start.state.cards),
      aiDeck: [],
    },
  });
};

/** The player's decision, then the NPC's replies until the player acts again. */
export const playLocalTurn = (
  match: LocalKessenMatch,
  action: KessenAction,
): LocalMatchStep | LocalMatchRefusal => {
  if (match.status !== "ACTIVE")
    return refusal("This match is over.", localMatchPayload(match));
  if (!actingSeats(match.table.engine).includes(0))
    return refusal("It is not your turn.", localMatchPayload(match));
  const human = applyAction(match.table.engine, 0, action);
  if (!human.ok) return refusal(human.reason, localMatchPayload(match));
  const npc = kessenNpc(match.npcKey) as KessenNpc;
  const ai = runNpcReplies({ ...match.table, engine: human.state }, npc, match.tier);
  const next: LocalKessenMatch = {
    ...match,
    version: match.version + 1,
    status: ai.engine.phase === "over" ? "FINISHED" : "ACTIVE",
    table: { ...match.table, engine: ai.engine },
  };
  return {
    ok: true,
    match: next,
    payload: localMatchPayload(next),
    events: redactEvents([...human.events, ...ai.events], 0),
  };
};

/** Gives the match up; a guest match has nothing to forfeit but the table. */
export const concedeLocalMatch = (match: LocalKessenMatch): LocalMatchStep => {
  const next: LocalKessenMatch = {
    ...match,
    version: match.version + 1,
    status: match.status === "ACTIVE" ? "CONCEDED" : match.status,
  };
  return { ok: true, match: next, payload: localMatchPayload(next), events: [] };
};

/**
 * The match as the table renders it: seat 0's redacted view. A guest match settles no
 * result, so `result` stays null and the end screen reads the winner from the view.
 */
export const localMatchPayload = (match: LocalKessenMatch): KessenMatchPayload => ({
  id: match.id,
  version: match.version,
  status: match.status,
  npcKey: match.npcKey,
  mode: match.table.mode,
  lesson: match.table.lesson,
  tier: match.tier,
  startedAt: match.startedAt,
  view: viewFor(match.table.engine, 0),
  borrowed: match.borrowed,
  result: null,
});

/** The NPC's opening replies (its mulligan, or a lesson's first moves) before seat 0 acts. */
const openMatch = (input: {
  id: string;
  npc: KessenNpc;
  now: Date;
  borrowed: string[];
  table: KessenNpcTable;
}): LocalMatchStep => {
  const tier = tierOfMode(input.npc, input.table.mode);
  const ai = runNpcReplies(input.table, input.npc, tier);
  const match: LocalKessenMatch = {
    id: input.id,
    version: 1,
    status: ai.engine.phase === "over" ? "FINISHED" : "ACTIVE",
    npcKey: input.npc.key,
    tier,
    startedAt: input.now,
    table: { ...input.table, engine: ai.engine },
    borrowed: input.borrowed,
  };
  return { ok: true, match, payload: localMatchPayload(match), events: [] };
};

const refusal = (message: string, payload?: KessenMatchPayload): LocalMatchRefusal => ({
  ok: false,
  message,
  ...(payload ? { payload } : {}),
});

/** The loaner's seed owner for every guest: a guest's loaner is the day's for its faction. */
const GUEST_ID = "guest";
