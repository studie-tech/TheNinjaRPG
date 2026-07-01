import { describe, expect, it } from "vitest";
import { getNewTrackers } from "@/libs/quest";

// Minimal fixtures following the pattern in quest_emit_craft.test.ts.
// Only the fields exercised at runtime by getNewTrackers are populated.

const herbsObjective = (id: string, value = 10) => ({
  id,
  task: "herbs_gathered" as const,
  value,
  description: "",
  successDescription: "",
});

// Use items_crafted (a SimpleTask that preserves seeded increment values) so the
// no-clobber assertion is deterministic. `minutes_passed` snapshots from startAt
// and always recomputes, making a fixed expected value unreliable in a unit test.
const itemsCraftedObjective = (id: string, value = 100) => ({
  id,
  task: "items_crafted" as const,
  value,
  description: "",
  successDescription: "",
});

const makeQuest = (id: string, objectives: Record<string, unknown>[]) => ({
  id,
  name: `Quest ${id}`,
  questType: "daily" as const,
  hidden: false,
  consecutiveObjectives: false,
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
  content: {
    objectives,
    reward: {},
    sceneBackground: "",
    sceneCharacters: [],
  },
});

const makeUser = (
  quests: ReturnType<typeof makeQuest>[],
  seeded?: { id: string; goals: { id: string; value: number; done: boolean }[] }[],
) =>
  ({
    userId: "u1",
    level: 50,
    rank: "JONIN",
    role: "USER",
    villageId: "v1",
    isOutlaw: false,
    bloodlineId: null,
    medicalExperience: 0,
    huntingExperience: 0,
    gatheringExperience: 0,
    sector: 1,
    village: { id: "v1", sector: 1 },
    activeWars: [],
    completedQuests: [],
    questData: seeded ?? [],
    userQuests: quests.map((q) => ({
      id: `uq-${q.id}`,
      questId: q.id,
      completed: 0,
      previousAttempts: 0,
      previousCompletes: 0,
      quest: q,
    })),
  }) as unknown as Parameters<typeof getNewTrackers>[0];

const goalValue = (
  result: ReturnType<typeof getNewTrackers>,
  questId: string,
  objectiveId: string,
) =>
  result.trackers
    .find((t) => t.id === questId)
    ?.goals.find((g) => g.id === objectiveId)?.value;

describe("herbs_gathered emit", () => {
  it("increments by the number of gathering-item drops", () => {
    const quest = makeQuest("q-gather", [herbsObjective("o-herbs", 10)]);
    // droppedGatheringItems.length === 4
    const result = getNewTrackers(makeUser([quest]), [
      { task: "herbs_gathered", increment: 4 },
    ]);
    expect(goalValue(result, "q-gather", "o-herbs")).toBe(4);
  });

  it("preserves other quest progress (no-clobber)", () => {
    const gatherQuest = makeQuest("q-gather", [herbsObjective("o-herbs", 10)]);
    const otherQuest = makeQuest("q-other", [itemsCraftedObjective("o-crafted", 100)]);
    // Pre-existing progress on the unrelated quest must survive the herb fold.
    const seeded = [
      { id: "q-other", goals: [{ id: "o-crafted", value: 42, done: false }] },
    ];
    const result = getNewTrackers(makeUser([gatherQuest, otherQuest], seeded), [
      { task: "herbs_gathered", increment: 4 },
    ]);
    expect(goalValue(result, "q-gather", "o-herbs")).toBe(4);
    expect(goalValue(result, "q-other", "o-crafted")).toBe(42);
  });
});
