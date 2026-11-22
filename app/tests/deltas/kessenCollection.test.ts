import { describe, expect, it } from "bun:test";
import {
  withAutoSell,
  withoutDeck,
  withPackReveal,
  withSavedDeck,
  withStarterGranted,
} from "@/deltas/kessenCollection";
import { academyProgress } from "@/libs/kessen/academy";
import type { KessenDeckRow, KessenHub } from "@/validators/kessen";
import type { CardPackReveal } from "@/validators/weightedCache";

const deck = (id: string, name = id): KessenDeckRow => ({
  id,
  name,
  leaderItemId: "kessen-leader-x",
  cards: [{ itemId: "kessen-a", count: 3 }],
  updatedAt: new Date("2026-11-15T00:00:00Z"),
});

const hub = (): KessenHub => ({
  progress: {
    lessonCompleted: true,
    starterGranted: false,
    starterFaction: null,
    seenKeywords: [],
  },
  owned: { "kessen-a": 1 },
  listed: {},
  packs: [
    { userItemId: "ui-paper", itemId: "kessen-pack-paper", name: "Paper", quantity: 2 },
    { userItemId: "ui-first", itemId: "kessen-pack-first", name: "First", quantity: 1 },
  ],
  decks: [deck("one"), deck("two")],
  circuit: [],
  today: { rewarded: 0, rewardedCap: 12, drops: 0, dropsCap: 5 },
  week: { firstWinPack: false },
  activeMatch: null,
  pendingPicks: [],
  academy: academyProgress({ "first-blood": "m1" }, null),
  homeFaction: null,
  loanerFaction: "HYORIN",
  needsLesson: false,
  needsStarter: true,
  pity: { epicIn: 7, legendaryIn: 40 },
  autoSellSurplus: false,
});

describe("Kessen collection hub patches", () => {
  it("replaces a saved deck in place, appends a new one and removes a deleted one", () => {
    expect(
      withSavedDeck(hub(), deck("two", "Renamed")).decks.map((d) => d.name),
    ).toEqual(["one", "Renamed"]);
    expect(withSavedDeck(hub(), deck("three")).decks.map((d) => d.id)).toEqual([
      "one",
      "two",
      "three",
    ]);
    expect(withoutDeck(hub(), "one").decks.map((d) => d.id)).toEqual(["two"]);
  });

  it("adds starter cards without packs and finishes the starter step", () => {
    const next = withStarterGranted(hub(), {
      faction: "HYORIN",
      granted: [
        { itemId: "kessen-a", quantity: 3 },
        { itemId: "kessen-pack-first", quantity: 1 },
      ],
      deck: deck("starter"),
    });
    expect(next.owned).toEqual({ "kessen-a": 4 });
    expect(next.needsStarter).toBe(false);
    expect(next.progress).toMatchObject({
      starterGranted: true,
      starterFaction: "HYORIN",
    });
    expect(next.decks.at(-1)?.id).toBe("starter");
  });

  it("counts delivered pack cards, skips auto-sold ones and updates pity and stacks", () => {
    const reveal: CardPackReveal = {
      packItemId: "kessen-pack-paper",
      cards: [
        {
          itemId: "kessen-a",
          rarity: "COMMON",
          forbidden: false,
          isNew: false,
          surplus: false,
          soldFor: null,
        },
        {
          itemId: "kessen-b",
          rarity: "COMMON",
          forbidden: false,
          isNew: false,
          surplus: true,
          soldFor: 50,
        },
      ],
      pity: { epicIn: 6, legendaryIn: 39 },
    };
    const next = withPackReveal(hub(), reveal, "ui-paper");
    expect(next.owned).toEqual({ "kessen-a": 2 });
    expect(next.pity).toEqual({ epicIn: 6, legendaryIn: 39 });
    expect(next.packs.map((pack) => [pack.userItemId, pack.quantity])).toEqual([
      ["ui-paper", 1],
      ["ui-first", 1],
    ]);
    expect(
      withPackReveal(hub(), reveal, "ui-first").packs.map((pack) => pack.userItemId),
    ).toEqual(["ui-paper"]);
    expect(withAutoSell(hub(), true).autoSellSurplus).toBe(true);
  });
});
