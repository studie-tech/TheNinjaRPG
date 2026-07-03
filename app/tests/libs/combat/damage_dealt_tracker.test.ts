import { describe, expect, it } from "vitest";
import { isOpponentDamageTarget } from "@/libs/combat/util";
import { makeBattleUser } from "./helpers/battleScenario";

describe("isOpponentDamageTarget (damage attribution)", () => {
  it("is true for a real opposing-side opponent", () => {
    const attacker = makeBattleUser("attacker"); // direction left
    const defender = makeBattleUser("defender"); // direction right
    expect(isOpponentDamageTarget(attacker, defender)).toBe(true);
  });

  it("is false for self, summons, and same-side users", () => {
    const attacker = makeBattleUser("attacker");
    expect(isOpponentDamageTarget(attacker, attacker)).toBe(false);

    const enemySummon = makeBattleUser("summon", { direction: "right", isSummon: true });
    expect(isOpponentDamageTarget(attacker, enemySummon)).toBe(false);

    const ally = makeBattleUser("ally", { direction: "left" });
    expect(isOpponentDamageTarget(attacker, ally)).toBe(false);
  });
});
