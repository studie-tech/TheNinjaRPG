import { describe, expect, it, spyOn } from "bun:test";
import { applyEffects, applySingleEffect } from "@/libs/combat/process";
import type {
  ActionEffect,
  CompleteBattle,
  Consequence,
  GroundEffect,
  UserEffect,
} from "@/libs/combat/types";
import { makeBattleUser, makeCompleteBattle, makeEffect } from "../../setup/combat";

const resolve = (
  battle: CompleteBattle,
  effect: UserEffect,
  resolved: UserEffect[] = [],
) => {
  const users = structuredClone(battle.usersState);
  const consequences = new Map<string, Consequence>();
  const actionEffects: ActionEffect[] = [];
  const groundEffects: GroundEffect[] = [];
  applySingleEffect(
    {
      consequences,
      newUsersState: users,
      newUsersEffects: resolved,
      newGroundEffects: groundEffects,
      actionEffects,
      appliedEffects: new Set(),
      battle,
      actorId: "defender",
    },
    effect,
  );
  return { users, consequences, actionEffects, resolved };
};

const fixture = (effects: UserEffect[]) =>
  makeCompleteBattle({
    round: 5,
    usersState: [
      makeBattleUser("attacker", { money: 0 }),
      makeBattleUser("defender", { money: 1000, curHealth: 100 }),
    ],
    usersEffects: effects,
  });

const runtime = {
  targetType: "user" as const,
  targetId: "defender",
  creatorId: "attacker",
  fromType: "jutsu" as const,
  createdRound: 5,
  isNew: true,
};

describe("effect resolution context", () => {
  it.each(["stealth", "shield"] as const)(
    "does not scan seals or copy prevention context for non-bloodline %s",
    (type) => {
      const effect = makeEffect(
        type,
        { rounds: 10, power: 100 },
        { ...runtime, fromType: "armor" },
      );
      const battle = fixture([effect]);
      const resolved: UserEffect[] = [];
      const filter = spyOn(battle.usersEffects, "filter");
      const map = spyOn(resolved, "map");
      try {
        const result = resolve(battle, effect, resolved);
        expect(result.resolved).toEqual([effect]);
        expect(result.users[0]?.usedTagTypes).toContain(type);
        expect(filter).not.toHaveBeenCalled();
        expect(map).not.toHaveBeenCalled();
      } finally {
        filter.mockRestore();
        map.mockRestore();
      }
    },
  );

  const consumers = [
    ["heal", "healprevent"],
    ["flee", "fleeprevent"],
    ["onehitkill", "onehitkillprevent"],
    ["rob", "robprevent"],
    ["seal", "sealprevent"],
    ["stun", "stunprevent"],
    ["increasestat", "buffprevent"],
    ["decreasestat", "debuffprevent"],
    ["increasemastery", "buffprevent"],
    ["decreasemastery", "debuffprevent"],
    ["increasemaxpools", "buffprevent"],
    ["decreasemaxpools", "debuffprevent"],
  ] as const;

  it.each(consumers)(
    "uses resolved %s prevention in preference to an original with the same ID (%s)",
    (type, preventType) => {
      const original = makeEffect(
        preventType,
        { rounds: 0, power: 0 },
        { ...runtime, id: "protection", createdRound: 1, isNew: false },
      );
      const resolved = { ...original, rounds: 10, power: 100, castThisRound: false };
      const effect = makeEffect(type, { rounds: 5, power: 100 }, runtime);
      const battle = fixture([original, effect]);
      const result = resolve(battle, effect, [resolved]);
      expect(effect.rounds).toBe(0);
      expect(result.actionEffects).toHaveLength(1);
      expect(result.consequences.size).toBe(0);
      expect(result.users[1]?.curHealth).toBe(100);
      expect(result.users[1]?.money).toBe(1000);
      expect(result.users[1]?.fledBattle).toBe(false);
    },
  );

  it.each(["jutsu", "bloodline"] as const)(
    "sees unprocessed seals when resolving healing through a %s prevention",
    (fromType) => {
      const prevent = makeEffect(
        "healprevent",
        { rounds: 10, power: 100 },
        { ...runtime, fromType, createdRound: 1, isNew: false },
      );
      const seal = makeEffect(
        "seal",
        { rounds: 10, power: 100 },
        { ...runtime, createdRound: 1, isNew: false },
      );
      const heal = makeEffect(
        "heal",
        { rounds: 0, power: 50, calculation: "static" },
        runtime,
      );
      const result = resolve(fixture([prevent, seal, heal]), heal, [prevent]);
      expect(result.consequences.size).toBe(fromType === "bloodline" ? 1 : 0);
      expect(prevent.rounds).toBe(10);
    },
  );

  it("rechecks seals after Cleanse restores bloodline prevention in the same action", () => {
    const prevent = makeEffect(
      "healprevent",
      { rounds: 10, power: 100 },
      { ...runtime, fromType: "bloodline", createdRound: 1, isNew: false },
    );
    const seal = makeEffect(
      "seal",
      { rounds: 10, power: 100 },
      { ...runtime, createdRound: 1, isNew: false },
    );
    const cleanse = makeEffect("cleanse", { rounds: 0, power: 100 }, runtime);
    const heal = makeEffect(
      "heal",
      { rounds: 0, power: 50, calculation: "static" },
      runtime,
    );
    const { newBattle } = applyEffects(
      fixture([prevent, seal, cleanse, heal]),
      "defender",
    );
    expect(seal.rounds).toBe(0);
    expect(newBattle.usersState[1]?.curHealth).toBe(100);
    expect(newBattle.usersEffects.some((e) => e.id === prevent.id)).toBe(true);
  });

  it("sees a resolved protection removed by Cleanse before healing", () => {
    const prevent = makeEffect(
      "healprevent",
      { rounds: 10, power: 100 },
      { ...runtime, createdRound: 1, isNew: false },
    );
    const cleanse = makeEffect("cleanse", { rounds: 0, power: 100 }, runtime);
    const heal = makeEffect(
      "heal",
      { rounds: 0, power: 50, calculation: "static" },
      runtime,
    );
    const { newBattle } = applyEffects(fixture([prevent, cleanse, heal]), "defender");
    expect(prevent.rounds).toBe(0);
    expect(newBattle.usersState[1]?.curHealth).toBeGreaterThan(100);
  });
  it("sees a resolved protection removed by Clear before robbery", () => {
    const prevent = makeEffect(
      "robprevent",
      { rounds: 10, power: 100 },
      { ...runtime, createdRound: 1, isNew: false },
    );
    const clear = makeEffect("clear", { rounds: 0, power: 100 }, runtime);
    const robbery = makeEffect(
      "rob",
      { rounds: 5, power: 100, robPercentage: 10 },
      { ...runtime, createdRound: 1, isNew: false },
    );
    const { newBattle } = applyEffects(fixture([prevent, clear, robbery]), "defender");
    expect(prevent.rounds).toBe(0);
    expect(newBattle.usersState[1]?.money).toBe(900);
    expect(newBattle.usersState[0]?.money).toBe(100);
  });
});
