/**
 * How an NPC plays its side of a Kessen match: the tier a match mode plays at and the
 * NPC's replies until the player must act. The server's matches and the guest table in
 * the browser both run these, so a guest meets the same opponent a player does.
 */
import type { KessenTier } from "@/drizzle/constants";
import {
  academyNpcAction,
  KESSEN_ACADEMY_FIRST_LESSON,
  KESSEN_ACADEMY_TIER,
  type KessenAcademyLessonKey,
} from "./academy";
import { aiRng, decide } from "./ai";
import { actingSeats, applyAction, viewFor } from "./engine";
import {
  type KessenNpc,
  type KessenNpcMode,
  kessenNpcAiProfile,
  npcVariant,
} from "./npcs";
import type { KessenCard, KessenEvent, MatchState } from "./types";

/** The tier an NPC mode plays at; Academy lessons play at the Academy's. */
export const tierOfMode = (npc: KessenNpc, mode: KessenNpcMode): KessenTier =>
  mode === "lesson"
    ? KESSEN_ACADEMY_TIER
    : (npcVariant(npc, mode)?.tier ?? npc.standard.tier);

/** What the NPC's replies read from a match. */
export interface KessenNpcTable {
  engine: MatchState;
  mode: KessenNpcMode;
  /** The Academy lesson of a lesson match; null for every other match. */
  lesson: KessenAcademyLessonKey | null;
  /** The public card pool the AI reasons about the player's deck from. */
  pool: readonly KessenCard[];
  /** The NPC's own deck list, one card id per copy. */
  aiDeck: readonly string[];
}

/**
 * The NPC's replies (seat 1) until the player must act or the match ends. The AI decides
 * from its own redacted view and a stream keyed by the match step, so a match replays
 * identically from its seed; an Academy lesson follows Lemu's script. An action the
 * engine refuses falls back to keeping the hand or passing.
 */
export const runNpcReplies = (
  table: KessenNpcTable,
  npc: KessenNpc,
  tier: KessenTier,
): { engine: MatchState; events: KessenEvent[] } => {
  const profile = kessenNpcAiProfile(npc, tier);
  let engine = table.engine;
  const events: KessenEvent[] = [];
  for (let n = 0; n < MAX_NPC_ACTIONS && actingSeats(engine).includes(1); n++) {
    const view = viewFor(engine, 1);
    const action =
      table.mode === "lesson"
        ? academyNpcAction(table.lesson ?? KESSEN_ACADEMY_FIRST_LESSON, view)
        : decide(view, 1, profile, aiRng(engine.seed, 1, engine.step), {
            pool: table.pool,
            deck: table.aiDeck,
          });
    let applied = applyAction(engine, 1, action);
    if (!applied.ok) {
      applied = applyAction(
        engine,
        1,
        view.phase === "mulligan" ? { t: "mull", cards: [] } : { t: "pass" },
      );
    }
    if (!applied.ok)
      throw new Error(`Kessen AI has no legal action: ${applied.reason}`);
    engine = applied.state;
    events.push(...applied.events);
  }
  return { engine, events };
};

/** NPC actions in one reply; a whole match takes far fewer. */
const MAX_NPC_ACTIONS = 200;
