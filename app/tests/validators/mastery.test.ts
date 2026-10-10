import { describe, expect, it } from "bun:test";
import { MASTERY_REQUIREMENT_FIELDS } from "@/libs/mastery";
import { masteryQuestTemplates } from "@/libs/masteryQuests";
import { QuestValidator } from "@/validators/objectives";

describe("quest earned-mastery prerequisites", () => {
  const template = masteryQuestTemplates()[0]!;

  it.each(MASTERY_REQUIREMENT_FIELDS)(
    "normalizes blank %s prerequisites for SQL",
    (field) => {
      for (const value of [undefined, null, ""]) {
        const parsed = QuestValidator.parse({ ...template, [field]: value });
        expect(parsed[field]).toBeNull();
      }
      expect(QuestValidator.parse({ ...template, [field]: "500000" })[field]).toBe(
        500000,
      );
    },
  );

  it.each(MASTERY_REQUIREMENT_FIELDS)(
    "rejects fractional %s instead of silently rounding its SQL minimum",
    (field) => {
      expect(QuestValidator.safeParse({ ...template, [field]: 500000.5 }).success).toBe(
        false,
      );
    },
  );
});
