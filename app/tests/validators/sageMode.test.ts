import { describe, expect, it } from "vitest";
import { SageModeValidator } from "@/validators/combat";

const base = {
  name: "Toad Sage Mode",
  image: "img.webp",
  description: "flavor",
  rank: "D" as const,
  level: 1,
  requiredSageMastery: 0,
  activationRounds: 5,
  afterEffectRounds: 3,
  chakraCostPerc: 20,
  staminaCostPerc: 20,
  villageId: null,
  effects: [],
  afterEffects: [],
  level2Effects: [],
};

describe("SageModeValidator battleDescription", () => {
  it("accepts a per-mode activation message", () => {
    const parsed = SageModeValidator.parse({
      ...base,
      battleDescription: "%user enters Toad Sage Mode!",
    });
    expect(parsed.battleDescription).toBe("%user enters Toad Sage Mode!");
  });

  it("treats the activation message as optional", () => {
    expect(() => SageModeValidator.parse(base)).not.toThrow();
  });
});
