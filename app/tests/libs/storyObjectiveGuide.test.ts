import { describe, expect, it } from "bun:test";
import type { Quest } from "@/drizzle/schema";
import {
  getStoryGuideDepth,
  getStoryObjectiveFocus,
  getStoryObjectiveGuide,
} from "@/libs/storyObjectiveGuide";
import type { QuestTrackerType } from "@/validators/objectives";

const CHAPTER = "chapter-8";
const ERRAND = "errand-gate";

const quest = (
  id: string,
  questType: string,
  objectives: { id: string; task: string; value?: number; description?: string }[],
) =>
  ({
    id,
    name: id === ERRAND ? "The Broken Gate" : "Chapter 8: The Ledger",
    questType,
    consecutiveObjectives: true,
    content: {
      objectives: objectives.map((objective, index) => ({
        ...objective,
        nextObjectiveId: objectives[index + 1]?.id,
      })),
    },
  }) as unknown as Quest;

const chapter = quest(CHAPTER, "starter", [
  { id: "d1", task: "dialog" },
  { id: "c1", task: "errands_total", value: 3, description: "Do 3 errands." },
  { id: "c3", task: "bank_deposit", value: 1 },
]);
const errand = quest(ERRAND, "errand", [
  { id: "e1", task: "move_to_location" },
  { id: "e2", task: "move_to_location" },
]);

const tracker = (id: string, goals: { id: string; done?: boolean; value?: number }[]) =>
  ({
    id,
    goals: goals.map((goal) => ({ done: false, value: 0, collected: false, ...goal })),
  }) as unknown as QuestTrackerType;

const user = (
  quests: Quest[],
  trackers: QuestTrackerType[],
): Parameters<typeof getStoryObjectiveFocus>[0] => ({
  userQuests: quests.map((q) => ({ questId: q.id, endAt: null, quest: q })),
  questData: trackers,
});

describe("getStoryObjectiveFocus", () => {
  it("teaches the chapter's current objective with its count", () => {
    const focus = getStoryObjectiveFocus(
      user(
        [chapter],
        [
          tracker(CHAPTER, [
            { id: "d1", done: true },
            { id: "c1", value: 1 },
          ]),
        ],
      ),
      CHAPTER,
    );
    expect(focus).toMatchObject({
      questId: CHAPTER,
      objective: { id: "c1", task: "errands_total", description: "Do 3 errands." },
      progress: { value: 1, target: 3 },
      guide: { page: "/missionhall" },
    });
    expect(focus?.countsFor).toBeUndefined();
  });

  it("follows a running errand that counts towards the chapter", () => {
    const focus = getStoryObjectiveFocus(
      user(
        [chapter, errand],
        [
          tracker(CHAPTER, [
            { id: "d1", done: true },
            { id: "c1", value: 2 },
          ]),
          tracker(ERRAND, [{ id: "e1", done: true }]),
        ],
      ),
      CHAPTER,
    );
    expect(focus).toMatchObject({
      questId: ERRAND,
      questName: "The Broken Gate",
      objective: { id: "e2", task: "move_to_location" },
      guide: { page: "/travel", targets: ["tutorial-objective-marker"] },
      countsFor: { objective: { id: "c1" }, progress: { value: 2, target: 3 } },
    });
  });

  it("leaves a finished errand to its claim", () => {
    const focus = getStoryObjectiveFocus(
      user(
        [chapter, errand],
        [
          tracker(CHAPTER, [{ id: "d1", done: true }]),
          tracker(ERRAND, [
            { id: "e1", done: true },
            { id: "e2", done: true },
          ]),
        ],
      ),
      CHAPTER,
    );
    expect(focus).toMatchObject({
      questId: ERRAND,
      isClaimable: true,
      guide: undefined,
    });
  });

  it("ignores a running errand once the chapter has moved past errands", () => {
    const focus = getStoryObjectiveFocus(
      user(
        [chapter, errand],
        [
          tracker(CHAPTER, [
            { id: "d1", done: true },
            { id: "c1", done: true, value: 3 },
          ]),
          tracker(ERRAND, []),
        ],
      ),
      CHAPTER,
    );
    expect(focus).toMatchObject({ questId: CHAPTER, objective: { id: "c3" } });
  });

  it("has no guide for a dialog, which is answered where it is told", () => {
    const focus = getStoryObjectiveFocus(
      user([chapter], [tracker(CHAPTER, [])]),
      CHAPTER,
    );
    expect(focus).toMatchObject({ objective: { id: "d1" }, guide: undefined });
    expect(getStoryObjectiveGuide("dialog")).toBeUndefined();
  });
});

describe("getStoryGuideDepth", () => {
  it("fades from a full lesson to the objective alone", () => {
    expect(getStoryGuideDepth("G3")).toEqual({
      explains: true,
      linksPage: false,
      points: "full",
    });
    expect(getStoryGuideDepth("G2")).toEqual({
      explains: true,
      linksPage: true,
      points: "light",
    });
    expect(getStoryGuideDepth("G1")).toEqual({
      explains: true,
      linksPage: false,
      points: undefined,
    });
    expect(getStoryGuideDepth("G0")).toEqual({
      explains: false,
      linksPage: false,
      points: undefined,
    });
  });
});
