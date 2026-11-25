import { describe, expect, it } from "bun:test";
import type { Quest } from "@/drizzle/schema";
import { getSeenQuestDialogue } from "@/libs/objectives";
import type { QuestTrackerType } from "@/validators/objectives";

const dialog = (id: string, branches: [string, string?][], extra = {}) => ({
  id,
  task: "dialog",
  description: `${id} text`,
  nextObjectiveId: branches.map(([text, nextObjectiveId]) => ({
    text,
    nextObjectiveId,
  })),
  ...extra,
});

const objectives = [
  dialog("greet", [
    ["Ask", "ask"],
    ["Threaten", "threaten"],
  ]),
  dialog("ask", [["Go on", "fetch"]]),
  dialog("threaten", [["Leave", "fetch"]]),
  {
    id: "fetch",
    task: "collect_item",
    description: "fetch text",
    nextObjectiveId: "end",
  },
  dialog("end", [["Done", "win"]]),
  { id: "win", task: "win_quest", description: "win text" },
];

const seen = (
  goals: Partial<QuestTrackerType["goals"][number]>[],
  quest: { objectives?: unknown[]; consecutive?: boolean } = {},
) =>
  getSeenQuestDialogue(
    {
      consecutiveObjectives: quest.consecutive ?? true,
      content: { objectives: quest.objectives ?? objectives },
    } as unknown as Quest,
    { id: "quest", goals } as QuestTrackerType,
  );

describe("getSeenQuestDialogue", () => {
  it("gives only the opening of a quest that has just started", () => {
    expect(seen([])).toEqual([{ objectiveId: "greet", text: "greet text" }]);
  });

  it("follows the chosen branch up to the active objective", () => {
    expect(
      seen([
        { id: "greet", done: true, selectedNextObjectiveId: "ask" },
        { id: "ask", done: true, selectedNextObjectiveId: "fetch" },
        { id: "fetch", done: false, selectedNextObjectiveId: "end" },
      ]),
    ).toEqual([
      { objectiveId: "greet", text: "greet text", answer: "Ask" },
      { objectiveId: "ask", text: "ask text", answer: "Go on" },
      { objectiveId: "fetch", text: "fetch text" },
    ]);
  });

  it("keeps an NPC's words unread until they have been answered in person", () => {
    const bound = [dialog("npc", [["Hello"]], { overworldPlacementId: "placement" })];
    expect(seen([], { objectives: bound })).toEqual([]);
    expect(seen([{ id: "npc", done: true }], { objectives: bound })).toEqual([
      { objectiveId: "npc", text: "npc text", answer: "Hello" },
    ]);
  });

  it("leaves out an answer shared by several choices", () => {
    const twin = [
      dialog("a", [
        ["Yes", "b"],
        ["No", "b"],
      ]),
      dialog("b", []),
    ];
    expect(
      seen([{ id: "a", done: true, selectedNextObjectiveId: "b" }], {
        objectives: twin,
      })[0]?.answer,
    ).toBeUndefined();
  });

  it("leaves out objectives without text and those that resolve by themselves", () => {
    expect(
      seen([
        { id: "greet", done: true, selectedNextObjectiveId: "win" },
        { id: "win", done: true },
      ]).map((entry) => entry.objectiveId),
    ).toEqual(["greet"]);
    expect(
      seen([], {
        objectives: [{ id: "x", task: "move_to_location", description: "" }],
      }),
    ).toEqual([]);
  });

  it("counts only answered conversations of a quest without an order", () => {
    expect(
      seen(
        [
          { id: "ask", done: true, selectedNextObjectiveId: "fetch" },
          { id: "fetch", done: true },
        ],
        { consecutive: false },
      ).map((entry) => entry.objectiveId),
    ).toEqual(["ask"]);
  });
});
