import { describe, expect, it } from "vitest";
import { getNewTrackers } from "@/libs/quest";

const buyItemObjective = (id: string, ids: string[], value = 5) => ({
  id,
  task: "buy_item" as const,
  value,
  buyItemIds: ids,
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
  content: { objectives, reward: {}, sceneBackground: "", sceneCharacters: [] },
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

describe("buy_item emit", () => {
  it("increments by the purchased stack size for a listed item", () => {
    const quest = makeQuest("q", [buyItemObjective("o", ["itemA"], 5)]);
    // input.stack === 3, input.itemId === "itemA"
    const result = getNewTrackers(makeUser([quest]), [
      { task: "buy_item", increment: 3, contentId: "itemA" },
    ]);
    expect(goalValue(result, "q", "o")).toBe(3);
  });

  it("credits two buy_item objectives independently by their id-lists", () => {
    const quest = makeQuest("q", [
      buyItemObjective("o-a", ["itemA"], 5),
      buyItemObjective("o-b", ["itemB"], 5),
    ]);
    const result = getNewTrackers(makeUser([quest]), [
      { task: "buy_item", increment: 2, contentId: "itemA" },
    ]);
    expect(goalValue(result, "q", "o-a")).toBe(2);
    expect(goalValue(result, "q", "o-b")).toBe(0);
  });
});
