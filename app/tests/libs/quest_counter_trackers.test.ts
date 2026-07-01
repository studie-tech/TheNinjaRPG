import { describe, expect, it } from "vitest";
import { getNewTrackers } from "@/libs/quest";
import {
  allObjectiveTasks,
  getObjectiveSchema,
  SimpleObjective,
} from "@/validators/objectives";

const baseObjective = (id: string) => ({
  id,
  description: "",
  successDescription: "",
});

const makeQuest = (id: string, objectives: object[]) => ({
  id,
  name: `Quest ${id}`,
  questType: "daily",
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
    medicalExperience: 0,
    huntingExperience: 0,
    gatheringExperience: 0,
    craftingExperience: 0,
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

const goalOf = (
  result: ReturnType<typeof getNewTrackers>,
  questId: string,
  objId: string,
) =>
  result.trackers
    .find((t) => t.id === questId)
    ?.goals.find((g) => g.id === objId);

const COUNTERS = ["items_crafted", "creatures_hunted", "herbs_gathered"] as const;

describe("counter objective tasks", () => {
  it("registers each counter task and routes it through SimpleObjective", () => {
    for (const task of COUNTERS) {
      expect(allObjectiveTasks).toContain(task);
      expect(getObjectiveSchema(task)).toBe(SimpleObjective);
    }
  });

  it("items_crafted increments by quantity and auto-completes at value", () => {
    const quest = makeQuest("q1", [
      { ...baseObjective("o1"), task: "items_crafted" as const, value: 3 },
    ]);
    const user = makeUser([quest]);

    let result = getNewTrackers(user, [{ task: "items_crafted", increment: 2 }]);
    user.questData = result.trackers;
    expect(goalOf(result, "q1", "o1")?.value).toBe(2);
    expect(goalOf(result, "q1", "o1")?.done).toBe(false);

    result = getNewTrackers(user, [{ task: "items_crafted", increment: 1 }]);
    expect(goalOf(result, "q1", "o1")?.value).toBe(3);
    expect(goalOf(result, "q1", "o1")?.done).toBe(true);
  });

  it("creatures_hunted counts +1 per emit and herbs_gathered by drop count", () => {
    const quest = makeQuest("q1", [
      { ...baseObjective("hunt"), task: "creatures_hunted" as const, value: 2 },
      { ...baseObjective("herb"), task: "herbs_gathered" as const, value: 5 },
    ]);
    const user = makeUser([quest]);

    const result = getNewTrackers(user, [
      { task: "creatures_hunted", increment: 1 },
      { task: "herbs_gathered", increment: 3 },
    ]);
    expect(goalOf(result, "q1", "hunt")?.value).toBe(1);
    expect(goalOf(result, "q1", "herb")?.value).toBe(3);
    expect(goalOf(result, "q1", "herb")?.done).toBe(false);
  });
});
