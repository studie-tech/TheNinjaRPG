import { describe, expect, it } from "bun:test";
import { FED_BANK_INTEREST } from "@/drizzle/constants";
import { calcBankInterest } from "@/utils/village";

describe("bank interest rate", () => {
  it.each([
    [0, "NONE", false, 1],
    [0, "NORMAL", false, 1 + FED_BANK_INTEREST.NORMAL],
    [0, "SILVER", false, 1 + FED_BANK_INTEREST.SILVER],
    [0, "GOLD", false, 1 + FED_BANK_INTEREST.GOLD],
    [0, "NONE", true, 1 + FED_BANK_INTEREST.GOLD],
    [5, "NONE", false, 1.4],
    [5, "NORMAL", false, 1.4 + FED_BANK_INTEREST.NORMAL],
  ] as const)(
    "adds the federal bonus in percentage points (boost %d, %s, staff %p)",
    (boost, federalStatus, staffAccount, percent) => {
      expect(calcBankInterest(boost, { federalStatus, staffAccount })).toBeCloseTo(
        percent,
      );
    },
  );

  it("returns the base rate without a user", () => {
    expect(calcBankInterest(5)).toBeCloseTo(1.4);
  });
});
