import { describe, expect, it } from "bun:test";
import type { Quest } from "@/drizzle/schema";
import {
  buildObjectiveEdges,
  findCompletedPredecessor,
  findPredecessor,
  getActiveObjective,
  isQuestComplete,
  isQuestObjectiveAvailable,
  objectiveLinks,
} from "@/libs/objectives";
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
    expect(
      findCompletedPredecessor([battle, lost], "lost", tracker([])),
    ).toBeUndefined();
  });
});

describe("objectiveLinks", () => {
  it("lists next, fail and reset links in order and skips empty ids", () => {
    const objective = {
      id: "a",
      task: "start_battle",
      nextObjectiveId: "next",
      failObjectiveId: "",
      resetObjectiveId: "again",
    } as unknown as AllObjectivesType;
    expect(objectiveLinks(objective)).toEqual([
      { target: "next", kind: "next" },
      { target: "again", kind: "reset" },
    ]);
  });

  it("gives every routed dialog branch its own link", () => {
    const dialog = {
      id: "a",
      task: "dialog",
      nextObjectiveId: [{ nextObjectiveId: "left" }, {}, { nextObjectiveId: "right" }],
    } as unknown as AllObjectivesType;
    expect(objectiveLinks(dialog).map((link) => link.target)).toEqual([
      "left",
      "right",
    ]);
  });

  it("does not treat a reset link as a predecessor", () => {
    const looping = {
      id: "start",
      task: "dialog",
      resetObjectiveId: "first",
    } as unknown as AllObjectivesType;
    const first = { id: "first", task: "dialog" } as unknown as AllObjectivesType;
    expect(findPredecessor([looping, first], "first")).toBeUndefined();
  });
});

describe("buildObjectiveEdges", () => {
  it("draws next, fail and reset edges to existing objectives once", () => {
    const edges = buildObjectiveEdges(
      [
        {
          ...battle,
          resetObjectiveId: "battle",
        } as unknown as AllObjectivesType,
        won,
        lost,
      ],
      true,
    );
    expect(edges).toEqual([
      { data: { id: "battle__to__won", source: "battle", target: "won", label: "" } },
      {
        data: { id: "battle__fail_to__lost", source: "battle", target: "lost" },
        classes: "fail-edge",
      },
      {
        data: { id: "battle__reset_to__battle", source: "battle", target: "battle" },
        classes: "reset-edge",
      },
    ]);
  });
});

describe("the selected objective path", () => {
  const quest = {
    consecutiveObjectives: true,
    content: { objectives: [battle, won, lost] },
  } as unknown as Quest;
  const track = (goals: { id: string; done?: boolean; selected?: string }[]) =>
    ({
      goals: goals.map(({ id, done, selected }) => ({
        id,
        done,
        selectedNextObjectiveId: selected,
      })),
    }) as unknown as QuestTrackerType;

  it("offers only objectives on the selected branch", () => {
    const tracker = track([{ id: "battle", done: true, selected: "won" }]);
    expect(isQuestObjectiveAvailable(quest, tracker, 1)).toBe(true);
    expect(isQuestObjectiveAvailable(quest, tracker, 2)).toBe(false);
    expect(getActiveObjective(quest, tracker)?.id).toBe("won");
  });

  it("does not unlock a dialogue through an unfinished travel step's saved next link", () => {
    const travelQuest = {
      consecutiveObjectives: true,
      content: {
        objectives: [
          { id: "travel", task: "move_to_location", nextObjectiveId: "dialog" },
          { id: "dialog", task: "dialog" },
        ],
      },
    } as unknown as Quest;
    const pending = track([{ id: "travel", done: false, selected: "dialog" }]);
    expect(isQuestObjectiveAvailable(travelQuest, pending, 0)).toBe(true);
    expect(isQuestObjectiveAvailable(travelQuest, pending, 1)).toBe(false);
    expect(getActiveObjective(travelQuest, pending)?.id).toBe("travel");
    expect(isQuestComplete(travelQuest, pending)).toBe(false);

    const arrived = track([{ id: "travel", done: true, selected: "dialog" }]);
    expect(isQuestObjectiveAvailable(travelQuest, arrived, 1)).toBe(true);
    expect(getActiveObjective(travelQuest, arrived)?.id).toBe("dialog");
    expect(isQuestComplete(travelQuest, arrived)).toBe(false);
  });

  it("completes once the last selected objective is done", () => {
    const pending = track([{ id: "battle", done: true, selected: "won" }]);
    expect(isQuestComplete(quest, pending)).toBe(false);
    const done = track([
      { id: "battle", done: true, selected: "won" },
      { id: "won", done: true },
    ]);
    expect(isQuestComplete(quest, done)).toBe(true);
  });

  it("never completes on a looping or dangling selection", () => {
    const looping = track([
      { id: "battle", done: true, selected: "won" },
      { id: "won", done: true, selected: "battle" },
    ]);
    expect(isQuestComplete(quest, looping)).toBe(false);
    const dangling = track([{ id: "battle", done: true, selected: "missing" }]);
    expect(isQuestComplete(quest, dangling)).toBe(false);
  });
});
