import { describe, expect, it } from "vitest";
import { SageModeValidator } from "@/validators/combat";

const base = {
  name: "Toad Sage Mode",
  image: "img.webp",
  description: "flavor",
  level: 1,
  requiredSageMastery: 0,
  activationRounds: 5,
  afterEffectRounds: 3,
  chakraCostPerc: 20,
  staminaCostPerc: 20,
  actionCostPerc: 80,
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

  it("rejects level 2 effects when Tier 2 is disabled", () => {
    expect(() =>
      SageModeValidator.parse({
        ...base,
        requiredSageMastery: 0,
        level2Effects: [
          {
            type: "increasestat",
            description: "placeholder",
            target: "SELF",
            direction: "offence",
            calculation: "static",
            power: 1,
            powerPerLevel: 0,
            rounds: 1,
            statTypes: ["Ninjutsu"],
            generalTypes: [],
            staticAssetPath: "",
            staticAnimation: "",
            appearAnimation: "",
            disappearAnimation: "",
            appearSfx: "",
            disappearSfx: "",
          },
        ],
      }),
    ).toThrow();
  });
});
