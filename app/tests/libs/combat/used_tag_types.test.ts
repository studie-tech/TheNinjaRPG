import { describe, expect, it } from "vitest";
import { applySingleEffect } from "@/libs/combat/process";
import { makeBattleUser, makeEffect } from "./helpers/battleScenario";
import type {
  ActionEffect,
  CompleteBattle,
  Consequence,
  GroundEffect,
  UserEffect,
} from "@/libs/combat/types";

const makeStun = (): UserEffect =>
  makeEffect(
    "stun",
    { power: 100, rounds: 2 },
    {
      id: "stun-1",
      creatorId: "attacker",
      targetId: "defender",
      // realizeTag stamps targetType="user" on every realized tag in real combat; the
      // resolution branch (process.ts) only tracks user-targeted effects, so mirror that here.
      targetType: "user",
      isNew: true,
      castThisRound: true,
      createdRound: 1,
      actionId: "stun-action",
    },
  );

const runResolution = (
  newUsersState: ReturnType<typeof makeBattleUser>[],
  effect: UserEffect,
  appliedEffects = new Set<string>(),
  actorId = "attacker",
) => {
  const battle = {
    id: "battle-1",
    battleType: "COMBAT",
    round: 1,
    usersState: newUsersState,
    usersEffects: [effect],
    groundEffects: [],
    extraState: {},
  } as unknown as CompleteBattle;

  applySingleEffect(
    new Map<string, Consequence>(),
    newUsersState,
    [] as UserEffect[],
    [] as GroundEffect[],
    [] as ActionEffect[],
    appliedEffects,
    battle,
    actorId,
    effect,
  );
};

describe("usedTagTypes resolution tracking", () => {
  it("records an applied tag type on the caster", () => {
    const attacker = makeBattleUser("attacker");
    const defender = makeBattleUser("defender");
    runResolution([attacker, defender], makeStun());
    expect(attacker.usedTagTypes).toContain("stun");
  });

  it("dedupes a tag re-applied across rounds", () => {
    const attacker = makeBattleUser("attacker");
    const defender = makeBattleUser("defender");
    const applied = new Set<string>();
    runResolution([attacker, defender], makeStun(), applied);
    runResolution([attacker, defender], makeStun(), applied);
    expect(attacker.usedTagTypes.filter((t) => t === "stun")).toHaveLength(1);
  });

  it("credits a tag applied by a summon to its controller", () => {
    const player = makeBattleUser("attacker");
    const summon = makeBattleUser("summon-1", {
      isSummon: true,
      controllerId: "attacker",
      direction: "left",
    });
    const defender = makeBattleUser("defender");
    const effect = makeEffect(
      "stun",
      { power: 100, rounds: 2 },
      {
        id: "stun-summon",
        creatorId: "summon-1",
        targetId: "defender",
        targetType: "user",
        isNew: true,
        castThisRound: true,
        createdRound: 1,
        actionId: "stun-action",
      },
    );
    runResolution([player, summon, defender], effect, new Set(), "summon-1");
    expect(player.usedTagTypes).toContain("stun");
    expect(summon.usedTagTypes).not.toContain("stun");
  });
});
