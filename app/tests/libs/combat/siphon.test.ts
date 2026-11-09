import { describe, expect, it } from "bun:test";
import { SHIELD_MAX_HEALTH } from "@/drizzle/constants";
import { applyEffects } from "@/libs/combat/process";
import type { CompleteBattle, UserEffect } from "@/libs/combat/types";
import { getTagSchema, isPositiveUserEffect, SiphonTag } from "@/validators/combat";
import {
  makeBattleUser,
  makeCombatAction,
  makeCompleteBattle,
  makeEffect,
} from "../../setup/combat";
import { makeActivateSageEffect, makeSageMode } from "./helpers/sageMode";

const ROUND = 3;
const action = makeCombatAction();
let effectId = 0;
const runtime = (creatorId: string, targetId = creatorId) => ({
  id: `effect-${effectId++}`,
  creatorId,
  targetId,
  targetType: "user" as const,
  createdRound: ROUND - 1,
  isNew: false,
  castThisRound: false,
});
const siphon = (userId = "defender", power = 50, shieldRounds = 3) =>
  makeEffect("siphon", { power, rounds: 3, shieldRounds }, runtime(userId));
const consume = (userId = "attacker", power = 50, shieldRounds = 3) =>
  makeEffect("consume", { power, rounds: 3, shieldRounds }, runtime(userId));
const hit = (creatorId = "attacker", targetId = "defender", power = 100) =>
  makeEffect(
    "damage",
    {
      power,
      calculation: "static",
      rounds: 0,
      statTypes: ["None"],
    },
    {
      ...runtime(creatorId, targetId),
      createdRound: ROUND,
      isNew: true,
      castThisRound: true,
    },
  );
const battle = (
  effects: UserEffect[],
  users = [makeBattleUser("attacker"), makeBattleUser("defender")],
) => makeCompleteBattle({ round: ROUND, usersState: users, usersEffects: effects });
const shields = (state: CompleteBattle, userId = "defender") =>
  state.usersEffects.filter(
    (effect) =>
      effect.type === "shield" && effect.targetId === userId && effect.power > 0,
  );
const shieldHp = (state: CompleteBattle, userId = "defender") =>
  shields(state, userId).reduce((total, effect) => total + effect.power, 0);
const healthLost = (
  before: CompleteBattle,
  after: CompleteBattle,
  userId = "defender",
) =>
  before.usersState.find((user) => user.userId === userId)!.curHealth -
  after.usersState.find((user) => user.userId === userId)!.curHealth;
const existingShield = (hp: number, userId = "defender") =>
  makeEffect("shield", { power: hp, health: hp, rounds: 3 }, runtime(userId));

describe("Siphon damage taken conversion", () => {
  it("announces a new Siphon on its recipient even without incoming damage", () => {
    const effect = {
      ...siphon("defender", 25),
      creatorId: "attacker",
      createdRound: ROUND,
      isNew: true,
    };
    const { newBattle, actionEffects } = applyEffects(
      battle([effect]),
      "attacker",
      action,
    );
    expect(actionEffects).toContainEqual({
      txt: "defender will siphon 25% of damage taken into shields for the next 3 rounds",
      color: "blue",
    });
    expect(shieldHp(newBattle)).toBe(0);
    const next = applyEffects(newBattle, "defender", action);
    expect(next.actionEffects.some((info) => info.txt.includes("will siphon"))).toBe(
      false,
    );
  });

  it("does not announce successful activation when Siphon is prevented", () => {
    const effect = { ...siphon(), createdRound: ROUND, isNew: true };
    const prevention = makeEffect(
      "buffprevent",
      { power: 100, rounds: 3 },
      runtime("attacker", "defender"),
    );
    const { actionEffects } = applyEffects(
      battle([effect, prevention]),
      "defender",
      action,
    );
    expect(
      actionEffects.some((info) => info.txt.includes("cannot siphon damage")),
    ).toBe(true);
    expect(actionEffects.some((info) => info.txt.includes("will siphon"))).toBe(false);
  });

  it("announces Siphon granted by Sage Mode before any damage is taken", () => {
    const mode = makeSageMode({
      activationRounds: 5,
      effects: [SiphonTag.parse({ power: 50 })],
    });
    const initial = battle(
      [makeActivateSageEffect("defender", { createdRound: ROUND })],
      [makeBattleUser("attacker"), makeBattleUser("defender", { sageModeId: mode.id })],
    );
    initial.extraState.sageModes = { [mode.id]: mode };
    const { newBattle, actionEffects } = applyEffects(initial, "defender", action);
    expect(newBattle.usersState[1]?.sageModeActivated).toBe(true);
    expect(actionEffects.filter((info) => info.txt.includes("will siphon"))).toEqual([
      {
        txt: "defender will siphon 50% of damage taken into shields for the next 5 rounds",
        color: "blue",
      },
    ]);
    expect(shieldHp(newBattle)).toBe(0);
    expect(
      newBattle.usersEffects.find((effect) => effect.type === "siphon"),
    ).toMatchObject({
      rounds: 5,
      isNew: false,
      castThisRound: false,
    });
    const next = applyEffects(newBattle, "defender", action);
    expect(next.actionEffects.some((info) => info.txt.includes("will siphon"))).toBe(
      false,
    );
  });

  it("is registered and clearable, with a positive active duration", () => {
    expect(getTagSchema("siphon").parse({}).type).toBe("siphon");
    expect(isPositiveUserEffect(SiphonTag.parse({}))).toBe(true);
    expect(SiphonTag.safeParse({ rounds: 0 }).success).toBe(false);
  });

  it("converts incoming damage and leaves Consume converting outgoing damage", () => {
    const initial = battle([hit(), siphon(), consume()]);
    const { newBattle, actionEffects } = applyEffects(initial, "attacker", action);
    const damage = healthLost(initial, newBattle);
    expect(damage).toBeGreaterThan(0);
    expect(shieldHp(newBattle)).toBe(Math.floor(damage * 0.5));
    expect(shieldHp(newBattle, "attacker")).toBe(Math.floor(damage * 0.5));
    expect(
      actionEffects.some((effect) => effect.txt.includes("defender siphons")),
    ).toBe(true);
    expect(
      actionEffects.some((effect) => effect.txt.includes("attacker consumes")),
    ).toBe(true);
  });

  it("does not convert outgoing damage for Siphon", () => {
    const initial = battle([hit(), siphon("attacker")]);
    const result = applyEffects(initial, "attacker", action).newBattle;
    expect(healthLost(initial, result)).toBeGreaterThan(0);
    expect(shieldHp(result, "attacker")).toBe(0);
  });

  it("converts only damage remaining after an existing shield absorbs part of a hit", () => {
    const reference = battle([hit()]);
    const damage = healthLost(
      reference,
      applyEffects(reference, "attacker", action).newBattle,
    );
    const shield = existingShield(damage / 2);
    const initial = battle([hit(), siphon(), shield]);
    const result = applyEffects(initial, "attacker", action).newBattle;
    expect(healthLost(initial, result)).toBe(damage / 2);
    expect(result.usersEffects.find((effect) => effect.id === shield.id)?.power).toBe(
      0,
    );
    expect(shieldHp(result)).toBe(Math.floor(damage / 4));
  });

  it("generates no new shield when an existing shield absorbs the entire hit", () => {
    const shield = existingShield(1000);
    const initial = battle([hit(), siphon(), shield]);
    const { newBattle, actionEffects } = applyEffects(initial, "attacker", action);
    expect(healthLost(initial, newBattle)).toBe(0);
    expect(shields(newBattle)).toHaveLength(1);
    expect(shields(newBattle)[0]?.id).toBe(shield.id);
    expect(actionEffects.some((effect) => effect.txt.includes("siphons"))).toBe(false);
  });

  it("grants its shield after every hit resolves and absorbs damage on the next action", () => {
    const initial = battle([hit(), hit(), siphon()]);
    const first = applyEffects(initial, "attacker", action).newBattle;
    const damage = healthLost(initial, first);
    expect(damage).toBeGreaterThan(0);
    expect(shieldHp(first)).toBe(Math.floor(damage / 2));
    const next = {
      ...first,
      usersEffects: [
        ...first.usersEffects.filter((effect) => effect.type === "shield"),
        hit(),
      ],
    };
    const second = applyEffects(next, "attacker", action).newBattle;
    expect(healthLost(next, second)).toBe(0);
    expect(shieldHp(second)).toBe(0);
  });

  it("credits the recipient when another character grants Siphon", () => {
    const effect = { ...siphon(), creatorId: "attacker" };
    const initial = battle([hit(), effect]);
    const result = applyEffects(initial, "attacker", action).newBattle;
    expect(shieldHp(result)).toBe(Math.floor(healthLost(initial, result) / 2));
    expect(shieldHp(result, "attacker")).toBe(0);
  });

  it.each(["increaseheal", "decreaseheal", "healprevent"] as const)(
    "ignores %s",
    (type) => {
      const initial = battle([
        hit(),
        siphon(),
        makeEffect(type, { power: 100, rounds: 3 }, runtime("defender")),
      ]);
      const result = applyEffects(initial, "attacker", action).newBattle;
      expect(shieldHp(result)).toBe(Math.floor(healthLost(initial, result) / 2));
    },
  );

  it("stops converting when cleared", () => {
    const clear = makeEffect(
      "clear",
      { power: 100, rounds: 0 },
      {
        ...runtime("attacker", "defender"),
        createdRound: ROUND,
        isNew: true,
        castThisRound: true,
      },
    );
    const initial = battle([hit(), siphon(), clear]);
    const result = applyEffects(initial, "attacker", action).newBattle;
    expect(healthLost(initial, result)).toBeGreaterThan(0);
    expect(shieldHp(result)).toBe(0);
  });

  it("stops converting when its active duration expires", () => {
    const initial = battle([hit(), { ...siphon(), rounds: 0 }]);
    const result = applyEffects(initial, "attacker", action).newBattle;
    expect(healthLost(initial, result)).toBeGreaterThan(0);
    expect(shieldHp(result)).toBe(0);
  });

  it.each(["seal", "buffprevent"] as const)("respects an earlier %s effect", (type) => {
    const prevention = makeEffect(
      type,
      { power: 100, rounds: 3 },
      {
        ...runtime("attacker", "defender"),
        createdRound: ROUND - 2,
      },
    );
    const initial = battle([
      hit(),
      { ...siphon(), ...(type === "seal" ? { fromType: "bloodline" as const } : {}) },
      prevention,
    ]);
    const result = applyEffects(initial, "attacker", action).newBattle;
    expect(healthLost(initial, result)).toBeGreaterThan(0);
    expect(shieldHp(result)).toBe(0);
  });

  it("counts damage before healing on the same action", () => {
    const reference = battle([hit()]);
    const damage = healthLost(
      reference,
      applyEffects(reference, "attacker", action).newBattle,
    );
    const heal = makeEffect(
      "heal",
      { power: 10, calculation: "static", rounds: 0 },
      {
        ...runtime("defender"),
        createdRound: ROUND,
        isNew: true,
        castThisRound: true,
      },
    );
    const initial = battle([hit(), heal, siphon()]);
    const result = applyEffects(initial, "attacker", action).newBattle;
    expect(healthLost(initial, result)).toBeLessThan(damage);
    expect(shieldHp(result)).toBe(Math.floor(damage / 2));
  });

  it("does not grant shields to a character killed by the hit", () => {
    const initial = battle(
      [hit(), siphon()],
      [makeBattleUser("attacker"), makeBattleUser("defender", { curHealth: 1 })],
    );
    const result = applyEffects(initial, "attacker", action).newBattle;
    expect(result.usersState[1]?.curHealth).toBe(0);
    expect(shieldHp(result)).toBe(0);
  });

  it("counts only the HP lost when Final Stand limits damage", () => {
    const initial = battle(
      [
        hit(),
        siphon(),
        makeEffect("finalstand", { power: 100, rounds: 3 }, runtime("defender")),
      ],
      [makeBattleUser("attacker"), makeBattleUser("defender", { curHealth: 21 })],
    );
    const result = applyEffects(initial, "attacker", action).newBattle;
    expect(result.usersState[1]?.curHealth).toBe(1);
    expect(shieldHp(result)).toBe(10);
  });

  it("does not convert self-inflicted damage", () => {
    const initial = battle([hit("defender", "defender"), siphon()]);
    const result = applyEffects(initial, "defender", action).newBattle;
    expect(healthLost(initial, result)).toBeGreaterThan(0);
    expect(shieldHp(result)).toBe(0);
  });

  it.each([false, true])(
    "excludes self damage merged with enemy hits in reversed order %s",
    (reverse) => {
      const hits = [hit(), hit("defender", "defender")];
      const initial = battle([...(reverse ? hits.reverse() : hits), siphon()]);
      const result = applyEffects(initial, "defender", action).newBattle;
      const reference = battle([hit()]);
      const enemyDamage = healthLost(
        reference,
        applyEffects(reference, "attacker", action).newBattle,
      );
      expect(healthLost(initial, result)).toBe(enemyDamage * 2);
      expect(shieldHp(result)).toBe(Math.floor(enemyDamage / 2));
    },
  );

  it("converts reflected damage for the attacker taking it", () => {
    const reflect = makeEffect(
      "reflect",
      { power: 100, calculation: "percentage", rounds: 3 },
      runtime("defender"),
    );
    const initial = battle([hit(), reflect, siphon("attacker")]);
    const result = applyEffects(initial, "attacker", action).newBattle;
    const reflected = healthLost(initial, result, "attacker");
    expect(reflected).toBeGreaterThan(0);
    expect(shieldHp(result, "attacker")).toBe(Math.floor(reflected / 2));
    expect(shieldHp(result)).toBe(0);
  });

  it("does not convert recoil", () => {
    const recoil = makeEffect(
      "recoil",
      { power: 50, calculation: "percentage", rounds: 3 },
      runtime("defender", "attacker"),
    );
    const initial = battle([hit(), recoil, siphon("attacker")]);
    const result = applyEffects(initial, "attacker", action).newBattle;
    expect(healthLost(initial, result, "attacker")).toBeGreaterThan(0);
    expect(shieldHp(result, "attacker")).toBe(0);
  });

  it.each(["damage", "wound", "afterburn", "drain", "poison"] as const)(
    "converts ongoing %s damage",
    (type) => {
      const ongoing = makeEffect(
        type,
        {
          power: 10,
          calculation: "percentage",
          rounds: 3,
          ...(type === "drain" || type === "poison"
            ? { poolsAffected: ["Health"] }
            : {}),
        },
        {
          ...runtime("attacker", "defender"),
          timeTracker: { originalDamage: 100 },
          ...(type === "damage" ? { residualModifier: 1 } : {}),
        },
      );
      const initial = battle([
        ...(type === "afterburn" ? [hit()] : []),
        ongoing,
        siphon(),
      ]);
      const paidAction = { ...action, chakraCost: 100, staminaCost: 100 };
      const { newBattle: result, actionEffects } = applyEffects(
        initial,
        "defender",
        paidAction,
      );
      expect(healthLost(initial, result)).toBeGreaterThan(0);
      expect(
        actionEffects.some((effect) =>
          effect.txt.includes(type === "damage" ? "residual" : type),
        ),
      ).toBe(true);
      expect(shieldHp(result)).toBe(Math.floor(healthLost(initial, result) / 2));
    },
  );

  it("converts immediate Diffuse damage and repayments when they actually hit", () => {
    const diffuse = makeEffect(
      "diffuse",
      { power: 50, delayRounds: 2, rounds: 3 },
      runtime("defender"),
    );
    const initial = battle([hit(), diffuse, siphon()]);
    const first = applyEffects(initial, "attacker", action).newBattle;
    expect(first.usersState[1]?.diffuseDamage?.length).toBeGreaterThan(0);
    expect(shieldHp(first)).toBe(Math.floor(healthLost(initial, first) / 2));
    const next = {
      ...first,
      round: ROUND + 1,
      usersEffects: first.usersEffects.filter((effect) => effect.type === "siphon"),
    };
    const second = applyEffects(next, "defender", action).newBattle;
    expect(healthLost(next, second)).toBeGreaterThan(0);
    expect(shieldHp(second)).toBe(Math.floor(healthLost(next, second) / 2));
  });

  it("does not convert recoil deferred by Diffuse", () => {
    const initial = battle([
      hit(),
      siphon("attacker"),
      makeEffect(
        "recoil",
        { power: 50, calculation: "percentage", rounds: 3 },
        runtime("defender", "attacker"),
      ),
      makeEffect(
        "diffuse",
        { power: 50, delayRounds: 2, rounds: 3 },
        runtime("attacker"),
      ),
    ]);
    const first = applyEffects(initial, "attacker", action).newBattle;
    expect(healthLost(initial, first, "attacker")).toBeGreaterThan(0);
    expect(first.usersState[0]?.diffuseDamage?.length).toBeGreaterThan(0);
    expect(shieldHp(first, "attacker")).toBe(0);
    const next = {
      ...first,
      round: ROUND + 1,
      usersEffects: first.usersEffects.filter((effect) => effect.type === "siphon"),
    };
    const second = applyEffects(next, "attacker", action).newBattle;
    expect(healthLost(next, second, "attacker")).toBeGreaterThan(0);
    expect(shieldHp(second, "attacker")).toBe(0);
  });

  it("registers Siphon granted by Sage Mode before damage on the activation action", () => {
    const mode = makeSageMode({
      effects: [SiphonTag.parse({ power: 50, shieldRounds: 2 })],
    });
    const initial = battle(
      [hit(), makeActivateSageEffect("defender", { createdRound: ROUND })],
      [makeBattleUser("attacker"), makeBattleUser("defender", { sageModeId: mode.id })],
    );
    initial.extraState.sageModes = { [mode.id]: mode };
    const result = applyEffects(initial, "defender", action).newBattle;
    expect(result.usersState[1]?.sageModeActivated).toBe(true);
    expect(shieldHp(result)).toBe(Math.floor(healthLost(initial, result) / 2));
    expect(shields(result)[0]?.rounds).toBe(2);
  });
});

describe("shared Consume and Siphon caps", () => {
  it.each([false, true])(
    "preserves distinct directions and durations with reversed order %s",
    (reverse) => {
      const conversions = [
        consume("attacker", 50, 5),
        siphon("attacker", 25, 2),
        siphon("attacker", 25, 6),
      ];
      const initial = battle([
        hit(),
        hit("defender", "attacker"),
        ...(reverse ? conversions.reverse() : conversions),
      ]);
      const { newBattle, actionEffects } = applyEffects(initial, "attacker", action);
      const outgoing = healthLost(initial, newBattle);
      const incoming = healthLost(initial, newBattle, "attacker");
      expect(outgoing).toBeGreaterThan(0);
      expect(incoming).toBeGreaterThan(0);
      const generated = shields(newBattle, "attacker");
      expect(generated).toHaveLength(3);
      expect(generated.find((effect) => effect.rounds === 5)?.power).toBe(
        Math.floor(outgoing / 2),
      );
      expect(generated.find((effect) => effect.rounds === 2)?.power).toBe(
        Math.floor(incoming / 4),
      );
      expect(generated.find((effect) => effect.rounds === 6)?.power).toBe(
        Math.floor(incoming / 4),
      );
      expect(
        actionEffects.filter((effect) => effect.txt.includes("consumes")),
      ).toHaveLength(1);
      expect(
        actionEffects.filter((effect) => effect.txt.includes("siphons")),
      ).toHaveLength(2);
    },
  );

  it("shares a 100% conversion budget between outgoing and incoming damage", () => {
    const initial = battle([
      hit(),
      hit("defender", "attacker"),
      consume("attacker", 75, 2),
      siphon("attacker", 75, 6),
    ]);
    const result = applyEffects(initial, "attacker", action).newBattle;
    const generated = shields(result, "attacker");
    expect(generated.find((effect) => effect.rounds === 2)?.power).toBe(
      Math.floor(healthLost(initial, result) / 2),
    );
    expect(generated.find((effect) => effect.rounds === 6)?.power).toBe(
      Math.floor(healthLost(initial, result, "attacker") / 2),
    );
  });

  it("shares the shield HP cap across directions and durations", () => {
    const initial = battle(
      [
        hit("attacker", "defender", 1_000_000),
        hit("defender", "attacker", 1_000_000),
        consume("attacker", 100, 2),
        siphon("attacker", 100, 6),
      ],
      [
        makeBattleUser("attacker", { curHealth: 10_000_000, maxHealth: 10_000_000 }),
        makeBattleUser("defender", { curHealth: 10_000_000, maxHealth: 10_000_000 }),
      ],
    );
    const result = applyEffects(initial, "attacker", action).newBattle;
    expect(shieldHp(result, "attacker")).toBe(SHIELD_MAX_HEALTH);
    expect(
      shields(result, "attacker").find((effect) => effect.rounds === 2)?.power,
    ).toBe(SHIELD_MAX_HEALTH / 2);
    expect(
      shields(result, "attacker").find((effect) => effect.rounds === 6)?.power,
    ).toBe(SHIELD_MAX_HEALTH / 2);
  });
});
