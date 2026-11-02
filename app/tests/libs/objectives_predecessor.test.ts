import { describe, expect, it } from "bun:test";
import { findCompletedPredecessor } from "@/libs/objectives";
import type { AllObjectivesType, QuestTrackerType } from "@/validators/objectives";

const battle = {
  id: "battle",
  task: "start_battle",
  nextObjectiveId: "won",
  failObjectiveId: "lost",
} as unknown as AllObjectivesType;
const won = { id: "won", task: "dialog" } as unknown as AllObjectivesType;
const lost = { id: "lost", task: "dialog" } as unknown as AllObjectivesType;

const tracker = (doneIds: string[]) =>
  ({ goals: doneIds.map((id) => ({ id, done: true })) }) as unknown as QuestTrackerType;

describe("findCompletedPredecessor", () => {
  it("finds a completed battle through its success and fail links", () => {
    const objectives = [battle, won, lost];
    expect(findCompletedPredecessor(objectives, "won", tracker(["battle"]))?.id).toBe(
      "battle",
    );
    expect(findCompletedPredecessor(objectives, "lost", tracker(["battle"]))?.id).toBe(
      "battle",
    );
  });

  it("ignores predecessors that are not complete", () => {
    expect(findCompletedPredecessor([battle, lost], "lost", tracker([]))).toBeUndefined();
  });
});
