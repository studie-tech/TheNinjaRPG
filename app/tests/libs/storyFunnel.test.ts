import { describe, expect, it } from "bun:test";
import { buildStoryChapterFunnel } from "@/libs/storyFunnel";

const chapters = [
  { chapter: 8, questId: "q8", title: "The Ledger", level: 5 },
  { chapter: 13, questId: "q13", title: "The Sick Pup", level: 16, optional: true },
];

describe("buildStoryChapterFunnel", () => {
  it("counts each player once per chapter, finished if any row completed", () => {
    const funnel = buildStoryChapterFunnel(chapters, [
      { userId: "a", questId: "q8", completed: 0 },
      { userId: "a", questId: "q8", completed: 1 },
      { userId: "b", questId: "q8", completed: 0 },
      { userId: "b", questId: "q8", completed: 0 },
      { userId: "c", questId: "other", completed: 1 },
    ]);
    expect(funnel).toEqual([
      {
        chapter: 8,
        title: "The Ledger",
        level: 5,
        optional: false,
        started: 2,
        finished: 1,
      },
      {
        chapter: 13,
        title: "The Sick Pup",
        level: 16,
        optional: true,
        started: 0,
        finished: 0,
      },
    ]);
  });

  it("finishes a chapter with follow-ups only when its closing quest completed", () => {
    const chapter = {
      chapter: 16,
      questId: "first",
      title: "Deployment",
      level: 30,
      followUpQuestIds: ["pyramid", "debrief"],
    };
    const [entry] = buildStoryChapterFunnel(
      [chapter],
      [
        { userId: "a", questId: "first", completed: 1 },
        { userId: "a", questId: "debrief", completed: 0 },
        { userId: "b", questId: "first", completed: 1 },
        { userId: "b", questId: "debrief", completed: 1 },
      ],
    );
    expect(entry).toMatchObject({ started: 2, finished: 1 });
  });
});
