import { describe, expect, it } from "bun:test";
import { getBloodrightRefundIds } from "@/libs/bloodright";
import { getFreeResetAmount, getMonthlyResetState } from "@/server/api/routers/skillTree";
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
  it("counts a claimed reset before its log is written", () => {
    const month = new Date().toISOString().slice(0, 7);
    expect(getMonthlyResetState({ monthlySkillResets: { month, count: 2 } } as UserData, 1).count).toBe(2);
  });
  it("preserves existing monthly reset logs after migration", () => {
    expect(getMonthlyResetState({ monthlySkillResets: { month: "", count: 0 } } as UserData, 1).count).toBe(1);
  });
  it("starts a new allowance when the month changes", () => {
    expect(getMonthlyResetState({ monthlySkillResets: { month: "2000-01", count: 2 } } as UserData, 0).count).toBe(0);
  });
});
