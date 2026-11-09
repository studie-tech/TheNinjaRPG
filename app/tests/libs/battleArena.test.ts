import { describe, expect, it } from "bun:test";
import {
  ARENA_MODES,
  arenaModeFromHash,
  dummyPresetValues,
  matchDummyPreset,
  rankedProgress,
  selectedLoadoutName,
  sparExamProgress,
  towerState,
} from "@/libs/battleArena";

describe("arenaModeFromHash", () => {
  it("maps hashes to modes", () => {
    expect(ARENA_MODES).toEqual([
      "Arena",
      "Sparring",
      "Training",
      "PVP Rank",
      "Battle Pyramid",
    ]);
    expect(arenaModeFromHash("#PVP%20Rank")).toBe("PVP Rank");
    expect(arenaModeFromHash("#Battle%20Pyramid")).toBe("Battle Pyramid");
    expect(arenaModeFromHash("#Sparring")).toBe("Sparring");
    expect(arenaModeFromHash("")).toBeNull();
    expect(arenaModeFromHash("#Nope")).toBeNull();
    expect(arenaModeFromHash("#%")).toBeNull();
  });
});

const examQuest = (objectives: unknown[]) => ({
  id: "q-exam",
  questId: "q-exam",
  endAt: null,
  quest: {
    id: "q-exam",
    name: "Genin Exam",
    questType: "exam",
    hidden: false,
    content: { objectives, reward: {}, sceneBackground: "", sceneCharacters: [] },
  },
});

const examUser = (objectives: unknown[], goals: unknown[]) =>
  ({
    userQuests: [examQuest(objectives)],
    questData: [{ id: "q-exam", goals }],
    completedQuests: [],
  }) as never;

describe("sparExamProgress", () => {
  const spars = { id: "o-1", task: "spars_won", value: 3 };

  it("finds spar exam progress", () => {
    expect(
      sparExamProgress(examUser([spars], [{ id: "o-1", value: 1, done: false }])),
    ).toEqual({
      questName: "Genin Exam",
      done: 1,
      target: 3,
    });
  });

  it("ignores quests without an open spar objective", () => {
    expect(
      sparExamProgress(examUser([{ id: "o-2", task: "pvp_kills", value: 3 }], [])),
    ).toBeNull();
    expect(
      sparExamProgress(examUser([spars], [{ id: "o-1", value: 3, done: true }])),
    ).toBeNull();
  });

  it("starts from zero without a tracker", () => {
    expect(sparExamProgress(examUser([spars], []))?.done).toBe(0);
  });
});

describe("rankedProgress", () => {
  it("uses the canonical Sannin cutoff and has no next division after it", () => {
    const topPlayersLP = [1200, 1190, 1180, 1170, 1160, 1150, 1140, 1130, 1120, 1110];
    expect(rankedProgress(1200, topPlayersLP)).toEqual({
      division: "Sannin",
      nextDivision: null,
      toNext: null,
    });
    expect(rankedProgress(1100, topPlayersLP).division).toBe("Legend");
  });
  it("places LP on the division ladder", () => {
    expect(rankedProgress(180)).toEqual({
      division: "Wood",
      nextDivision: "Adept",
      toNext: 120,
    });
    expect(rankedProgress(300)).toEqual({
      division: "Adept",
      nextDivision: "Master",
      toNext: 300,
    });
    expect(rankedProgress(0)).toEqual({
      division: "Unranked",
      nextDivision: "Wood",
      toNext: 150,
    });
    expect(rankedProgress(1000)).toEqual({
      division: "Legend",
      nextDivision: "Sannin",
      toNext: null,
    });
  });
});

describe("dummy presets", () => {
  const max = {
    defence: 60000,
    strength: 60000,
    speed: 60000,
    intelligence: 60000,
    willpower: 60000,
  };
  const me = {
    defence: 25000,
    strength: 70000,
    speed: 9,
    intelligence: 13000,
    willpower: 16000,
  };

  it("fills dummy presets within range", () => {
    expect(dummyPresetValues("Like me", me, max, 10)).toEqual({
      defence: 25000,
      strength: 60000,
      speed: 10,
      intelligence: 13000,
      willpower: 16000,
    });
    expect(dummyPresetValues("Minimum", me, max, 10)).toEqual({
      defence: 10,
      strength: 10,
      speed: 10,
      intelligence: 10,
      willpower: 10,
    });
    expect(dummyPresetValues("Maximum", me, max, 10)).toEqual(max);
  });

  it("names the preset the values match, else Custom", () => {
    expect(matchDummyPreset(max, me, max, 10)).toBe("Maximum");
    expect(
      matchDummyPreset(dummyPresetValues("Like me", me, max, 10), me, max, 10),
    ).toBe("Like me");
    expect(matchDummyPreset({ ...max, speed: 5000 }, me, max, 10)).toBe("Custom");
    // A fresh character's own stats equal the minimum; name the plainer preset.
    const fresh = {
      defence: 10,
      strength: 10,
      speed: 10,
      intelligence: 10,
      willpower: 10,
    };
    expect(matchDummyPreset(fresh, fresh, max, 10)).toBe("Minimum");
  });
});

describe("towerState", () => {
  const tower = (owned: number) => ({
    id: "t-1",
    entryRequirements: [{ quantity: 2, owned }],
  });

  it("orders tower states", () => {
    expect(towerState(tower(0), { id: "t-1", name: "Sotek" })).toEqual({
      kind: "climbing",
    });
    expect(towerState(tower(2), { id: "t-2", name: "Sotek" })).toEqual({
      kind: "busy",
      climbing: "Sotek",
    });
    expect(towerState(tower(1), null)).toEqual({ kind: "missingItems", missing: 1 });
    expect(towerState(tower(2), null)).toEqual({ kind: "open" });
    expect(towerState({ id: "t-3", entryRequirements: [] }, null)).toEqual({
      kind: "open",
    });
  });
});

describe("selectedLoadoutName", () => {
  const loadouts = [
    { id: "a", name: "PvE build" },
    { id: "b", name: null },
  ];
  it("uses the loadout's own name", () => {
    expect(selectedLoadoutName(loadouts, "a", "Jutsu loadout")).toBe("PvE build");
  });
  it("falls back to the numbered label the pickers show", () => {
    expect(selectedLoadoutName(loadouts, "b", "Jutsu loadout")).toBe("Jutsu loadout 2");
  });
  it("is null until the loadouts load or when nothing is selected", () => {
    expect(selectedLoadoutName(undefined, "a", "Jutsu loadout")).toBeNull();
    expect(selectedLoadoutName(loadouts, null, "Jutsu loadout")).toBeNull();
  });
});
