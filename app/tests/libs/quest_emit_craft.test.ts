import { describe, expect, it } from "vitest";
import { getNewTrackers } from "@/libs/quest";

// Minimal fixtures mirroring app/tests/libs/quest_killcount.test.ts. The full
// UserWithRelations type is large; only the fields exercised at runtime matter.
const itemsCraftedObjective = (id: string, value = 5) => ({
  id,
  task: "items_crafted" as const,
  value,
  description: "",
  successDescription: "",
});

const craftSpecificObjective = (id: string, ids: string[], value = 5) => ({
  id,
  task: "craft_specific_item" as const,
  value,
  craftItemIds: ids,
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

const makeUser = (quests: ReturnType<typeof makeQuest>[]) =>
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
    questData: [],
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

// Exact task-update array the craft mutation emits for quantity=3, itemId="itemA".
const craftEmit = (quantity: number, itemId: string) => [
  { task: "crafting_experience_gained" as const, increment: 10 },
  { task: "items_crafted" as const, increment: quantity },
  { task: "craft_specific_item" as const, increment: quantity, contentId: itemId },
];

describe("craft mutation tracker emits", () => {
  it("items_crafted counter increments by the crafted quantity", () => {
    const quest = makeQuest("q-craft", [itemsCraftedObjective("o-count", 5)]);
    const result = getNewTrackers(makeUser([quest]), craftEmit(3, "itemA"));
    expect(goalValue(result, "q-craft", "o-count")).toBe(3);
  });

  it("craft_specific_item increments only when the crafted itemId is listed", () => {
    const quest = makeQuest("q-spec", [
      craftSpecificObjective("o-match", ["itemA", "itemB"], 5),
      craftSpecificObjective("o-other", ["itemZ"], 5),
    ]);
    const result = getNewTrackers(makeUser([quest]), craftEmit(3, "itemA"));
    // Matching id-list: credited by the crafted quantity (no double-count via the
    // generic value path, which is guarded off for content-gated tasks).
    expect(goalValue(result, "q-spec", "o-match")).toBe(3);
    // Disjoint id-list: not credited.
    expect(goalValue(result, "q-spec", "o-other")).toBe(0);
  });
});
