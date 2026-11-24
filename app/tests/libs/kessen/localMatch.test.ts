import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { KessenTier } from "@/drizzle/constants";
import {
  academyAdvice,
  KESSEN_ACADEMY,
  KESSEN_ACADEMY_LESSON_KEYS,
} from "@/libs/kessen/academy";
import { aiRng, decide } from "@/libs/kessen/ai";
import { KESSEN_DECK_FACTIONS } from "@/libs/kessen/deck";
import { stateHash } from "@/libs/kessen/engine";
import {
  concedeLocalMatch,
  type LocalKessenMatch,
  type LocalMatchStep,
  playLocalTurn,
  startLocalLesson,
  startLocalNpcMatch,
} from "@/libs/kessen/localMatch";
import { KESSEN_NPCS, type KessenNpcKey } from "@/libs/kessen/npcs";
import { tierOfMode } from "@/libs/kessen/npcTurns";
import type { KessenAction, MatchView } from "@/libs/kessen/types";
import { KESSEN_SEED_CATALOG } from "./fixtures/catalog";

const NOW = new Date("2026-11-21T12:00:00Z");

// A guest match never leaves the browser: any network call fails the suite.
const realFetch = globalThis.fetch;
let fetchCalls = 0;
beforeAll(() => {
  globalThis.fetch = (() => {
    fetchCalls++;
    throw new Error("A guest match must not call the network");
  }) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

/** A fixed opponent for the guest's seat: the Genin AI from the player's view. */
const guestPolicy = (match: LocalKessenMatch, view: MatchView): KessenAction =>
  decide(
    view,
    0,
    { tier: "GENIN" },
    aiRng(match.table.engine.seed, 0, match.table.engine.step),
    { pool: match.table.pool },
  );

/** Plays a guest match to its end through the driver, as the table would. */
const playOut = (
  started: LocalMatchStep,
  policy: (match: LocalKessenMatch, view: MatchView) => KessenAction,
) => {
  let step = started;
  let turns = 0;
  for (; turns < 400 && step.match.status === "ACTIVE"; turns++) {
    const next = playLocalTurn(step.match, policy(step.match, step.payload.view));
    if (!next.ok) throw new Error(next.message);
    expect(next.payload.version).toBe(step.payload.version + 1);
    step = next;
  }
  return { step, turns };
};

const startNpc = (npcKey: KessenNpcKey, seed: string) => {
  const started = startLocalNpcMatch({
    npcKey,
    faction: "HYORIN",
    cards: KESSEN_SEED_CATALOG,
    seed,
    id: `guest-${npcKey}`,
    now: NOW,
  });
  if (!started.ok) throw new Error(started.message);
  return started;
};

/** One Circuit opponent per AI tier. */
const TIER_OPPONENTS: Record<KessenTier, KessenNpcKey> = {
  GENIN: "kazehiko",
  CHUNIN: "hisame",
  JONIN: "anbu-chief",
  KAGE: "shishi",
};

describe("guest Circuit matches", () => {
  for (const [tier, npcKey] of Object.entries(TIER_OPPONENTS)) {
    // Each case simulates two complete matches, including the deepest AI tier.
    it(`plays a ${tier} match against ${npcKey} to its end, the same way for one seed`, () => {
      const first = playOut(
        startNpc(npcKey as KessenNpcKey, "fixed-seed"),
        guestPolicy,
      );
      const again = playOut(
        startNpc(npcKey as KessenNpcKey, "fixed-seed"),
        guestPolicy,
      );
      const { payload } = first.step;
      expect(first.step.match.tier).toBe(tier as KessenTier);
      expect(payload.tier).toBe(tier as KessenTier);
      expect(payload.status).toBe("FINISHED");
      expect(payload.view.phase).toBe("over");
      expect(payload.view.result).not.toBeNull();
      // A guest match settles nothing: no result, so no rewards to show.
      expect(payload.result).toBeNull();
      expect(again.turns).toBe(first.turns);
      expect(stateHash(again.step.match.table.engine)).toBe(
        stateHash(first.step.match.table.engine),
      );
    }, 15_000);
  }

  it("plays every Circuit opponent at the tier its standard match has on the server", () => {
    for (const npc of KESSEN_NPCS) {
      const started = startNpc(npc.key, "tier-check");
      expect(started.payload.tier).toBe(tierOfMode(npc, "standard"));
      expect(started.payload.mode).toBe("standard");
      expect(started.payload.npcKey).toBe(npc.key);
    }
  });

  it("deals the day's loaner deck of the chosen faction", () => {
    for (const faction of KESSEN_DECK_FACTIONS) {
      const started = startLocalNpcMatch({
        npcKey: "kazehiko",
        faction,
        cards: KESSEN_SEED_CATALOG,
        seed: "faction-check",
        id: "guest-faction",
        now: NOW,
      });
      if (!started.ok) throw new Error(started.message);
      expect(started.payload.view.seats[0].faction).toBe(faction);
      expect(started.payload.borrowed.length).toBeGreaterThan(0);
    }
  });

  it("refuses an illegal decision and keeps the match as it was", () => {
    const started = startNpc("kazehiko", "refusal");
    const refused = playLocalTurn(started.match, {
      t: "play",
      card: "no-such-card",
      row: "CLOSE",
    } as KessenAction);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.message.length).toBeGreaterThan(0);
    expect(refused.payload?.version).toBe(started.payload.version);
  });

  it("concedes into a finished table that takes no further decisions", () => {
    const started = startNpc("kazehiko", "concede");
    const conceded = concedeLocalMatch(started.match);
    expect(conceded.payload.status).toBe("CONCEDED");
    expect(conceded.payload.version).toBe(started.payload.version + 1);
    const after = playLocalTurn(conceded.match, { t: "pass" });
    expect(after.ok).toBe(false);
  });
});

describe("guest Academy lessons", () => {
  for (const key of KESSEN_ACADEMY_LESSON_KEYS) {
    it(`lesson "${key}" follows Lemu's script and the coach's line to a win`, () => {
      const started = startLocalLesson({
        lessonKey: key,
        cards: KESSEN_SEED_CATALOG,
        id: `guest-lesson-${key}`,
        now: NOW,
      });
      if (!started.ok) throw new Error(started.message);
      expect(started.payload.mode).toBe("lesson");
      expect(started.payload.lesson).toBe(key);
      expect(started.payload.npcKey).toBe("lemu");
      const { step } = playOut(started, (_match, view) => {
        if (view.phase === "mulligan") return { t: "mull", cards: [] };
        const advice = academyAdvice(key, view);
        if (advice?.kind !== "move") throw new Error("The coach has no move");
        return advice.action;
      });
      expect(step.payload.status).toBe("FINISHED");
      expect(step.payload.view.result?.winner).toBe(0);
    });
  }

  it("covers all six lessons", () => {
    expect(KESSEN_ACADEMY.length).toBe(6);
  });
});

describe("network isolation", () => {
  it("made no network calls", () => {
    expect(fetchCalls).toBe(0);
  });
});
