import { describe, expect, it } from "bun:test";
import { HUNTING_REQUIRED_EXP } from "@/drizzle/constants";
import { isBotIdProtectedProcedure } from "@/libs/botid";
import { huntingAllowance, huntingEligibility, huntingVictoryReceipt } from "@/libs/hunting/contracts";
import { huntingHabitatSchema } from "@/validators/hunting";
import { huntingBattleState, huntingContract, huntingHabitatContent } from "../../setup/hunting";

describe("Hunting contract rules", () => {
  it("requires Hunter and unlocks each target using existing hunting experience", () => {
    const c = { ...huntingContract(), rank: "C RANK" as const };
    expect(huntingEligibility("HUNTER", HUNTING_REQUIRED_EXP["C RANK"] - 1, c)).toBe(false);
    expect(huntingEligibility("HUNTER", HUNTING_REQUIRED_EXP["C RANK"], c)).toBe(true);
    expect(huntingEligibility("CRAFTING", 1e8, c)).toBe(false);
  });
  it("preserves partial allowances and resets only when the cooldown expires", () => {
    const c = huntingContract();
    expect(huntingAllowance(c, { used: 2, cooldownUntil: null }, 1000).remaining).toBe(1);
    expect(huntingAllowance(c, { used: 3, cooldownUntil: new Date(1001) }, 1000)).toEqual({ used: 3, cooling: true, remaining: 0 });
    expect(huntingAllowance(c, { used: 3, cooldownUntil: new Date(1000) }, 1000)).toEqual({ used: 0, cooling: false, remaining: 3 });
  });
  it("guarantees materials, rolls independent bonuses and starts cooldown on the final victory", () => {
    const state = { ...huntingBattleState(), used: 2 };
    const receipt = huntingVictoryReceipt(state, "battle", "Won", new Date(1000), () => 0.1);
    expect(receipt.materials.map((m) => m.name)).toEqual(["Boar hide", "Boar tusk"]);
    expect(receipt.experience).toBe(50);
    expect(receipt.remaining).toBe(0);
    expect(receipt.cooldownUntil).toBe(new Date(61000).toISOString());
    expect(huntingVictoryReceipt(huntingBattleState(), "battle", "Won").cooldownUntil).toBeNull();
  });
  it.each(["Lost", "Fled", "Draw"] as const)("keeps allowance and grants no completion rewards on %s", (outcome) => {
    expect(huntingVictoryReceipt(huntingBattleState(), "battle", outcome)).toMatchObject({ experience: 0, totalExperience: 123, remaining: 3, materials: [], cooldownUntil: null });
  });
  it("rejects duplicate contract identities, unapproved locations and missing guaranteed rewards", () => {
    const habitat = huntingHabitatContent();
    expect(huntingHabitatSchema.safeParse({ ...habitat, contracts: [huntingContract(), huntingContract()] }).success).toBe(false);
    expect(huntingHabitatSchema.safeParse({ ...habitat, contracts: [{ ...huntingContract(), sectors: [2] }] }).success).toBe(false);
    expect(huntingHabitatSchema.safeParse({ ...habitat, contracts: [{ ...huntingContract(), rewards: [{ itemId: "hide", quantity: 1, chance: 50 }] }] }).success).toBe(false);
    expect(huntingHabitatSchema.safeParse(habitat).success).toBe(true);
  });
  it("protects encounter starts with BotID", () => expect(isBotIdProtectedProcedure("hunting.start")).toBe(true));
});
