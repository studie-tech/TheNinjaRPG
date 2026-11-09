import { describe, expect, it } from "bun:test";
import { z } from "zod";
import {
  AllTags,
  activityBonusPowerLabel,
  activityBonusTypes,
  BloodlineValidator,
  DecreaseCookingTime,
  DecreaseCraftingTime,
  DecreaseFarmingTime,
  DecreaseGatheringTime,
  IncreaseHuntingYield,
  IncreaseGatheringYield,
  rejectActivityBonuses,
  SkillTreeValidator,
} from "@/validators/combat";

describe("activity tag contracts", () => {
  for (const schema of [
    DecreaseGatheringTime,
    DecreaseFarmingTime,
    DecreaseCraftingTime,
    DecreaseCookingTime,
    IncreaseHuntingYield,
    IncreaseGatheringYield,
  ]) {
    const name = schema.parse({}).type;
    const isYield =
      name === "increasehuntingyield" || name === "increasegatheringyield";
    const calculation = isYield ? "static" : "percentage";
    it(`${name} stores power and self-only calculation defaults`, () => {
      expect(AllTags.parse({ type: name, power: 10 })).toMatchObject({
        type: name,
        power: 10,
        powerPerLevel: 0,
        calculation,
        target: "SELF",
      });
      expect(schema.safeParse({ power: 0 }).success).toBe(true);
      expect(schema.safeParse({ power: 0.5 }).success).toBe(!isYield);
      const maximum = isYield ? 20 : 60;
      expect(schema.safeParse({ power: maximum }).success).toBe(true);
      expect(schema.safeParse({ power: maximum + 1 }).success).toBe(false);
    });
    it(`${name} rejects scaling and combat controls`, () => {
      for (const patch of [
        { power: -1 },
        { power: Infinity },
        { power: NaN },
        { power: -Infinity },
        { powerPerLevel: 1 },
        { powerPerLevel: -1 },
        { calculation: isYield ? "percentage" : "static" },
        { target: "INHERIT" },
        { rounds: 1 },
        { rounds: 0 },
        { friendlyFire: "ENEMIES" },
      ]) {
        expect(schema.safeParse(patch).success).toBe(false);
      }
    });
  }
  it("registers the six correct spellings and rejects the obsolete spelling", () => {
    expect(activityBonusTypes).toHaveLength(6);
    expect(AllTags.safeParse({ type: "decreasescraftingtime" }).success).toBe(false);
  });
  it("rejects unsupported passive sources", () => {
    const effects = [DecreaseGatheringTime.parse({})];
    expect(
      z.array(AllTags).superRefine(rejectActivityBonuses).safeParse(effects).success,
    ).toBe(false);
  });
  it.each(activityBonusTypes)("%s requires an ordinary skill", (type) => {
    const skill = {
      name: "Gatherer",
      image: "",
      description: "Gatherer",
      requiredSkillIds: [],
      costSkillPoints: 1,
      tier: 1,
      pathType: "SKILL",
      effects: [{ type, power: 10 }],
    };
    expect(SkillTreeValidator.safeParse(skill).success).toBe(true);
    expect(
      SkillTreeValidator.safeParse({
        ...skill,
        pathType: "BLOODRIGHT",
        bloodlineId: "bloodline",
      }).success,
    ).toBe(false);
  });
  it("accepts bloodlines and skills and describes power units", () => {
    const effects = [DecreaseGatheringTime.parse({ power: 10 })];
    expect(
      BloodlineValidator.safeParse({
        name: "Gatherer",
        image: "",
        description: "Gatherer",
        rank: "D",
        regenIncrease: 0,
        villageId: null,
        effects,
      }).success,
    ).toBe(true);
    expect(
      SkillTreeValidator.safeParse({
        name: "Gatherer",
        image: "",
        description: "Gatherer",
        requiredSkillIds: [],
        costSkillPoints: 1,
        tier: 1,
        effects,
      }).success,
    ).toBe(true);
    expect(activityBonusPowerLabel(effects[0]!)).toBe("Reduction (%)");
    expect(activityBonusPowerLabel(IncreaseHuntingYield.parse({}))).toBe(
      "Additional quantity per dropped material",
    );
    expect(activityBonusPowerLabel(IncreaseGatheringYield.parse({}))).toBe(
      "Additional quantity per dropped material",
    );
  });
});
