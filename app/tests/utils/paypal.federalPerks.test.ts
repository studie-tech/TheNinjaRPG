import { describe, expect, it } from "bun:test";
import type { FederalStatus } from "@/drizzle/constants";
import type { UserData } from "@/drizzle/schema";
import { getFreeBloodlineSwaps } from "@/libs/bloodline";
import { getFreeTransfers } from "@/libs/jutsu";
import { getFreeResetAmount } from "@/libs/skillReset";
import {
  calcFedUgradeCost,
  fedItemLoadouts,
  fedJutsuLoadouts,
  fedStatusRepsCost,
} from "@/utils/paypal";
import { calcBankInterest } from "@/utils/village";

const TIERS: FederalStatus[] = ["NONE", "NORMAL", "SILVER", "GOLD"];

const member = (federalStatus: FederalStatus, staffAccount = false) => ({
  federalStatus,
  staffAccount,
});

describe("federal tier perks", () => {
  it("adds the tier's jutsu and item loadouts to the base", () => {
    expect(TIERS.map((tier) => fedJutsuLoadouts(member(tier)))).toEqual([2, 3, 4, 5]);
    expect(TIERS.map((tier) => fedItemLoadouts(member(tier)))).toEqual([2, 3, 4, 5]);
    expect(fedJutsuLoadouts()).toBe(2);
    expect(fedItemLoadouts()).toBe(2);
    expect(fedJutsuLoadouts(member("NONE", true))).toBe(5);
    expect(fedItemLoadouts(member("NONE", true))).toBe(5);
  });

  it("prices each paid tier in reputation and rejects the free tier", () => {
    expect(fedStatusRepsCost("NORMAL")).toBe(15);
    expect(fedStatusRepsCost("SILVER")).toBe(35);
    expect(fedStatusRepsCost("GOLD")).toBe(50);
    expect(() => fedStatusRepsCost("NONE")).toThrow("Invalid federal status");
  });

  it("prices only upward tier upgrades", () => {
    const costs = TIERS.map((from) => TIERS.map((to) => calcFedUgradeCost(from, to)));
    expect(costs).toEqual([
      [null, null, null, null],
      [null, null, 20, 40],
      [null, null, null, 20],
      [null, null, null, null],
    ]);
  });

  it("adds the tier's bank interest to the structure factor", () => {
    for (const [boost, factor] of [
      [0, 1],
      [1, 1],
      [5, 1.4],
      [11, 2],
    ] as const) {
      expect(calcBankInterest(boost)).toBe(factor);
      expect(TIERS.map((tier) => calcBankInterest(boost, member(tier)))).toEqual([
        factor,
        factor + 2,
        factor + 5,
        factor + 8,
      ]);
      expect(calcBankInterest(boost, member("NONE", true))).toBe(factor + 8);
    }
  });

  it("grants monthly skill tree resets per tier", () => {
    const resets = TIERS.map((tier) => getFreeResetAmount(member(tier) as UserData));
    expect(resets).toEqual([1, 1, 1, 2]);
    expect(getFreeResetAmount(member("NONE", true) as UserData)).toBe(2);
  });

  it("keys free bloodline swaps and jutsu transfers by the stored status", () => {
    expect(TIERS.map(getFreeBloodlineSwaps)).toEqual([0, 0, 0, 1]);
    expect(TIERS.map(getFreeTransfers)).toEqual([2, 3, 4, 5]);
  });
});
