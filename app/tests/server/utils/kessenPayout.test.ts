import { describe, expect, it } from "bun:test";
import {
  KESSEN_ACADEMY_GRADUATION_PACK_ID,
  KESSEN_ACADEMY_LESSON_RYO,
} from "@/drizzle/constants";
import type { KessenProgress } from "@/drizzle/schema";
import { academyTaughtLine, type KessenAcademyLessonKey } from "@/libs/kessen/academy";
import { snapshotCatalog } from "@/libs/kessen/catalog";
import { expandDeckCards } from "@/libs/kessen/deck";
import { createMatch } from "@/libs/kessen/engine";
import {
  type KessenNpc,
  kessenNpc,
  npcDropPool,
  npcForbiddenPool,
} from "@/libs/kessen/npcs";
import { copiesByName, rollNpcDrop, standardLegendaries } from "@/libs/kessen/rewards";
import { planKessenFinish, unsettledKessenResult } from "@/server/utils/kessenPayout";
import type { KessenStoredMatch } from "@/validators/kessen";
import { KESSEN_SEED_CATALOG } from "../../libs/kessen/fixtures/catalog";

const POOL = snapshotCatalog(KESSEN_SEED_CATALOG);
const SHISHI = kessenNpc("shishi") as KessenNpc;
const UNMEISHI = kessenNpc("unmeishi") as KessenNpc;
const NOW = new Date("2026-11-16T12:00:00.000Z");

/** A won Kage match against an NPC (Shishi by default) that passes every reward guard. */
const wonMatch = (npc: KessenNpc = SHISHI): KessenStoredMatch => {
  const deck = expandDeckCards(npc.standard.deck.cards);
  const engine = createMatch({
    seed: "payout",
    seats: [
      { leaderId: npc.standard.deck.leaderId, deck },
      { leaderId: npc.standard.deck.leaderId, deck },
    ],
    cards: POOL,
  });
  return {
    engine: { ...engine, phase: "over", result: { winner: 0 } },
    mode: "standard",
    lesson: null,
    pool: POOL,
    aiDeck: deck,
    borrowed: [],
    plays: [8, 8],
    log: [],
    result: null,
  };
};

const plan = (dropSeed: string) =>
  planKessenFinish({
    dropSeed,
    npc: SHISHI,
    tier: "KAGE",
    stored: wonMatch(),
    startedAt: new Date(NOW.getTime() - 10 * 60_000),
    now: NOW,
    progress: null,
    npcProgress: null,
    owned: {},
  });

/** A drop seed whose roll gives both a card and the Forbidden variant. */
const seedWithBothDrops = () => {
  for (let n = 0; n < 200_000; n++) {
    const roll = rollNpcDrop({
      seed: `kessen-drop:${n}`,
      table: "KAGE",
      pool: npcDropPool(SHISHI, POOL),
      forbiddenPool: npcForbiddenPool(SHISHI, POOL),
      byName: copiesByName({}, POOL),
    });
    if (roll.card && roll.forbidden) return String(n);
  }
  throw new Error("No seed rolls both drops");
};

describe("Kessen match payout plan", () => {
  it("grants the card and the Forbidden variant when a Kage win rolls both", () => {
    const planned = plan(seedWithBothDrops());
    expect(planned.result.drops.map((drop) => drop.forbidden)).toEqual([false, true]);
    expect(planned.rewardItems.map((grant) => grant.itemId)).toEqual(
      expect.arrayContaining(planned.result.drops.map((drop) => drop.itemId)),
    );
  });

  it("rolls the drop from the hidden seed it is given", () => {
    expect(plan("hidden-a").result.drops).toEqual(plan("hidden-a").result.drops);
  });

  it("stores a result that pays nothing before the claims", () => {
    const planned = plan(seedWithBothDrops());
    expect(planned.result).toMatchObject({ rewarded: true });
    expect(planned.result.firstWin).not.toBeNull();
    expect(unsettledKessenResult(planned)).toMatchObject({
      winner: 0,
      rewarded: false,
      ryo: 0,
      drops: [],
      firstWin: null,
      weeklyFirstWinPack: false,
      lessonCompleted: false,
    });
  });

  const unmeishiPick = (owned: Record<string, number>) =>
    planKessenFinish({
      dropSeed: "pick",
      npc: UNMEISHI,
      tier: "KAGE",
      stored: wonMatch(UNMEISHI),
      startedAt: new Date(NOW.getTime() - 10 * 60_000),
      now: NOW,
      progress: null,
      npcProgress: null,
      owned,
    }).result.firstWin?.choice;

  it("offers Unmeishi's pick from the legendaries the player does not own", () => {
    const legendaries = standardLegendaries(POOL).map((card) => card.id);
    const [kept, ...rest] = legendaries;
    const owned = Object.fromEntries(rest.map((id) => [id, 1]));
    expect(unmeishiPick(owned)).toEqual({
      kind: "unownedLegendary",
      options: [kept as string],
      claimed: null,
    });
  });

  it("offers every legendary as a plain pick once the player owns them all", () => {
    const legendaries = standardLegendaries(POOL).map((card) => card.id);
    expect(legendaries.length).toBeGreaterThan(0);
    const owned = Object.fromEntries(legendaries.map((id) => [id, 1]));
    expect(unmeishiPick(owned)).toEqual({
      kind: "items",
      options: legendaries,
      claimed: null,
    });
  });
});

describe("Academy lesson payout", () => {
  const LEMU = kessenNpc("lemu") as KessenNpc;

  const lessonPlan = (key: KessenAcademyLessonKey, academy: Record<string, string>) => {
    const line = academyTaughtLine(key, KESSEN_SEED_CATALOG);
    if ("error" in line) throw new Error(line.error);
    return planKessenFinish({
      dropSeed: "lesson",
      npc: LEMU,
      tier: "GENIN",
      stored: {
        engine: line.state,
        mode: "lesson",
        lesson: key,
        pool: Object.values(line.state.cards),
        aiDeck: [],
        borrowed: [],
        plays: [line.actions.length, 0],
        log: [],
        result: null,
      },
      startedAt: new Date(NOW.getTime() - 60_000),
      now: NOW,
      progress: { academy } as unknown as KessenProgress,
      npcProgress: null,
      owned: {},
    });
  };

  it("pays the lesson ryo once and leads the first lesson to the starter choice", () => {
    const first = lessonPlan("first-blood", {});
    expect(first.academy).toEqual({
      lesson: "first-blood",
      first: true,
      ryo: KESSEN_ACADEMY_LESSON_RYO,
      graduation: false,
    });
    expect(first.result).toMatchObject({
      rewarded: false,
      ryo: KESSEN_ACADEMY_LESSON_RYO,
      lessonCompleted: true,
      firstWin: { itemIds: [], choice: { kind: "starterFaction" } },
      academy: { lesson: "first-blood", graduationPackId: null },
    });
    const replay = lessonPlan("first-blood", { "first-blood": "m0" });
    expect(replay.academy).toMatchObject({ first: false, ryo: 0 });
    expect(replay.result).toMatchObject({
      ryo: 0,
      lessonCompleted: false,
      firstWin: null,
    });
  });

  it("plans the graduation pack with the last lesson", () => {
    const done = {
      "first-blood": "a",
      enough: "b",
      "cut-the-root": "c",
      "spread-out": "d",
    };
    expect(lessonPlan("grow-early", done).academy?.graduation).toBe(false);
    const last = lessonPlan("leaders-moment", { ...done, "grow-early": "e" });
    expect(last.academy?.graduation).toBe(true);
    expect(last.result.academy?.graduationPackId).toBe(
      KESSEN_ACADEMY_GRADUATION_PACK_ID,
    );
    expect(last.result.firstWin).toBeNull();
  });
});
