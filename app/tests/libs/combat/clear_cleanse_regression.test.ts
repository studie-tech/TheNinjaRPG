import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => ({
  drizzleDB: {},
}));

import {
  battleScenario,
  makeDamageTakenEffect,
} from "./helpers/battleScenario";

describe("Clear/Cleanse damage modifier regressions", () => {
  it("clear removes temporary DR but preserves village DR and base DR", () => {
    const scenario = battleScenario()
      .addEffect(
        makeDamageTakenEffect({
          id: "village-dr",
          targetId: "defender",
          type: "decreasedamagetaken",
          fromType: "village",
          power: 15,
        }),
      )
      .addEffect(
        makeDamageTakenEffect({
          id: "jutsu-dr",
          targetId: "defender",
          type: "decreasedamagetaken",
          fromType: "jutsu",
          power: 25,
        }),
      );

    scenario.clearPositive("defender");

    expect(scenario.getEffect("village-dr").rounds).toBe(10);
    expect(scenario.getEffect("jutsu-dr").rounds).toBe(0);

    const noStatusDamage = battleScenario().computeDamage();
    const villageOnlyDamage = battleScenario()
      .addEffect(
        makeDamageTakenEffect({
          id: "village-dr",
          targetId: "defender",
          type: "decreasedamagetaken",
          fromType: "village",
          power: 15,
        }),
      )
      .computeDamage();

    expect(scenario.computeDamage()).toBeCloseTo(villageOnlyDamage, 10);
    expect(scenario.computeDamage()).toBeLessThan(noStatusDamage);
  });

  it("cleanse removes temporary damage-taken debuffs but preserves village debuffs", () => {
    const scenario = battleScenario()
      .addEffect(
        makeDamageTakenEffect({
          id: "village-inc-taken",
          targetId: "defender",
          type: "increasedamagetaken",
          fromType: "village",
          power: 15,
        }),
      )
      .addEffect(
        makeDamageTakenEffect({
          id: "jutsu-inc-taken",
          targetId: "defender",
          type: "increasedamagetaken",
          fromType: "jutsu",
          power: 25,
        }),
      );

    scenario.cleanseNegative("defender");

    expect(scenario.getEffect("village-inc-taken").rounds).toBe(10);
    expect(scenario.getEffect("jutsu-inc-taken").rounds).toBe(0);

    const noStatusDamage = battleScenario().computeDamage();
    const villageOnlyDamage = battleScenario()
      .addEffect(
        makeDamageTakenEffect({
          id: "village-inc-taken",
          targetId: "defender",
          type: "increasedamagetaken",
          fromType: "village",
          power: 15,
        }),
      )
      .computeDamage();

    expect(scenario.computeDamage()).toBeCloseTo(villageOnlyDamage, 10);
    expect(scenario.computeDamage()).toBeGreaterThan(noStatusDamage);
  });
});
