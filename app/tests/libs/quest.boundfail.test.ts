import { describe, expect, it } from "vitest";
import type { QuestType } from "@/drizzle/constants";
import {
  getNewTrackers,
  isBoundPlacementDeleted,
  isBoundPlacementFrozen,
} from "@/libs/quest";

const obj = (id?: string) =>
  ({ task: "dialog", overworldPlacementId: id } as never);

describe("isBoundPlacementDeleted", () => {
  it("returns true when the bound placement is absent from existing (hard-deleted)", () => {
    expect(isBoundPlacementDeleted(obj("p1"), new Set())).toBe(true);
    expect(isBoundPlacementDeleted(obj("p1"), new Set(["p2"]))).toBe(true);
  });

  it("returns false when the bound placement exists (active or not)", () => {
    expect(isBoundPlacementDeleted(obj("p1"), new Set(["p1"]))).toBe(false);
  });

  it("returns false for unbound objectives", () => {
    expect(isBoundPlacementDeleted(obj(), new Set())).toBe(false);
    expect(isBoundPlacementDeleted({} as never, new Set())).toBe(false);
  });
});

describe("isBoundPlacementFrozen", () => {
  it("returns true when the placement exists but is not active (deactivated)", () => {
    const existing = new Set(["p1"]);
    const active = new Set<string>();
    expect(isBoundPlacementFrozen(obj("p1"), existing, active)).toBe(true);
  });

  it("returns false when the placement is active", () => {
    const existing = new Set(["p1"]);
    const active = new Set(["p1"]);
    expect(isBoundPlacementFrozen(obj("p1"), existing, active)).toBe(false);
  });

  it("returns false when the placement is deleted (not in existing)", () => {
    const existing = new Set<string>();
    const active = new Set<string>();
    expect(isBoundPlacementFrozen(obj("p1"), existing, active)).toBe(false);
  });

  it("returns false for unbound objectives", () => {
    const existing = new Set(["p1"]);
    const active = new Set(["p1"]);
    expect(isBoundPlacementFrozen(obj(), existing, active)).toBe(false);
    expect(isBoundPlacementFrozen({} as never, existing, active)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getNewTrackers ordering: for a consecutiveObjectives quest, the bound-placement
// check must only run for objectives the player has actually reached. Otherwise an
// admin deleting (or deactivating) a late-stage placement would auto-fail — or
// freeze — the whole quest for players still on an early stage, since
// checkLocationQuest runs getNewTrackers on every movement.
// ---------------------------------------------------------------------------

// Linear chain o1 -> o2 -> o3 via nextObjectiveId; each optionally bound to a placement.
const boundObjective = (
  id: string,
  next: string | undefined,
  placementId?: string,
) =>
  ({
    id,
    task: "dialog" as const,
    description: "",
    successDescription: "",
    ...(next ? { nextObjectiveId: next } : {}),
    ...(placementId ? { overworldPlacementId: placementId } : {}),
  }) as unknown;

const makeConsecutiveQuest = (id: string, objectives: unknown[]) => ({
  id,
  name: `Quest ${id}`,
  questType: "mission" as QuestType,
  hidden: false,
  consecutiveObjectives: true,
  maxAttempts: 100,
  maxCompletes: 100,
  requiredVillage: null,
  requiredBloodlineId: null,
  prerequisiteQuestId: null,
  requiredLevel: null,
  maxLevel: null,
  medicalRank: null,
  huntingRank: null,
  gatheringRank: null,
  endsAt: null,
  content: { objectives, reward: {}, sceneBackground: "", sceneCharacters: [] },
});

// Build a user whose tracker for `quest` carries exactly `goals`. An objective is
// "reached" only if the tracker's selectedNextObjectiveId chain leads to it, so a
// goal with `done:false` and no selectedNextObjectiveId parks the player there.
const makeUser = (
  quest: ReturnType<typeof makeConsecutiveQuest>,
  goals: { id: string; done?: boolean; selectedNextObjectiveId?: string }[],
) =>
  ({
    userId: "u1",
    level: 50,
    rank: "JONIN",
    role: "USER",
    villageId: "v1",
    isOutlaw: false,
    bloodlineId: null,
    sector: 1,
    village: { id: "v1", sector: 1 },
    activeWars: [],
    completedQuests: [],
    questData: [{ id: quest.id, startAt: new Date(), goals }],
    userQuests: [
      {
        id: `uq-${quest.id}`,
        questId: quest.id,
        completed: 0,
        previousAttempts: 0,
        previousCompletes: 0,
        quest,
      },
    ],
  }) as unknown as Parameters<typeof getNewTrackers>[0];

const questFailed = (result: ReturnType<typeof getNewTrackers>, questId: string) =>
  result.consequences.some(
    (c) => c.type === "fail_quest" && c.ids.includes(questId),
  );

const goalOf = (
  result: ReturnType<typeof getNewTrackers>,
  questId: string,
  objectiveId: string,
) =>
  result.trackers.find((t) => t.id === questId)?.goals.find((g) => g.id === objectiveId);

describe("getNewTrackers — bound-placement check respects consecutive reachability", () => {
  it("does NOT fail the quest when an unreached objective's placement was deleted", () => {
    // o1 (p1, active) -> o2 (p2, active) -> o3 (p3, DELETED). Player parked on o1.
    const quest = makeConsecutiveQuest("q1", [
      boundObjective("o1", "o2", "p1"),
      boundObjective("o2", "o3", "p2"),
      boundObjective("o3", undefined, "p3"),
    ]);
    const result = getNewTrackers(
      makeUser(quest, [{ id: "o1", done: false }]),
      [],
      undefined,
      {
        existing: new Set(["p1", "p2"]), // p3 hard-deleted
        active: new Set(["p1", "p2"]),
      },
    );

    expect(questFailed(result, "q1")).toBe(false);
    expect(goalOf(result, "q1", "o3")?.done).toBeFalsy();
  });

  it("does NOT touch an unreached objective whose placement is frozen (deactivated)", () => {
    // Same chain, but o3's placement exists and is merely deactivated. An unreached
    // frozen objective must simply be left alone — not failed, not marked done.
    const quest = makeConsecutiveQuest("q1", [
      boundObjective("o1", "o2", "p1"),
      boundObjective("o2", "o3", "p2"),
      boundObjective("o3", undefined, "p3"),
    ]);
    const result = getNewTrackers(
      makeUser(quest, [{ id: "o1", done: false }]),
      [],
      undefined,
      {
        existing: new Set(["p1", "p2", "p3"]),
        active: new Set(["p1", "p2"]), // p3 exists but deactivated → frozen
      },
    );

    expect(questFailed(result, "q1")).toBe(false);
    expect(goalOf(result, "q1", "o3")?.done).toBeFalsy();
  });

  it("STILL fails the quest when the reachable start objective's placement was deleted", () => {
    // Control: the start objective is always reachable, so its deleted placement
    // must still auto-fail — proving the fix didn't disable the feature.
    const quest = makeConsecutiveQuest("q1", [
      boundObjective("o1", "o2", "p1"), // DELETED and reachable (start)
      boundObjective("o2", undefined, "p2"),
    ]);
    const result = getNewTrackers(
      makeUser(quest, [{ id: "o1", done: false }]),
      [],
      undefined,
      {
        existing: new Set(["p2"]), // p1 hard-deleted
        active: new Set(["p2"]),
      },
    );

    expect(questFailed(result, "q1")).toBe(true);
  });

  it("STILL fails the quest when a reachable mid-chain objective's placement was deleted", () => {
    // o1 completed and pointing at o2 → o2 is now reachable. Deleting o2's placement
    // must still auto-fail, confirming the gate only blocks *unreached* objectives.
    const quest = makeConsecutiveQuest("q1", [
      boundObjective("o1", "o2", "p1"),
      boundObjective("o2", "o3", "p2"), // DELETED and now reachable
      boundObjective("o3", undefined, "p3"),
    ]);
    const result = getNewTrackers(
      makeUser(quest, [{ id: "o1", done: true, selectedNextObjectiveId: "o2" }]),
      [],
      undefined,
      {
        existing: new Set(["p1", "p3"]), // p2 hard-deleted
        active: new Set(["p1", "p3"]),
      },
    );

    expect(questFailed(result, "q1")).toBe(true);
  });
});
