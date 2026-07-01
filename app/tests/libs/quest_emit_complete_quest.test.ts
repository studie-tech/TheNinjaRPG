import { describe, expect, it } from "vitest";
import { getReward, getNewTrackers } from "@/libs/quest";

const winQuestObjective = (id: string) => ({
  id,
  task: "win_quest" as const,
  description: "",
  successDescription: "",
});

const completeSpecificObjective = (id: string, ids: string[], value = 1) => ({
  id,
  task: "complete_specific_quest" as const,
  value,
  completeQuestIds: ids,
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

// userQuest.completed lets us assert idempotency on the active->completed transition.
const makeUser = (
  rows: { quest: ReturnType<typeof makeQuest>; completed: number }[],
  questData: unknown[] = [],
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
    dailyMissions: 0,
    senseiId: null,
    questData,
    userQuests: rows.map(({ quest, completed }) => ({
      id: `uq-${quest.id}`,
      questId: quest.id,
      completed,
      previousAttempts: 0,
      previousCompletes: 0,
      quest,
    })),
  }) as unknown as Parameters<typeof getNewTrackers>[0];

const goalValue = (
  trackers: ReturnType<typeof getReward>["trackers"],
  questId: string,
  objectiveId: string,
) =>
  trackers
    .find((t) => t.id === questId)
    ?.goals.find((g) => g.id === objectiveId)?.value;

describe("complete_specific_quest emit (getReward follow-up)", () => {
  it("completing quest A advances quest B that lists A", () => {
    const questA = makeQuest("A", [winQuestObjective("a-obj")]);
    const questB = makeQuest("B", [completeSpecificObjective("b-obj", ["A"], 1)]);
    // Seed A's tracker as already done so getReward resolves A on this call.
    const seeded = [{ id: "A", goals: [{ id: "a-obj", value: 0, done: true }] }];
    const { trackers } = getReward(
      makeUser(
        [
          { quest: questA, completed: 0 },
          { quest: questB, completed: 0 },
        ],
        seeded,
      ),
      "A",
    );
    expect(goalValue(trackers, "B", "b-obj")).toBe(1);
  });

  it("does not re-advance B once A is already completed (idempotent transition)", () => {
    const questA = makeQuest("A", [winQuestObjective("a-obj")]);
    const questB = makeQuest("B", [completeSpecificObjective("b-obj", ["A"], 1)]);
    const seeded = [{ id: "A", goals: [{ id: "a-obj", value: 0, done: true }] }];
    const { trackers } = getReward(
      makeUser(
        [
          { quest: questA, completed: 1 },
          { quest: questB, completed: 0 },
        ],
        seeded,
      ),
      "A",
    );
    expect(goalValue(trackers, "B", "b-obj")).toBe(0);
  });
});
