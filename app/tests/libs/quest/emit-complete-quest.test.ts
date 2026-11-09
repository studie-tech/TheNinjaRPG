import { describe, expect, it } from "bun:test";
import { getReward } from "@/libs/quest/rewards";
import {
  trackerQuest as makeQuest,
  trackerUser as makeUser,
  trackerGoalValue,
} from "../../setup/quest";

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
    expect(trackerGoalValue({ trackers }, "B", "b-obj")).toBe(1);
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
    expect(trackerGoalValue({ trackers }, "B", "b-obj")).toBe(0);
  });
});
