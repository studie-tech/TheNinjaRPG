import { describe, expect, it } from "bun:test";
import type { UserData } from "@/drizzle/schema";
import {
  freeResetNote,
  getFreeResetAmount,
  getMonthlyResetState,
  getResetAllowance,
} from "@/libs/skillReset";

describe("freeResetNote", () => {
  it("counts the remaining shared allowance", () => {
    expect(freeResetNote(false, 2)).toBe("2 free resets remaining");
    expect(freeResetNote(false, 1, "free shared resets")).toBe(
      "1 free shared resets remaining",
    );
  });

  it("checks staff first, since staff resets do not consume the allowance", () => {
    expect(freeResetNote(true, 2)).toBe("Free for staff");
  });

  it("treats a free reset without allowance as a staff reset", () => {
    expect(freeResetNote(false, 0)).toBe("Free for staff");
  });
});

describe("shared monthly reset allowance", () => {
  it.each([
    ["NONE", 1],
    ["NORMAL", 1],
    ["SILVER", 1],
    ["GOLD", 2],
  ] as const)("gives %s supporters %i free resets", (federalStatus, expected) => {
    expect(getFreeResetAmount({ federalStatus, staffAccount: false } as UserData)).toBe(
      expected,
    );
  });
  it("counts the resets persisted for the current month", () => {
    const month = new Date().toISOString().slice(0, 7);
    expect(
      getMonthlyResetState({ monthlySkillResets: { month, count: 2 } } as UserData)
        .count,
    ).toBe(2);
  });
  it("starts a new allowance when the month changes", () => {
    expect(
      getMonthlyResetState({
        monthlySkillResets: { month: "2000-01", count: 2 },
      } as UserData).count,
    ).toBe(0);
  });
});

describe("getResetAllowance", () => {
  const month = getMonthlyResetState({
    monthlySkillResets: null,
  } as unknown as UserData).month;
  const user = (count: number, staffAccount = false) =>
    ({
      federalStatus: "GOLD",
      staffAccount,
      monthlySkillResets: { month, count },
    }) as UserData;

  it("counts a member's free reset against the month", () => {
    expect(getResetAllowance(user(0))).toMatchObject({
      isFree: true,
      isStaff: false,
      used: 0,
      next: { month, count: 1 },
    });
  });

  it("stops being free once the allowance runs out", () => {
    const spent = getFreeResetAmount(user(0));
    expect(getResetAllowance(user(spent))).toMatchObject({
      isFree: false,
      remaining: 0,
    });
  });

  it("keeps staff resets free without drawing on the allowance", () => {
    const spent = getFreeResetAmount(user(0));
    expect(getResetAllowance(user(spent, true))).toMatchObject({
      isFree: true,
      isStaff: true,
      next: { month, count: spent },
    });
  });
});
