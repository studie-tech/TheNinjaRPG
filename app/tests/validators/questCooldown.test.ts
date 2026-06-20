import { describe, expect, it } from "vitest";
import { QuestValidator } from "@/validators/objectives";

// Minimal valid quest body shared by the cases below. `maxCompletes` and
// `retryDelay` are overridden per-case to exercise the #1348 editor guard.
const baseQuest = {
  name: "Test Mission",
  description: "desc",
  successDescription: "done",
  questType: "mission" as const,
  content: { objectives: [], reward: {}, sceneBackground: "", sceneCharacters: [] },
  hidden: false,
  consecutiveObjectives: false,
  endsAt: null,
  startsAt: null,
  tierLevel: null,
};

describe("QuestValidator — #1348 maxCompletes/retryDelay guard", () => {
  it("rejects maxCompletes < 1 when retryDelay is a real period (weekly)", () => {
    const res = QuestValidator.safeParse({
      ...baseQuest,
      retryDelay: "weekly",
      maxCompletes: 0,
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path.includes("maxCompletes"))).toBe(true);
    }
  });

  it("accepts maxCompletes >= 1 with a real period", () => {
    const res = QuestValidator.safeParse({
      ...baseQuest,
      retryDelay: "weekly",
      maxCompletes: 1,
    });
    expect(res.success).toBe(true);
  });

  it("allows maxCompletes 0 when retryDelay is 'none' (uncapped is intentional)", () => {
    const res = QuestValidator.safeParse({
      ...baseQuest,
      retryDelay: "none",
      maxCompletes: 0,
    });
    expect(res.success).toBe(true);
  });

  it("allows maxCompletes 0 when retryDelay is omitted", () => {
    const res = QuestValidator.safeParse({ ...baseQuest, maxCompletes: 0 });
    expect(res.success).toBe(true);
  });
});
