import { describe, expect, it } from "bun:test";
import { applySingleEffect } from "@/libs/combat/process";
import type { GroundEffect } from "@/libs/combat/types";
import { makeBattleUser, makeCompleteBattle, makeEffect } from "./helpers/battleScenario";

describe("applySingleEffect lifecycle visuals", () => {
  it.each([
    [0, 0],
    [0, 2],
    [2, 0],
  ])("plays the disappear animation for an expired effect at [%i, %i]", (longitude, latitude) => {
    const caster = makeBattleUser("caster", { longitude, latitude });
    const battle = makeCompleteBattle({ usersState: [caster], round: 3 });
    const effect = makeEffect(
      "increasestat",
      { rounds: 0, generalTypes: ["Strength"], power: 10, disappearAnimation: "smoke" },
      {
        creatorId: "caster",
        targetId: "caster",
        isNew: false,
        castThisRound: false,
        createdRound: 1,
        targetType: "user",
      },
    );
    const newGroundEffects: GroundEffect[] = [];
    applySingleEffect(
      {
        consequences: new Map(),
        newUsersState: structuredClone(battle.usersState),
        newUsersEffects: [],
        newGroundEffects,
        actionEffects: [],
        appliedEffects: new Set(),
        battle,
        actorId: "caster",
      },
      effect,
    );
    expect(newGroundEffects).toHaveLength(1);
    expect(newGroundEffects[0]).toMatchObject({
      type: "visual",
      appearAnimation: "smoke",
      longitude,
      latitude,
    });
  });
});
