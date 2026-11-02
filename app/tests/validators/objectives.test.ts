import { describe, expect, it, setSystemTime } from "bun:test";
import { LetterRanks } from "@/drizzle/constants";
import {
  QuestTracker,
  QuestValidator,
  QuestValidatorRawSchema,
} from "@/validators/objectives";

describe("QuestTracker startAt default", () => {
  it("stamps the time the tracker is parsed", () => {
    try {
      setSystemTime(new Date("2030-01-01T00:00:00.000Z"));
      expect(QuestTracker.parse({ id: "q1" }).startAt).toBe("2030-01-01T00:00:00.000Z");
      setSystemTime(new Date("2030-01-02T00:00:00.000Z"));
      expect(QuestTracker.parse({ id: "q1" }).startAt).toBe("2030-01-02T00:00:00.000Z");
    } finally {
      setSystemTime();
    }
  });
});

describe("QuestValidatorRawSchema requiredSageRank", () => {
  const shape = QuestValidatorRawSchema.shape.requiredSageRank;

  it("parses an empty string (reset button) to null", () => {
    expect(shape.parse("")).toBeNull();
  });

  it("accepts a valid rank", () => {
    expect(shape.parse("MASTER")).toBe("MASTER");
  });

  it("accepts null", () => {
    expect(shape.parse(null)).toBeNull();
  });

  it("accepts undefined", () => {
    expect(shape.parse(undefined)).toBeUndefined();
  });

  it("rejects an invalid rank", () => {
    expect(() => shape.parse("BOGUS")).toThrow();
  });
});

describe("QuestValidator bloodline collections", () => {
  const baseQuest = {
    name: "Collection achievement",
    description: "Collect the selected bloodlines",
    successDescription: "Collection complete",
    questType: "achievement",
    content: { objectives: [], reward: {} },
    hidden: false,
    consecutiveObjectives: false,
    endsAt: null,
    startsAt: null,
    tierLevel: null,
  };
  const objective = { id: "collector", task: "bloodline_collection" };

  it("rejects obsolete editor fields before rank defaults can replace the selection", () => {
    for (const fields of [
      { bloodlineRank: "A" },
      { bloodlineRank: "ALL", excludeSRank: true },
      { excludeSRank: false },
      { bloodlineRanks: ["A"], bloodlineRank: "A" },
    ]) {
      const result = QuestValidator.safeParse({
        ...baseQuest,
        content: {
          ...baseQuest.content,
          objectives: [{ ...objective, ...fields }],
        },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toContainEqual(
          expect.objectContaining({
            code: "unrecognized_keys",
            path: ["content", "objectives", 0],
            message: expect.stringMatching(/reload.*before saving/i),
          }),
        );
      }
    }
  });

  it("preserves selected ranks and valid objective content on quest saves", () => {
    const collection = {
      ...objective,
      bloodlineRanks: ["A", "H"],
      description: "Collect A and H ranks",
      sceneCharacters: ["character"],
      reward_badges: ["badge"],
    };
    const result = QuestValidator.parse({
      ...baseQuest,
      content: { ...baseQuest.content, objectives: [collection] },
    });

    expect(result.content.objectives[0]).toMatchObject(collection);
  });

  it("defaults a newly authored collection to every rank", () => {
    const result = QuestValidator.parse({
      ...baseQuest,
      content: { ...baseQuest.content, objectives: [objective] },
    });

    expect(result.content.objectives[0]).toMatchObject({
      ...objective,
      bloodlineRanks: [...LetterRanks],
    });
  });
});
