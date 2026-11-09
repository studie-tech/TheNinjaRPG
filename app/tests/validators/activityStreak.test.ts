import { describe, expect, it } from "bun:test";
import { claimStreakDaySchema } from "@/validators/activityStreak";

const firstIssue = (result: { error?: { issues: { message: string }[] } }) =>
  result.error?.issues[0]?.message;

describe("claimStreakDaySchema", () => {
  it("defaults both flags to false and rejects null", () => {
    expect(claimStreakDaySchema.parse({ configId: "a" })).toEqual(
      expect.objectContaining({ payCatchUp: false, reset: false }),
    );
    expect(
      claimStreakDaySchema.parse({ configId: "a", payCatchUp: undefined, reset: true }),
    ).toEqual(expect.objectContaining({ payCatchUp: false, reset: true }));
    expect(
      firstIssue(claimStreakDaySchema.safeParse({ configId: "a", payCatchUp: null })),
    ).toBe("Invalid input: expected boolean, received null");
    expect(
      firstIssue(claimStreakDaySchema.safeParse({ configId: "a", reset: null })),
    ).toBe("Invalid input: expected boolean, received null");
  });
});
