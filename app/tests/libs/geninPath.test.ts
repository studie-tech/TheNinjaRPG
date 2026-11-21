import { describe, expect, it } from "bun:test";
import { RECRUITMENT_STALLED_AFTER_DAYS, USER_CAPS } from "@/drizzle/constants";
import { buildGeninPath, type GeninPathQuest, isStalledPlayer } from "@/libs/geninPath";

const TUTORIAL_ID = "tutorial";

const tutorial: GeninPathQuest = {
  id: TUTORIAL_ID,
  name: "Road to Genin",
  requiredLevel: 1,
  hidden: false,
  content: { objectives: [{ id: "lvl", task: "user_level", value: 5 }] as never },
};

const exam: GeninPathQuest = {
  id: "exam",
  name: "The Chunin Exams",
  requiredLevel: 8,
  hidden: false,
  content: {
    objectives: [
      { id: "q1", task: "dialog", description: "<b>What tag</b>  heals?" },
      { id: "q2", task: "win_quest" },
    ] as never,
  },
};

describe("buildGeninPath", () => {
  it("steps through every level to the exam, each exam objective, then Chunin", () => {
    const { steps } = buildGeninPath([tutorial, exam], TUTORIAL_ID);
    expect(steps.map((step) => step.label)).toEqual([
      "Lv 5",
      "Lv 6",
      "Lv 7",
      "Lv 8+",
      "Exam 1",
      "Exam 2",
      "Chunin",
    ]);
    expect(steps[0]?.description).toBe("Graduated to Genin at level 5");
    expect(steps[4]?.description).toBe(
      "The Chunin Exams objective 1 (dialog): What tag heals?",
    );
  });

  it("places players by level below the exam and by objectives done at it", () => {
    const { stepOf } = buildGeninPath([tutorial, exam], TUTORIAL_ID);
    expect(stepOf({ level: 5, rank: "GENIN", examGoalsDone: 0 })).toBe(0);
    expect(stepOf({ level: 7, rank: "GENIN", examGoalsDone: 0 })).toBe(2);
    expect(stepOf({ level: 9, rank: "GENIN", examGoalsDone: 0 })).toBe(3);
    expect(stepOf({ level: 9, rank: "GENIN", examGoalsDone: 1 })).toBe(4);
    // Objectives done beyond the exam's length never pass the promotion step.
    expect(stepOf({ level: 9, rank: "GENIN", examGoalsDone: 5 })).toBe(5);
    expect(stepOf({ level: 9, rank: "CHUNIN", examGoalsDone: 0 })).toBe(6);
    expect(stepOf({ level: 40, rank: "ELITE JONIN", examGoalsDone: 0 })).toBe(6);
  });

  it("ignores hidden Chunin quests and falls back to the Genin level cap", () => {
    const { steps } = buildGeninPath(
      [tutorial, { ...exam, hidden: true }],
      TUTORIAL_ID,
    );
    const cap = USER_CAPS.GENIN.LVL_CAP;
    expect(steps.at(-2)?.label).toBe(`Lv ${cap}+`);
    expect(steps.at(-1)?.label).toBe("Chunin");
    expect(steps).toHaveLength(cap - 5 + 2);
  });
});

describe("isStalledPlayer", () => {
  const now = new Date("2026-11-21T12:00:00Z");
  const daysAgo = (days: number) =>
    new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  it("uses the latest of the known activity times", () => {
    const old = daysAgo(RECRUITMENT_STALLED_AFTER_DAYS + 1);
    expect(isStalledPlayer([old, null, undefined], now)).toBe(true);
    expect(isStalledPlayer([old, daysAgo(1).toISOString()], now)).toBe(false);
  });

  it("counts a player without any activity as stopped", () => {
    expect(isStalledPlayer([null, undefined], now)).toBe(true);
  });
});
