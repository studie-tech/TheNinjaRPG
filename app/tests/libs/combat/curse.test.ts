import { describe, expect, it } from "bun:test";
import { accumulateCurseConsequence, accumulateCurseDamage } from "@/libs/combat/curse";
import { applyEffects } from "@/libs/combat/process";
import { curse, settleCurse } from "@/libs/combat/tags";
import { alignBattle } from "@/libs/combat/util";
import type { CompleteBattle, UserEffect } from "@/libs/combat/types";
import { CurseTag } from "@/validators/combat";
import {
  makeBattleUser,
  makeCompleteBattle,
  makeEffect,
} from "./helpers/battleScenario";

const mark = (power = 50, targetId = "attacker", id = `curse-${targetId}`) =>
  makeEffect(
    "curse",
    { power, rounds: 3 },
    {
      id,
      creatorId: targetId,
      targetId,
      targetType: "user",
      createdRound: 1,
      isNew: false,
    },
  );
const hit = (creatorId = "attacker", targetId = "defender", power = 1250) =>
  makeEffect(
    "damage",
    { power, calculation: "static", rounds: 0 },
    {
      id: `hit-${creatorId}`,
      creatorId,
      targetId,
      targetType: "user",
      isNew: true,
      createdRound: 3,
    },
  );
const scenario = (effects: UserEffect[]) =>
  makeCompleteBattle({
    round: 3,
    activeUserId: "attacker",
    usersState: [
      makeBattleUser("attacker", { curHealth: 5000, maxHealth: 10000 }),
      makeBattleUser("defender", { curHealth: 5000, maxHealth: 10000 }),
    ],
    usersEffects: effects,
  });
const user = (battle: CompleteBattle, id = "attacker") =>
  battle.usersState.find((u) => u.userId === id)!;
const stored = (battle: CompleteBattle, id = "attacker") =>
  battle.usersEffects.find((e) => e.type === "curse" && e.targetId === id)!.curseState!
    .storedHealing;
const expire = (battle: CompleteBattle) => {
  battle.usersEffects
    .filter((e) => e.type === "curse")
    .forEach((e) => {
      e.rounds = 1;
      e.castThisRound = false;
    });
  battle.usersState.forEach((u) => {
    u.round = battle.round;
    u.actionPoints = 0;
  });
  battle.roundStartAt = new Date(Date.now() - 600000);
  return alignBattle(battle, [], "attacker");
};

describe("Curse", () => {
  it("stores 250 from each 1000 damage direction and heals 500 only on expiry", () => {
    let battle = applyEffects(
      scenario([mark(), hit(), hit("defender", "attacker")]),
      "attacker",
    ).newBattle;
    expect(user(battle).curHealth).toBe(4000);
    expect(stored(battle)).toBe(500);
    battle = JSON.parse(JSON.stringify(battle)) as CompleteBattle;
    const transition = expire(battle);
    expect(transition.progressRound).toBe(true);
    expect(user(battle).curHealth).toBe(4500);
    expect(transition.expiredEffects.some((e) => e.txt.includes("500.00"))).toBe(true);
    expire(battle);
    expect(user(battle).curHealth).toBe(4500);
  });
  it.each(["attacker", "defender"])(
    "keeps one side at half power when only %s deals damage",
    (attackerId) => {
      const targetId = attackerId === "attacker" ? "defender" : "attacker";
      const battle = applyEffects(
        scenario([mark(), hit(attackerId, targetId)]),
        "attacker",
      ).newBattle;
      expect(stored(battle)).toBe(250);
    },
  );
  it("counts post-shield HP loss and caps overkill", () => {
    const shield = makeEffect(
      "shield",
      { power: 400, rounds: 3 },
      {
        targetId: "defender",
        creatorId: "defender",
        targetType: "user",
        createdRound: 1,
      },
    );
    expect(
      stored(applyEffects(scenario([mark(), hit(), shield]), "attacker").newBattle),
    ).toBe(150);
    const battle = scenario([mark(), hit()]);
    user(battle, "defender").curHealth = 100;
    expect(stored(applyEffects(battle, "attacker").newBattle)).toBe(25);
  });
  it("discards healing when cleared", () => {
    const effect = mark();
    effect.curseState = { storedHealing: 500, activatedRound: 1 };
    const clear = makeEffect(
      "clear",
      { power: 100 },
      {
        creatorId: "defender",
        targetId: "attacker",
        targetType: "user",
        isNew: true,
        createdRound: 3,
      },
    );
    const battle = applyEffects(scenario([effect, clear]), "attacker").newBattle;
    const health = user(battle).curHealth;
    expire(battle);
    expect(user(battle).curHealth).toBe(health);
  });
  it("does not revive and caps payout at effective maximum HP", () => {
    const effect = mark();
    effect.curseState = { storedHealing: 500, activatedRound: 1 };
    const battle = scenario([effect]);
    user(battle).curHealth = 9900;
    settleCurse(effect, user(battle), [effect]);
    expect(user(battle).curHealth).toBe(10000);
    effect.curseState = { storedHealing: 500, activatedRound: 1 };
    user(battle).curHealth = 0;
    settleCurse(effect, user(battle), [effect]);
    expect(user(battle).curHealth).toBe(0);
  });
  it("blocks payout under heal prevention and consumes it once", () => {
    const effect = mark();
    effect.curseState = { storedHealing: 500, activatedRound: 1 };
    const block = makeEffect(
      "healprevent",
      { power: 100, rounds: 3 },
      { targetId: "attacker", createdRound: 2 },
    );
    const battle = scenario([effect, block]);
    settleCurse(effect, user(battle), battle.usersEffects);
    settleCurse(effect, user(battle), [effect]);
    expect(user(battle).curHealth).toBe(5000);
    expect(effect.curseState.storedHealing).toBe(0);
  });
  it("applies current healing modifiers at payout", () => {
    const effect = mark();
    effect.curseState = { storedHealing: 500, activatedRound: 1 };
    const boost = makeEffect(
      "increaseheal",
      { power: 50, calculation: "percentage", rounds: 3 },
      { targetId: "attacker", creatorId: "attacker", createdRound: 1 },
    );
    const battle = scenario([effect, boost]);
    settleCurse(effect, user(battle), battle.usersEffects);
    expect(user(battle).curHealth).toBe(5750);
  });
  it("does not accumulate on its casting action", () => {
    const effect = mark();
    effect.isNew = true;
    effect.createdRound = 3;
    const battle = applyEffects(scenario([effect, hit()]), "attacker").newBattle;
    expect(stored(battle)).toBe(0);
  });
  it("requires a positive finite duration", () => {
    expect(CurseTag.safeParse({ rounds: 0 }).success).toBe(false);
    expect(CurseTag.parse({}).rounds).toBe(3);
  });
  it("preserves fractions and independent instances", () => {
    const effects = [mark(50), mark(20, "defender")];
    const battle = scenario(effects);
    effects.forEach((e) => curse(e, effects, user(battle, e.targetId), 3));
    accumulateCurseDamage(effects, battle.usersState, "attacker", "defender", 1, 3);
    expect(effects[0]!.curseState!.storedHealing).toBe(0.25);
    expect(effects[1]!.curseState!.storedHealing).toBe(0.1);
  });
  it("attributes merged damage to individual attackers and excludes recoil", () => {
    const effect = mark();
    effect.curseState = { storedHealing: 0, activatedRound: 1 };
    const battle = scenario([effect]);
    accumulateCurseConsequence(
      {
        userId: "attacker",
        targetId: "defender",
        damage: 100,
        enmitySources: [
          { userId: "attacker", damage: 40 },
          { userId: "other", damage: 60 },
        ],
      },
      "damage",
      [effect],
      battle.usersState,
      3,
    );
    expect(effect.curseState.storedHealing).toBe(10);
    accumulateCurseConsequence(
      { userId: "attacker", targetId: "defender", damage: 100, damageSource: "recoil" },
      "damage",
      [effect],
      battle.usersState,
      3,
    );
    expect(effect.curseState.storedHealing).toBe(10);
  });
});

it("counts Diffuse damage only as it is repaid while Curse is active", () => {
  const diffuse = makeEffect(
    "diffuse",
    { power: 50, rounds: 3, delayRounds: 1 },
    {
      targetId: "defender",
      creatorId: "defender",
      targetType: "user",
      createdRound: 1,
    },
  );
  let battle = applyEffects(scenario([mark(), hit(), diffuse]), "attacker").newBattle;
  expect(stored(battle)).toBe(125);
  battle.usersEffects = battle.usersEffects.filter((e) => e.type === "curse");
  battle.round += 1;
  battle = applyEffects(battle, "defender").newBattle;
  expect(stored(battle)).toBe(250);
});

it("includes residual damage and returned Parry damage", () => {
  const residual = hit();
  residual.rounds = 3;
  residual.isNew = false;
  residual.createdRound = 1;
  expect(
    stored(applyEffects(scenario([mark(), residual]), "defender").newBattle),
  ).toBeGreaterThan(0);
  const parry = makeEffect(
    "parry",
    { power: 30, rounds: 3 },
    {
      creatorId: "defender",
      targetId: "defender",
      targetType: "user",
      createdRound: 1,
    },
  );
  const battle = applyEffects(scenario([mark(), hit(), parry]), "attacker").newBattle;
  expect(stored(battle)).toBe(250);
});

it("does not pay at battle end", () => {
  const effect = mark();
  effect.curseState = { storedHealing: 500, activatedRound: 1 };
  const battle = scenario([effect]);
  user(battle, "defender").curHealth = 0;
  expire(battle);
  expect(user(battle).curHealth).toBe(5000);
});

it("applies per-level scaling to both halves", () => {
  const effect = mark(40);
  effect.level = 10;
  effect.powerPerLevel = 1;
  const battle = applyEffects(
    scenario([effect, hit(), hit("defender", "attacker")]),
    "attacker",
  ).newBattle;
  expect(stored(battle)).toBe(500);
});

it("does not accumulate from self damage or allied damage", () => {
  const effect = mark();
  effect.curseState = { storedHealing: 0, activatedRound: 1 };
  const battle = scenario([effect]);
  user(battle, "defender").direction = "left";
  accumulateCurseDamage([effect], battle.usersState, "attacker", "attacker", 1000, 3);
  accumulateCurseDamage([effect], battle.usersState, "attacker", "defender", 1000, 3);
  expect(effect.curseState.storedHealing).toBe(0);
});

it("rejects activation when buff prevention is active", () => {
  const effect = mark();
  effect.isNew = true;
  effect.createdRound = 3;
  const block = makeEffect(
    "buffprevent",
    { power: 100, rounds: 3 },
    {
      targetId: "attacker",
      creatorId: "defender",
      createdRound: 1,
      targetType: "user",
    },
  );
  const battle = applyEffects(scenario([effect, block, hit()]), "attacker").newBattle;
  expect(battle.usersEffects.some((e) => e.type === "curse")).toBe(false);
});

it("starts accumulating on the next action within the same round", () => {
  const effect = mark();
  effect.isNew = true;
  effect.createdRound = 3;
  let battle = applyEffects(scenario([effect, hit()]), "attacker").newBattle;
  expect(stored(battle)).toBe(0);
  battle.usersEffects.push(hit());
  battle = applyEffects(battle, "attacker").newBattle;
  expect(stored(battle)).toBe(250);
});
