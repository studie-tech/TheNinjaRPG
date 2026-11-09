import { describe, expect, it } from "bun:test";
import { BLOODLINE_SWAP_FREE, SKILL_TREE_RESET_FREE } from "@/drizzle/constants";
import {
  dollars2reps,
  fedRepsUnavailableNote,
  freeAllowanceNote,
  reps2dollars,
} from "@/utils/paypal";

describe("reps2dollars / dollars2reps round-trip", () => {
  it("reps2dollars and dollars2reps functions", () => {
    const testRepsValues = [1, 5, 10, 50, 100, 500, 1000];

    testRepsValues.forEach((reps) => {
      const dollars = reps2dollars(reps);
      const calculatedReps = dollars2reps(dollars);
      expect(calculatedReps).toBe(reps);
    });
  });
});

describe("fedRepsUnavailableNote", () => {
  it("explains the current tier to its owner", () => {
    expect(fedRepsUnavailableNote("SILVER", "SILVER", true)).toBe(
      "Your Federal Support is active. You can buy it with reputation points again once it ends.",
    );
  });

  it("does not offer a lower tier as something to buy now", () => {
    expect(fedRepsUnavailableNote("GOLD", "NORMAL", true)).toBe(
      "You have a higher Federal Support tier active. You can buy this tier with reputation points once it ends.",
    );
  });

  it("speaks about the recipient when gifting", () => {
    for (const [current, tier] of [
      ["SILVER", "SILVER"],
      ["GOLD", "NORMAL"],
    ] as const) {
      expect(fedRepsUnavailableNote(current, tier, false)).toBe(
        "This player already has Federal Support. You can buy this tier for them with reputation points once it ends.",
      );
    }
  });

  it("says a recipient's higher tier can only be reached by the recipient", () => {
    expect(fedRepsUnavailableNote("NORMAL", "GOLD", false)).toContain(
      "Only they can upgrade it.",
    );
  });
});

describe("freeAllowanceNote", () => {
  it("names staff before any tier", () => {
    expect(freeAllowanceNote(SKILL_TREE_RESET_FREE, "GOLD", 5, true)).toBe(
      "Free for staff member",
    );
  });

  it("names the tier only beyond the allowance every account gets", () => {
    expect(freeAllowanceNote(SKILL_TREE_RESET_FREE, "NONE", 0, false)).toBe(
      "Free monthly allowance",
    );
    expect(freeAllowanceNote(SKILL_TREE_RESET_FREE, "GOLD", 0, false)).toBe(
      "Free monthly allowance",
    );
    expect(freeAllowanceNote(SKILL_TREE_RESET_FREE, "GOLD", 1, false)).toBe(
      "Free for GOLD supporter",
    );
    expect(freeAllowanceNote(BLOODLINE_SWAP_FREE, "GOLD", 0, false)).toBe(
      "Free for GOLD supporter",
    );
  });
});
