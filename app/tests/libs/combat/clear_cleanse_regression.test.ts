import { describe, expect, it, vi } from "vitest";

import { battleScenario } from "./helpers/battleScenario";

describe("Clear/Cleanse damage modifier regressions", () => {
  it("clear removes temporary DR but preserves village DR and base DR", () => {
    const scenario = battleScenario()
      .addEffect(
        "decreasedamagetaken",
        { power: 15, rounds: 10, calculation: "percentage" },
        {
          id: "village-dr",
          targetId: "defender",
          fromType: "village",
        },
      )
      .addEffect(
        "decreasedamagetaken",
        { power: 25, rounds: 10, calculation: "percentage" },
        {
          id: "jutsu-dr",
          targetId: "defender",
          fromType: "jutsu",
        },
      );

    scenario.clearPositive("defender");

    expect(scenario.getEffect("village-dr").rounds).toBe(10);
    expect(scenario.getEffect("jutsu-dr").rounds).toBe(0);

    const noStatusDamage = battleScenario().computeDamage();
    const villageOnlyDamage = battleScenario()
      .addEffect(
        "decreasedamagetaken",
        { power: 15, rounds: 10, calculation: "percentage" },
        {
          id: "village-dr",
          targetId: "defender",
          fromType: "village",
        },
      )
      .computeDamage();

    expect(scenario.computeDamage()).toBeCloseTo(villageOnlyDamage, 10);
    expect(scenario.computeDamage()).toBeLessThan(noStatusDamage);
  });

  it("cleanse removes temporary damage-taken debuffs but preserves village debuffs", () => {
    const scenario = battleScenario()
      .addEffect(
        "increasedamagetaken",
        { power: 15, rounds: 10, calculation: "percentage" },
        {
          id: "village-inc-taken",
          targetId: "defender",
          fromType: "village",
        },
      )
      .addEffect(
        "increasedamagetaken",
        { power: 25, rounds: 10, calculation: "percentage" },
        {
          id: "jutsu-inc-taken",
          targetId: "defender",
          fromType: "jutsu",
        },
      );

    scenario.cleanseNegative("defender");

    expect(scenario.getEffect("village-inc-taken").rounds).toBe(10);
    expect(scenario.getEffect("jutsu-inc-taken").rounds).toBe(0);

    const noStatusDamage = battleScenario().computeDamage();
    const villageOnlyDamage = battleScenario()
      .addEffect(
        "increasedamagetaken",
        { power: 15, rounds: 10, calculation: "percentage" },
        {
          id: "village-inc-taken",
          targetId: "defender",
          fromType: "village",
        },
      )
      .computeDamage();

    expect(scenario.computeDamage()).toBeCloseTo(villageOnlyDamage, 10);
    expect(scenario.computeDamage()).toBeGreaterThan(noStatusDamage);
  });
});
