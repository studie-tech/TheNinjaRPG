import { afterEach, describe, expect, it } from "bun:test";
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
  getQueueWaitingSlots,
  hasGoldPerks,
  isRepsFederalStatus,
  plan2FedStatus,
} from "@/utils/paypal";
import { calcBankInterest } from "@/utils/village";
import { stripePurchaseSchema } from "@/validators/stripe";

const TIERS: FederalStatus[] = ["NONE", "NORMAL", "SILVER", "GOLD", "DIAMOND"];

const member = (federalStatus: FederalStatus, staffAccount = false) => ({
  federalStatus,
  staffAccount,
});

describe("federal tier perks", () => {
  it("adds the tier's jutsu and item loadouts to the base", () => {
    expect(TIERS.map((tier) => fedJutsuLoadouts(member(tier)))).toEqual([
      2, 3, 4, 5, 6,
    ]);
    expect(TIERS.map((tier) => fedItemLoadouts(member(tier)))).toEqual([2, 3, 4, 5, 6]);
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
    expect(() => fedStatusRepsCost("DIAMOND")).toThrow("only available as a PayPal");
  });

  it("sells Diamond only as a PayPal subscription", () => {
    expect(TIERS.map(isRepsFederalStatus)).toEqual([false, true, true, true, false]);
    expect(
      stripePurchaseSchema.safeParse({ type: "federal", federalStatus: "DIAMOND" })
        .success,
    ).toBe(false);
    expect(
      stripePurchaseSchema.safeParse({ type: "federal", federalStatus: "GOLD" })
        .success,
    ).toBe(true);
  });

  it("gives Diamond every Gold-only perk", () => {
    expect(TIERS.map(hasGoldPerks)).toEqual([false, false, false, true, true]);
    expect(TIERS.map((tier) => getQueueWaitingSlots(member(tier)))).toEqual([
      1, 2, 3, 4, 5,
    ]);
    // Staff keep Gold's allowances rather than Diamond's.
    expect(getQueueWaitingSlots(member("NONE", true))).toBe(4);
  });

  it("prices only upward tier upgrades", () => {
    const costs = TIERS.map((from) => TIERS.map((to) => calcFedUgradeCost(from, to)));
    expect(costs).toEqual([
      [null, null, null, null, null],
      [null, null, 20, 40, null],
      [null, null, null, 20, null],
      [null, null, null, null, null],
      [null, null, null, null, null],
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
        factor + 8,
      ]);
      expect(calcBankInterest(boost, member("NONE", true))).toBe(factor + 8);
    }
  });

  it("grants monthly skill tree resets per tier", () => {
    const resets = TIERS.map((tier) => getFreeResetAmount(member(tier) as UserData));
    expect(resets).toEqual([1, 1, 1, 2, 2]);
    expect(getFreeResetAmount(member("NONE", true) as UserData)).toBe(2);
  });

  it("keys free bloodline swaps and jutsu transfers by the stored status", () => {
    expect(TIERS.map(getFreeBloodlineSwaps)).toEqual([0, 0, 0, 1, 1]);
    expect(TIERS.map(getFreeTransfers)).toEqual([2, 3, 4, 5, 6]);
  });
});

describe("plan2FedStatus", () => {
  const planKeys = [
    "NEXT_PUBLIC_PAYPAL_PLAN_ID_NORMAL",
    "NEXT_PUBLIC_PAYPAL_PLAN_ID_SILVER",
    "NEXT_PUBLIC_PAYPAL_PLAN_ID_GOLD",
    "NEXT_PUBLIC_PAYPAL_PLAN_ID_DIAMOND",
  ] as const;
  const saved = Object.fromEntries(planKeys.map((key) => [key, process.env[key]]));
  const setPlans = (diamond: string | undefined) => {
    process.env.NEXT_PUBLIC_PAYPAL_PLAN_ID_NORMAL = "P-NORMAL";
    process.env.NEXT_PUBLIC_PAYPAL_PLAN_ID_SILVER = "P-SILVER";
    process.env.NEXT_PUBLIC_PAYPAL_PLAN_ID_GOLD = "P-GOLD";
    if (diamond === undefined) delete process.env.NEXT_PUBLIC_PAYPAL_PLAN_ID_DIAMOND;
    else process.env.NEXT_PUBLIC_PAYPAL_PLAN_ID_DIAMOND = diamond;
  };
  afterEach(() => {
    for (const key of planKeys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("maps each configured plan id to its tier", () => {
    setPlans("P-DIAMOND");
    expect(
      ["P-NORMAL", "P-SILVER", "P-GOLD", "P-DIAMOND", "P-OTHER"].map(plan2FedStatus),
    ).toEqual(["NORMAL", "SILVER", "GOLD", "DIAMOND", "NONE"]);
  });

  it("maps nothing to Diamond while its plan id is unset or empty", () => {
    for (const diamond of [undefined, ""]) {
      setPlans(diamond);
      expect(plan2FedStatus("")).toBe("NONE");
      expect(plan2FedStatus("P-DIAMOND")).toBe("NONE");
      expect(plan2FedStatus("P-GOLD")).toBe("GOLD");
    }
  });
});
