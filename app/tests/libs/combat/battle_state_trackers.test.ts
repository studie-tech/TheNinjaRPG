import { describe, expect, it } from "vitest";
import { makeBattleUser } from "./helpers/battleScenario";

describe("battle-state tracker fields (#1353)", () => {
  it("initializes usedTagTypes to an empty array and damageDealt to 0", () => {
    const user = makeBattleUser("attacker");
    expect(user.usedTagTypes).toEqual([]);
    expect(user.damageDealt).toBe(0);
  });

  it("lets a scenario override the tracker accumulators", () => {
    const user = makeBattleUser("defender", {
      usedTagTypes: ["stun"],
      damageDealt: 1234,
    });
    expect(user.usedTagTypes).toEqual(["stun"]);
    expect(user.damageDealt).toBe(1234);
  });
});
