import { describe, expect, it } from "bun:test";
import type { Jutsu } from "@/drizzle/schema";
import {
  availableUserActions,
  getActionPointCost,
  performBattleAction,
} from "@/libs/combat/actions";
import { applyEffects } from "@/libs/combat/process";
import { applyFinalStandDamage, applyPreventTag, heal } from "@/libs/combat/tags";
import type { CompleteBattle, UserEffect } from "@/libs/combat/types";
import {
  calcPoolCost,
  getBattleGrid,
  getEffectiveMaxPool,
  hasActiveEffectOfType,
  isEffectActive,
} from "@/libs/combat/util";
import { alignBattle } from "@/libs/combat/turn";
import {
  makeBattleUser,
  makeCompleteBattle,
  makeDamageEffect,
  makeEffect,
  makeJutsu,
  makeTag,
} from "../../setup/combat";
import { makeActivateSageEffect, makeSageMode } from "./helpers/sageMode";

const target = () => makeBattleUser("defender", { curHealth: 100, maxHealth: 1000 });
const runtime = {
  creatorId: "defender",
  targetId: "defender",
  fromType: "bloodline" as const,
  targetType: "user" as const,
  createdRound: 0,
};
const sealEffect = (overrides: Partial<UserEffect> = {}) =>
  makeEffect(
    "seal",
    { power: 100, rounds: overrides.rounds ?? 3 },
    {
      ...runtime,
      creatorId: "attacker",
      fromType: "jutsu",
      ...overrides,
    },
  );
const healEffect = () =>
  makeEffect(
    "heal",
    { power: 50, rounds: 0, calculation: "static" },
    {
      ...runtime,
      fromType: "jutsu",
      isNew: true,
      castThisRound: true,
      createdRound: 3,
    },
  );

const prevention = () => makeEffect("healprevent", { power: 100, rounds: 10 }, runtime);

describe("Bloodline Seal", () => {
  it("suppresses bloodline prevention without removing it, then restores it on expiry", () => {
    const prevent = prevention();
    const seal = sealEffect();
    const effects = [prevent, seal];
    const user = target();
    const before = new Map();
    heal(healEffect(), [prevent], user, before, 1);
    expect(before.size).toBe(0);

    const during = new Map();
    heal(healEffect(), effects, user, during, 1);
    expect(during.size).toBe(1);
    expect(prevent.rounds).toBe(10);
    expect(isEffectActive(prevent)).toBe(true);

    seal.rounds = 0;
    const after = new Map();
    heal(healEffect(), effects, user, after, 1);
    expect(after.size).toBe(0);
  });

  it.each([{ isNew: true }, { rounds: 0 }, { targetId: "someone-else" }])(
    "ignores unresolved, expired or differently targeted seals: %j",
    (overrides) => {
      const effects = [prevention(), sealEffect(overrides)];
      const consequences = new Map();
      heal(healEffect(), effects, target(), consequences, 1);
      expect(consequences.size).toBe(0);
    },
  );

  it("keeps non-bloodline prevention active even after a sealed bloodline prevent", () => {
    const effects = [
      prevention(),
      sealEffect(),
      { ...prevention(), id: "item-prevent", fromType: "item" as const },
    ];
    const consequences = new Map();
    heal(healEffect(), effects, target(), consequences, 1);
    expect(consequences.size).toBe(0);
  });

  it("suppresses bloodline immunity to prevention", () => {
    const immunity = makeEffect(
      "immunity",
      { blocks: "healprevent", rounds: 10 },
      runtime,
    );
    const castPrevent = () =>
      makeEffect(
        "healprevent",
        { power: 100, rounds: 3 },
        {
          ...runtime,
          fromType: "jutsu",
          isNew: true,
          castThisRound: true,
          createdRound: 3,
        },
      ) as Parameters<typeof applyPreventTag>[0];
    const blocked = castPrevent();
    applyPreventTag(blocked, [immunity], target());
    expect(blocked.rounds).toBe(0);
    const allowed = castPrevent();
    applyPreventTag(allowed, [immunity, sealEffect()], target());
    expect(allowed.rounds).toBe(3);
  });

  it.each(["moveprevent", "summonprevent", "disarm", "stealth"] as const)(
    "suppresses the %s action restriction and restores it on expiry",
    (type) => {
      const effect = makeEffect(type, { power: 100, rounds: 10 }, runtime);
      const seal = sealEffect();
      expect(hasActiveEffectOfType("defender", [effect], type)).toBe(true);
      expect(hasActiveEffectOfType("defender", [effect, seal], type)).toBe(false);
      seal.rounds = 0;
      expect(hasActiveEffectOfType("defender", [effect, seal], type)).toBe(true);
    },
  );

  it("suppresses bloodline pool bonuses and cost modifiers", () => {
    const poolBonus = makeEffect(
      "increasemaxpools",
      { power: 200, calculation: "static", poolsAffected: ["Health"] },
      runtime,
    );
    const costReduction = makeEffect(
      "decreasepoolcost",
      { power: 20, calculation: "static", poolsAffected: ["Chakra"] },
      runtime,
    );
    const action = availableUserActions(
      makeCompleteBattle({ usersState: [target()] }),
      "defender",
      false,
      true,
    )[0]!;
    const user = target();
    expect(getEffectiveMaxPool(user, [poolBonus], "Health")).toBe(1200);
    expect(getEffectiveMaxPool(user, [poolBonus, sealEffect()], "Health")).toBe(1000);
    expect(
      calcPoolCost({ ...action, chakraCost: 100 }, [costReduction], user).cpCost,
    ).toBe(80);
    expect(
      calcPoolCost({ ...action, chakraCost: 100 }, [costReduction, sealEffect()], user)
        .cpCost,
    ).toBe(100);
  });

  it("suppresses bloodline Final Stand without consuming it", () => {
    const finalStand = makeEffect("finalstand", { rounds: 10 }, runtime);
    expect(applyFinalStandDamage([finalStand, sealEffect()], target(), 500, [])).toBe(
      500,
    );
    expect(finalStand.rounds).toBe(10);
    expect(applyFinalStandDamage([finalStand], target(), 500, [])).toBe(99);
  });

  it("resolves healing through a sealed prevent in the complete effect pipeline", () => {
    const battle = makeCompleteBattle({
      round: 3,
      usersState: [makeBattleUser("attacker"), target()],
      usersEffects: [prevention(), sealEffect(), healEffect()],
    });
    const { newBattle } = applyEffects(battle, "defender");
    expect(newBattle.usersState.find((u) => u.userId === "defender")?.curHealth).toBe(
      600,
    );
    expect(newBattle.usersEffects.find((e) => e.type === "healprevent")?.rounds).toBe(
      10,
    );
  });

  it.each([false, true])(
    "keeps newly activated Sage robbery protection with bloodline sealing=%j",
    (sealed) => {
      const sage = makeBattleUser("defender", { sageModeId: "sage-1", money: 1000 });
      const mode = makeSageMode({ effects: [makeTag("robprevent", { power: 100 })] });
      const bloodlinePrevent = makeEffect(
        "robprevent",
        { power: 100, rounds: 10 },
        runtime,
      );
      const robbery = makeEffect(
        "rob",
        { power: 100, rounds: 3, robPercentage: 10 },
        {
          creatorId: "attacker",
          targetId: "defender",
          targetType: "user",
          fromType: "jutsu",
          createdRound: 1,
        },
      );
      const { newBattle, actionEffects } = applyEffects(
        makeCompleteBattle({
          round: 5,
          usersState: [makeBattleUser("attacker", { money: 0 }), sage],
          usersEffects: [
            makeActivateSageEffect("defender", { createdRound: 5 }),
            robbery,
            ...(sealed ? [bloodlinePrevent, sealEffect()] : []),
          ],
          extraState: { sageModes: { "sage-1": mode } },
        }),
        "defender",
      );

      expect(newBattle.usersState.find((u) => u.userId === "defender")?.money).toBe(
        1000,
      );
      expect(newBattle.usersState.find((u) => u.userId === "attacker")?.money).toBe(0);
      expect(
        actionEffects.some((e) => e.txt === "defender resisted being robbed"),
      ).toBe(true);
      expect(
        newBattle.usersEffects.filter(
          (e) => e.type === "robprevent" && e.fromType === "sageMode",
        ),
      ).toHaveLength(1);
      expect(bloodlinePrevent.rounds).toBe(10);
    },
  );

  it("suppresses bloodline shields in the complete damage pipeline", () => {
    const shield = makeEffect("shield", { power: 500, rounds: 10 }, runtime);
    const damage = makeDamageEffect({
      power: 50,
      calculation: "static",
      createdRound: 3,
      targetType: "user",
    });
    const resolve = (effects: UserEffect[]) =>
      applyEffects(
        makeCompleteBattle({
          round: 3,
          usersState: [makeBattleUser("attacker"), target()],
          usersEffects: [...effects, structuredClone(damage)],
        }),
        "attacker",
      ).newBattle;
    expect(resolve([structuredClone(shield)]).usersState[1]?.curHealth).toBe(100);
    const sealed = resolve([shield, sealEffect()]);
    expect(sealed.usersState[1]?.curHealth).toBeLessThan(100);
    expect(shield.power).toBe(500);
  });
});

/** A granted skill already on cooldown when its bloodline becomes sealed. */
const injectedFixture = () => {
  const jutsu = makeJutsu({
    id: "injected-skill",
    name: "Injected skill",
    cooldown: 10,
    effects: [makeTag("heal")],
  });
  const user = makeBattleUser("defender", {
    jutsus: [
      {
        id: "owned-injection",
        jutsuId: jutsu.id,
        origin: "injected",
        equipped: true,
        level: 1,
        experience: 0,
        originalCooldown: 10,
        lastUsedRound: 3,
      },
    ],
  });
  const grant = makeEffect(
    "injectjutsus",
    { jutsuIds: [jutsu.id], rounds: 20 },
    runtime,
  );
  const seal = sealEffect();
  const battle = makeCompleteBattle({
    round: 4,
    usersState: [user],
    usersEffects: [grant, seal],
    extraState: { jutsus: { [jutsu.id]: jutsu } },
  });
  return { user, grant, seal, battle, jutsu };
};

describe("Bloodline Seal injected jutsu", () => {
  it("hides a sealed grant while preserving its record and cooldown after restoration", () => {
    const { user, seal, battle, jutsu } = injectedFixture();
    const original = user.jutsus[0];
    expect(
      availableUserActions(battle, user.userId).some((a) => a.id === jutsu.id),
    ).toBe(false);
    expect(user.jutsus[0]).toBe(original);
    seal.rounds = 0;
    battle.round = 6;
    const restored = availableUserActions(battle, user.userId).find(
      (a) => a.id === jutsu.id,
    );
    expect(restored?.lastUsedRound).toBe(3);
    expect(restored?.cooldown).toBe(10);
    expect(
      availableUserActions(battle, user.userId, true, true).some(
        (a) => a.id === jutsu.id,
      ),
    ).toBe(false);
    battle.round = 13;
    expect(
      availableUserActions(battle, user.userId, true, true).some(
        (a) => a.id === jutsu.id,
      ),
    ).toBe(true);
  });

  it("keeps a jutsu available if an unsealed source grants it too", () => {
    const { user, grant, battle, jutsu } = injectedFixture();
    battle.usersEffects.push({ ...grant, id: "item-grant", fromType: "item" });
    expect(
      availableUserActions(battle, user.userId).some((a) => a.id === jutsu.id),
    ).toBe(true);
    expect(user.jutsus[0]?.lastUsedRound).toBe(3);
  });

  it("preserves a separately learned jutsu when a grant for the same skill expires", () => {
    const { user, grant, battle, jutsu } = injectedFixture();
    const learned = {
      ...user.jutsus[0]!,
      id: "learned-skill",
      origin: "user" as const,
    };
    user.jutsus.push(learned);
    grant.rounds = 0;
    expect(
      availableUserActions(battle, user.userId).some((a) => a.id === jutsu.id),
    ).toBe(true);
    expect(user.jutsus).toEqual([learned]);
  });

  it("removes an injected record when its grant expires during sealing", () => {
    const { user, grant, battle } = injectedFixture();
    grant.rounds = 0;
    availableUserActions(battle, user.userId);
    expect(user.jutsus).toEqual([]);
  });
});

describe("Bloodline Seal temporal effects", () => {
  for (const type of ["timedilation", "timecompression"] as const) {
    it.each([false, true])(
      `restores ${type} without stacking or losing its duration (temporary first=%j)`,
      (temporaryFirst) => {
        const bloodline = makeEffect(
          type,
          { power: 100, rounds: 20, target: "SELF" },
          runtime,
        );
        const seal = sealEffect({ rounds: 1, createdRound: 1 });
        const fixture = actionFixture(
          [bloodline, seal],
          [makeTag(type, { power: 100, rounds: 4, target: "SELF" })],
        );
        let battle = fixture.battle;
        const expectedCost = type === "timedilation" ? 30 : 50;

        expect(getActionPointCost("defender", battle, fixture.action)).toBe(40);
        battle = fixture.perform(battle).newBattle;
        expect(battle.usersEffects.find((e) => e.id === bloodline.id)?.rounds).toBe(20);
        expect(battle.usersEffects.filter((e) => e.type === type)).toHaveLength(2);
        if (temporaryFirst) battle.usersEffects.reverse();

        battle = nextRound(battle);
        expect(getActionPointCost("defender", battle, fixture.action)).toBe(
          expectedCost,
        );
        battle = applyEffects(battle, "defender").newBattle;
        expect(battle.usersEffects.some((e) => e.type === "seal")).toBe(false);
        expect(battle.usersEffects.find((e) => e.id === bloodline.id)?.rounds).toBe(19);
        expect(getActionPointCost("defender", battle, fixture.action)).toBe(
          expectedCost,
        );

        // Advance past the temporary jutsu's duration, then the bloodline's own expiry.
        for (let i = 0; i < 5; i++)
          battle = applyEffects(nextRound(battle), "defender").newBattle;
        expect(battle.usersEffects.find((e) => e.id === bloodline.id)?.rounds).toBe(14);
        expect(battle.usersEffects.filter((e) => e.type === type)).toHaveLength(1);
        expect(getActionPointCost("defender", battle, fixture.action)).toBe(
          expectedCost,
        );
        for (let i = 0; i < 14; i++)
          battle = applyEffects(nextRound(battle), "defender").newBattle;
        expect(battle.usersEffects.some((e) => e.id === bloodline.id)).toBe(false);
        expect(getActionPointCost("defender", battle, fixture.action)).toBe(40);
      },
    );
  }
});

describe("Bloodline Seal poison pool costs", () => {
  it.each(["bloodline", "item", "jutsu"] as const)(
    "uses enabled %s modifiers before, during and after sealing",
    (fromType) => {
      const modifier = makeEffect(
        "increasepoolcost",
        { power: 100, calculation: "percentage", poolsAffected: ["Chakra"] },
        { ...runtime, fromType },
      );
      const poison = makeEffect(
        "poison",
        { power: 100, rounds: 10 },
        { ...runtime, creatorId: "attacker", fromType: "jutsu", createdRound: 1 },
      );
      const seal = sealEffect({ createdRound: 1 });
      const fixture = actionFixture([poison, modifier]);
      const checkAction = (effects: UserEffect[], expected: number) => {
        const battle = structuredClone(fixture.battle);
        battle.usersEffects = structuredClone(effects);
        const { newBattle } = fixture.perform(battle);
        const user = newBattle.usersState.find((u) => u.userId === "defender")!;
        expect(5000 - user.curChakra).toBe(expected);
        expect(5000 - user.curHealth).toBe(expected);
        expect(newBattle.usersEffects.find((e) => e.id === modifier.id)?.power).toBe(
          100,
        );
      };
      checkAction([poison, modifier], 200);
      checkAction([poison, modifier, seal], fromType === "bloodline" ? 100 : 200);
      seal.rounds = 0;
      checkAction([poison, modifier, seal], 200);
    },
  );
});

/** Exercise action selection, resource spending and effect processing together. */
const actionFixture = (
  effects: UserEffect[],
  tags: Jutsu["effects"] = [
    makeTag("damage", { power: 0, calculation: "static", rounds: 0, target: "SELF" }),
  ],
) => {
  const jutsu = makeJutsu({
    id: "test-action",
    name: "Test action",
    target: "SELF",
    range: 0,
    chakraCost: 100,
    actionCostPerc: 40,
    effects: tags,
  });
  const user = makeBattleUser("defender", {
    jutsus: [
      {
        id: "owned-action",
        jutsuId: jutsu.id,
        origin: "user",
        equipped: true,
        level: 1,
        experience: 0,
        originalCooldown: 0,
        lastUsedRound: -10,
      },
    ],
  });
  const battle = makeCompleteBattle({
    createdAt: new Date(0),
    width: 12,
    height: 10,
    round: 3,
    usersState: [makeBattleUser("attacker"), user],
    usersEffects: effects,
    extraState: { jutsus: { [jutsu.id]: jutsu } },
  });
  const action = availableUserActions(battle, "defender", true, true).find(
    (a) => a.id === jutsu.id,
  )!;
  const perform = (current: CompleteBattle) =>
    performBattleAction({
      battle: current,
      action,
      grid: getBattleGrid(1, current),
      actorId: "defender",
      longitude: user.longitude,
      latitude: user.latitude,
    });
  return { battle, action, perform };
};

/** Advance through normal round alignment so effect lifetimes expire naturally. */
const nextRound = (battle: CompleteBattle) => {
  battle.usersState.forEach((user) => {
    user.round = battle.round;
    user.actionPoints = 0;
  });
  battle.roundStartAt = new Date(Date.now() - 600_000);
  expect(alignBattle(battle, [], "defender").progressRound).toBe(true);
  return battle;
};
