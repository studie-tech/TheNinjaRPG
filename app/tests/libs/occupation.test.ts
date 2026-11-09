import { describe, expect, it } from "bun:test";
import { OCCUPATION_CHANGE_COOLDOWN_DAYS } from "@/drizzle/constants";
import {
  getOccupationChangeAvailableAt,
  getOccupationChangeDaysRemaining,
} from "@/libs/occupation";
import { DAY_S } from "@/utils/time";

describe("Occupation change cooldown", () => {
  const signupAt = new Date("2026-01-01T00:00:00Z");
  const after = (days: number) => new Date(signupAt.getTime() + days * DAY_S * 1000);

  it("ends a whole number of days after signup", () => {
    expect(getOccupationChangeAvailableAt(signupAt)).toEqual(
      after(OCCUPATION_CHANGE_COOLDOWN_DAYS),
    );
  });

  it("counts a started day and reaches zero exactly at the end", () => {
    const days = OCCUPATION_CHANGE_COOLDOWN_DAYS;
    expect(getOccupationChangeDaysRemaining(signupAt, signupAt)).toBe(days);
    expect(getOccupationChangeDaysRemaining(signupAt, after(0.5))).toBe(days);
    expect(getOccupationChangeDaysRemaining(signupAt, after(days - 0.5))).toBe(1);
    expect(getOccupationChangeDaysRemaining(signupAt, after(days))).toBe(0);
    expect(getOccupationChangeDaysRemaining(signupAt, after(days + 1))).toBe(0);
  });
});
