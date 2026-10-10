import { describe, expect, it } from "bun:test";
import { applyPoolAdjustmentsToBase, reconcileLobbyPools } from "@/libs/combat/util";
import { makeBattleUser, makeEffect } from "./helpers/battleScenario";

const makePoolUser = () =>
  makeBattleUser("player", {
    maxHealth: 1000,
    maxChakra: 1000,
    maxStamina: 1000,
    curHealth: 1000,
    curChakra: 1000,
    curStamina: 1000,
  });

const poolEffect = (
  power: number,
  creatorId = "player",
  fromType: "skill" | "sageMode" | "sageModeAfter" = "skill",
) =>
  makeEffect(
    power < 0 ? "decreasemaxpools" : "increasemaxpools",
    {
      power: Math.abs(power),
      calculation: "static",
      poolsAffected: ["Health", "Chakra", "Stamina"],
    },
    { creatorId, targetId: "player", fromType },
  );

describe("reconcileLobbyPools", () => {
  it.each([
    {
      name: "own and incoming effects",
      effects: [poolEffect(100), poolEffect(-200, "enemy")],
      value: 900,
      adjustment: -100,
    },
    {
      name: "incoming effects only",
      effects: [poolEffect(-200, "enemy")],
      value: 800,
      adjustment: -200,
    },
    {
      name: "preserved sage effects",
      effects: [poolEffect(300, "player", "sageMode")],
      value: 1300,
      adjustment: 300,
    },
    {
      name: "preserved sage after-effects",
      effects: [poolEffect(-100, "player", "sageModeAfter")],
      value: 900,
      adjustment: -100,
    },
  ])(
    "keeps pools stable after an equivalent swap with $name",
    ({ effects, value, adjustment }) => {
      const original = makePoolUser();
      applyPoolAdjustmentsToBase(original, [...effects]);
      expect(original.curHealth).toBe(value);

      const updated = makePoolUser();
      reconcileLobbyPools(updated, original, [...effects]);
      expect([updated.curHealth, updated.curChakra, updated.curStamina]).toEqual([
        value,
        value,
        value,
      ]);
      expect([
        updated._prevHealthAdj,
        updated._prevChakraAdj,
        updated._prevStaminaAdj,
      ]).toEqual([adjustment, adjustment, adjustment]);

      applyPoolAdjustmentsToBase(updated, [...effects]);
      expect([updated.curHealth, updated.curChakra, updated.curStamina]).toEqual([
        value,
        value,
        value,
      ]);
    },
  );

  it("clamps to the complete maximum when a swap removes an own buff", () => {
    const original = makePoolUser();
    const incoming = poolEffect(-200, "enemy");
    applyPoolAdjustmentsToBase(original, [poolEffect(100), incoming]);
    const updated = makePoolUser();
    reconcileLobbyPools(updated, original, [incoming]);
    expect([updated.curHealth, updated.curChakra, updated.curStamina]).toEqual([
      800, 800, 800,
    ]);
    applyPoolAdjustmentsToBase(updated, [incoming]);
    expect(updated.curHealth).toBe(800);
  });

  it("does not refill depleted pools when a swap adds a buff", () => {
    const original = makePoolUser();
    original.curHealth = 0;
    original.curChakra = 100;
    original.curStamina = 0;
    const updated = makePoolUser();
    const effects = [poolEffect(100)];
    reconcileLobbyPools(updated, original, [...effects]);
    applyPoolAdjustmentsToBase(updated, [...effects]);
    expect([updated.curHealth, updated.curChakra, updated.curStamina]).toEqual([
      0, 100, 0,
    ]);
  });

  it("clears stale tracking when no pool effects remain without refilling pools", () => {
    const original = makePoolUser();
    applyPoolAdjustmentsToBase(original, [poolEffect(-200)]);
    const updated = { ...original };
    reconcileLobbyPools(updated, original, []);
    expect(updated._prevHealthAdj).toBeUndefined();
    expect(updated._prevChakraAdj).toBeUndefined();
    expect(updated._prevStaminaAdj).toBeUndefined();
    applyPoolAdjustmentsToBase(updated, []);
    expect([updated.curHealth, updated.curChakra, updated.curStamina]).toEqual([
      800, 800, 800,
    ]);
  });
});
