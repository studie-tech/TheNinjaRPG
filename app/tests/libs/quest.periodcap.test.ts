// app/tests/libs/quest.periodcap.test.ts
import { describe, it, expect } from "vitest";
import { isAvailableUserQuests, periodCapReached } from "@/libs/quest";

const NOW = new Date("2026-06-19T12:00:00Z"); // Fri; week start Mon 2026-06-15

describe("periodCapReached", () => {
  it("none → never capped", () => {
    expect(periodCapReached({ retryDelay: "none", maxCompletes: 1, periodCompletes: 99, periodStartAt: NOW }, NOW)).toBe(false);
  });
  it("maxCompletes<=0 with a real retry period fails closed", () => {
    expect(periodCapReached({ retryDelay: "weekly", maxCompletes: 0, periodCompletes: 5, periodStartAt: NOW }, NOW)).toBe(true);
  });
  it("weekly, completes in current period >= max → capped", () => {
    expect(periodCapReached({ retryDelay: "weekly", maxCompletes: 1, periodCompletes: 1, periodStartAt: new Date("2026-06-15T00:00:00Z") }, NOW)).toBe(true);
  });
  it("weekly, completes from a PRIOR period → not capped (stale count ignored)", () => {
    expect(periodCapReached({ retryDelay: "weekly", maxCompletes: 1, periodCompletes: 5, periodStartAt: new Date("2026-06-08T00:00:00Z") }, NOW)).toBe(false);
  });
  it("null periodStartAt → not capped", () => {
    expect(periodCapReached({ retryDelay: "daily", maxCompletes: 1, periodCompletes: 0, periodStartAt: null }, NOW)).toBe(false);
  });
});

describe("isAvailableUserQuests — period cap vs lifetime cap", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const priorPeriod = new Date(Date.now() - 2 * DAY);

  // Minimal user that clears every non-completion gate (no rank/village/level requirements).
  const user = {
    role: "USER",
    rank: "STUDENT",
    villageId: "v1",
    isOutlaw: false,
    bloodlineId: null,
    level: 50,
    medicalExperience: 0,
    huntingExperience: 0,
    gatheringExperience: 0,
    completedQuests: [],
  } as never;

  // event ∈ QuestTypesWithMaxAttempts, so the lifetime cap (eventCompletedCheck) applies.
  const repeatable = {
    hidden: false,
    maxAttempts: 100,
    maxCompletes: 1,
    questType: "event",
    requiredVillage: null,
    retryDelay: "daily",
  } as const;

  it("repeatable quest is available in a new period despite lifetime completes >= maxCompletes", () => {
    // Regression: lifetime previousCompletes(1) >= maxCompletes(1), but the only completion was
    // a prior period — the period cap should govern, not the lifetime cap.
    expect(
      isAvailableUserQuests(
        { ...repeatable, previousCompletes: 1, periodCompletes: 1, periodStartAt: priorPeriod },
        user,
      ).check,
    ).toBe(true);
  });

  it("repeatable quest is still capped within the current period", () => {
    expect(
      isAvailableUserQuests(
        { ...repeatable, previousCompletes: 1, periodCompletes: 1, periodStartAt: new Date() },
        user,
      ).check,
    ).toBe(false);
  });

  it("one-shot quest (retryDelay none) keeps its lifetime cap", () => {
    expect(
      isAvailableUserQuests(
        { ...repeatable, retryDelay: "none", previousCompletes: 1 },
        user,
      ).check,
    ).toBe(false);
  });

  it("does not expose a quest before its configured start date", () => {
    expect(
      isAvailableUserQuests(
        { ...repeatable, startsAt: "2999-01-01T00:00:00.000Z" },
        user,
      ),
    ).toMatchObject({ check: false, message: expect.stringContaining("future") });
  });

  it("allows a quest after its configured start date", () => {
    expect(
      isAvailableUserQuests(
        { ...repeatable, startsAt: "2000-01-01T00:00:00.000Z" },
        user,
      ).check,
    ).toBe(true);
  });

  it("allows a quest before its end date and rejects it afterwards", () => {
    expect(
      isAvailableUserQuests(
        { ...repeatable, endsAt: "2999-01-01T00:00:00.000Z" },
        user,
      ).check,
    ).toBe(true);
    expect(
      isAvailableUserQuests(
        { ...repeatable, endsAt: "2000-01-01T00:00:00.000Z" },
        user,
      ).check,
    ).toBe(false);
  });
});
