import { describe, expect, it } from "bun:test";
import { decreaseCooldown, increaseCooldown, increaseRange } from "@/libs/combat/tags";
import { makeBattleUser, makeEffect } from "../../setup/combat";

const runtime = {
  creatorId: "target",
  targetId: "target",
  targetType: "user",
  isNew: true,
} as const;

describe("basic action adjustment descriptions", () => {
  it("lists the affected basic actions", () => {
    const effect = makeEffect(
      "increaserange",
      {
        power: 1,
        rounds: 2,
        calculation: "static",
        actionsAffected: ["basicAttack", "basicHeal"],
      },
      runtime,
    );
    const info = increaseRange(effect, [], makeBattleUser("target"));
    expect(info?.txt).toContain("basic actions [basic attack, basic heal] range is");
  });

  it("omits the action list when no actions are named", () => {
    const target = makeBattleUser("target");
    const results = [
      increaseRange(
        makeEffect("increaserange", { power: 1, rounds: 2 }, runtime),
        [],
        target,
      ),
      increaseCooldown(
        makeEffect("increasecooldown", { power: 1, rounds: 2 }, runtime),
        [],
        target,
      ),
      decreaseCooldown(
        makeEffect("decreasecooldown", { power: 1, rounds: 2 }, runtime),
        [],
        target,
      ),
    ];
    for (const info of results) {
      expect(info?.txt).toContain("basic action ");
      expect(info?.txt).not.toContain("undefined");
      expect(info?.txt).not.toContain("[");
    }
  });
});
