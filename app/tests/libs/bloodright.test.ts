import { describe, expect, it } from "bun:test";
import { getBloodrightRefundIds } from "@/libs/bloodright";
import {
  getFreeResetAmount,
  getMonthlyResetState,
  getResetAllowance,
} from "@/server/api/routers/skillTree";
import type { UserData } from "@/drizzle/schema";

const tiers = [
  { id: "root", requiredSkillIds: [] },
  { id: "child", requiredSkillIds: ["root"] },
  { id: "grandchild", requiredSkillIds: ["child"] },
  { id: "other", requiredSkillIds: [] },
];
describe("Bloodright refunds", () => {
  it("removes transitive dependents without removing another branch", () => {
    expect(getBloodrightRefundIds("root", ["root", "child", "grandchild", "other"], tiers)).toEqual(["root", "child", "grandchild"]);
  });
  it("retains ancestors when refunding a leaf", () => {
    expect(getBloodrightRefundIds("grandchild", ["root", "child", "grandchild"], tiers)).toEqual(["grandchild"]);
  });
  it("does not refund tiers the player has never purchased", () => {
    expect(getBloodrightRefundIds("root", ["root", "other"], tiers)).toEqual(["root"]);
  });
  it("allows an unavailable purchased tier to be refunded", () => {
    expect(getBloodrightRefundIds("deleted", ["deleted"], tiers)).toEqual(["deleted"]);
  });
});
describe("shared monthly reset allowance", () => {
  it.each([ ["NONE", 1], ["NORMAL", 1], ["SILVER", 1], ["GOLD", 2] ] as const)("gives %s supporters %i free resets", (federalStatus, expected) => {
    expect(getFreeResetAmount({ federalStatus, staffAccount: false } as UserData)).toBe(expected);
  });
  it("counts the resets persisted for the current month", () => {
    const month = new Date().toISOString().slice(0, 7);
    expect(getMonthlyResetState({ monthlySkillResets: { month, count: 2 } } as UserData).count).toBe(2);
  });
  it("starts a new allowance when the month changes", () => {
    expect(getMonthlyResetState({ monthlySkillResets: { month: "2000-01", count: 2 } } as UserData).count).toBe(0);
  });
});

describe("getResetAllowance", () => {
  const month = getMonthlyResetState({ monthlySkillResets: null } as unknown as UserData).month;
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
    expect(getResetAllowance(user(spent))).toMatchObject({ isFree: false, remaining: 0 });
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
