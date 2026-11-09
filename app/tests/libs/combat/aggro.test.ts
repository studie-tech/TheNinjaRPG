import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { creditDamageEnmity } from "@/libs/combat/aggro";
import { maskBattle } from "@/libs/combat/masking";
import { applyEffects } from "@/libs/combat/process";
import { clone } from "@/libs/combat/tags";
import type { GroundEffect } from "@/libs/combat/types";
import {
  DecreaseAggroTag,
  IncreaseAggroTag,
  SuperRefinePassiveEffects,
} from "@/validators/combat";
import { makeBattleUser, makeCompleteBattle, makeEffect } from "../../setup/combat";

const damage = (power = 100) =>
  makeEffect(
    "damage",
    { calculation: "static", power, rounds: 0 },
    {
      targetType: "user",
      isNew: true,
      createdRound: 1,
      fromType: "jutsu",
    },
  );
const modifier = (type: "increaseaggro" | "decreaseaggro", power = 50) =>
  makeEffect(
    type,
    {
      aggroMode: "GENERATION",
      calculation: "percentage",
      power,
    },
    {
      creatorId: "attacker",
      targetId: "attacker",
      targetType: "user",
      fromType: "armor",
    },
  );

const resolve = (effects: ReturnType<typeof makeEffect>[], hp = 5000) =>
  applyEffects(
    makeCompleteBattle({
      usersState: [
        makeBattleUser("attacker"),
        makeBattleUser("defender", { curHealth: hp }),
      ],
      usersEffects: effects,
    }),
    "attacker",
  ).newBattle;

describe("combat enmity", () => {
  it("uses HP lost after shield absorption and caps overkill", () => {
    const shield = makeEffect(
      "shield",
      { power: 40, rounds: 3 },
      { targetType: "user", creatorId: "defender", targetId: "defender" },
    );
    expect(resolve([damage(), shield]).usersState[0]?.enmity).toBe(40);
    expect(resolve([damage()], 20).usersState[0]?.enmity).toBe(20);
    expect(resolve([damage(0)]).usersState[0]?.enmity ?? 0).toBe(0);
  });

  it("adds passive generation modifiers without changing damage", () => {
    const battle = resolve([damage(), modifier("increaseaggro")]);
    expect(battle.usersState[1]?.curHealth).toBe(4920);
    expect(battle.usersState[0]?.enmity).toBe(120);
    expect(resolve([damage(), modifier("decreaseaggro")]).usersState[0]?.enmity).toBe(
      40,
    );
  });

  it("combines percentage and static modifiers and never generates negative threat", () => {
    const flat = modifier("increaseaggro", 20);
    flat.calculation = "static";
    expect(
      resolve([damage(), flat, modifier("increaseaggro")]).usersState[0]?.enmity,
    ).toBe(140);
    expect(
      resolve([damage(), modifier("decreaseaggro", 100)]).usersState[0]?.enmity,
    ).toBe(0);
  });

  it("ignores expired and sealed generation modifiers", () => {
    const expired = modifier("increaseaggro");
    expired.rounds = 0;
    expect(resolve([damage(), expired]).usersState[0]?.enmity).toBe(80);
    const bloodline = modifier("increaseaggro");
    bloodline.fromType = "bloodline";
    const seal = makeEffect(
      "seal",
      { power: 100, rounds: 3 },
      {
        targetType: "user",
        creatorId: "defender",
        targetId: "attacker",
        createdRound: 0,
        isNew: false,
      },
    );
    expect(resolve([damage(), bloodline, seal]).usersState[0]?.enmity).toBe(80);
  });

  it("applies direct enmity once per round and clamps decreases at zero", () => {
    const actor = makeBattleUser("attacker", { enmity: 100 });
    const tag = makeEffect(
      "increaseaggro",
      { aggroMode: "ENMITY", calculation: "static", power: 50, rounds: 3 },
      {
        creatorId: "attacker",
        targetId: "attacker",
        targetType: "user",
        isNew: true,
        timeTracker: {},
        createdRound: 1,
      },
    );
    let battle = makeCompleteBattle({ usersState: [actor], usersEffects: [tag] });
    battle = applyEffects(battle, "attacker").newBattle;
    expect(battle.usersState[0]?.enmity).toBe(150);
    battle = applyEffects(battle, "attacker").newBattle;
    expect(battle.usersState[0]?.enmity).toBe(150);
    battle.round = 2;
    battle = applyEffects(battle, "attacker").newBattle;
    expect(battle.usersState[0]?.enmity).toBe(200);
    tag.type = "decreaseaggro";
    tag.power = 999;
    tag.isNew = true;
    tag.rounds = 0;
    tag.timeTracker = {};
    battle.usersEffects = [tag];
    expect(applyEffects(battle, "attacker").newBattle.usersState[0]?.enmity).toBe(0);
  });

  it("supports percentage reductions and buff prevention", () => {
    const actor = makeBattleUser("attacker", { enmity: 200 });
    const tag = makeEffect(
      "decreaseaggro",
      { aggroMode: "ENMITY", calculation: "percentage", power: 50, rounds: 0 },
      {
        creatorId: "attacker",
        targetId: "attacker",
        targetType: "user",
        isNew: true,
        timeTracker: {},
        createdRound: 2,
      },
    );
    const battle = makeCompleteBattle({
      round: 2,
      usersState: [actor],
      usersEffects: [tag],
    });
    expect(
      applyEffects(structuredClone(battle), "attacker").newBattle.usersState[0]?.enmity,
    ).toBe(100);
    battle.usersEffects.push(
      makeEffect(
        "buffprevent",
        { power: 100, rounds: 3 },
        {
          creatorId: "attacker",
          targetId: "attacker",
          targetType: "user",
          createdRound: 1,
        },
      ),
    );
    expect(applyEffects(battle, "attacker").newBattle.usersState[0]?.enmity).toBe(200);
  });

  it("does not credit friendly fire, self damage, healing, or zero damage", () => {
    const actor = makeBattleUser("attacker");
    for (const target of [actor, makeBattleUser("ally", { direction: "left" })])
      creditDamageEnmity(actor, target, 100, []);
    creditDamageEnmity(actor, makeBattleUser("defender"), 0, []);
    expect(actor.enmity ?? 0).toBe(0);
    const heal = makeEffect(
      "heal",
      { calculation: "static", power: 100, rounds: 0 },
      { targetType: "user", isNew: true, createdRound: 1 },
    );
    expect(resolve([heal]).usersState[0]?.enmity ?? 0).toBe(0);
  });

  it("credits summons themselves, independently of quest damage credit", () => {
    const summon = makeBattleUser("summon", {
      isSummon: true,
      controllerId: "attacker",
      direction: "left",
    });
    const actor = makeBattleUser("attacker");
    const hit = damage();
    hit.creatorId = "summon";
    const battle = applyEffects(
      makeCompleteBattle({
        usersState: [actor, summon, makeBattleUser("defender")],
        usersEffects: [hit],
      }),
      "summon",
    ).newBattle;
    expect(battle.usersState[1]?.enmity).toBe(80);
    expect(battle.usersState[0]?.enmity ?? 0).toBe(0);
    expect(battle.usersState[0]?.damageDealt).toBe(80);
  });

  it("credits ticking HP drain and poison", () => {
    const drain = makeEffect(
      "drain",
      { power: 100, calculation: "static", rounds: 3, poolsAffected: ["Health"] },
      { targetType: "user", createdRound: 1, timeTracker: {} },
    );
    const poison = makeEffect(
      "poison",
      { power: 100, rounds: 3 },
      { targetType: "user", createdRound: 1 },
    );
    const battle = makeCompleteBattle({
      round: 2,
      usersState: [makeBattleUser("attacker"), makeBattleUser("defender")],
      usersEffects: [drain, poison],
    });
    const result = applyEffects(battle, "defender", {
      chakraCost: 100,
      staminaCost: 100,
    } as Parameters<typeof applyEffects>[2]).newBattle;
    expect(result.usersState[0]?.enmity).toBeCloseTo(
      5000 - result.usersState[1]!.curHealth,
    );
    expect(result.usersState[0]!.enmity).toBeGreaterThan(100);
  });

  it("honors generation modifiers on ground tiles", () => {
    const field = modifier("increaseaggro");
    const actor = makeBattleUser("attacker");
    const b = makeCompleteBattle({
      usersState: [actor, makeBattleUser("defender")],
      usersEffects: [damage()],
      groundEffects: [
        {
          ...field,
          longitude: actor.longitude,
          latitude: actor.latitude,
          rounds: 3,
        } as GroundEffect,
      ],
    });
    expect(applyEffects(b, "attacker").newBattle.usersState[0]?.enmity).toBe(120);
  });

  it("does not apply expired or cleared current-enmity tags", () => {
    const tag = makeEffect(
      "increaseaggro",
      { aggroMode: "ENMITY", calculation: "static", power: 50, rounds: 0 },
      {
        creatorId: "attacker",
        targetId: "attacker",
        targetType: "user",
        createdRound: 1,
        timeTracker: { attacker: 1 },
      },
    );
    const actor = makeBattleUser("attacker", { enmity: 100 });
    const b = makeCompleteBattle({
      round: 2,
      usersState: [actor, makeBattleUser("defender")],
      usersEffects: [tag],
    });
    expect(
      applyEffects(structuredClone(b), "attacker").newBattle.usersState[0]?.enmity,
    ).toBe(100);
    tag.rounds = 3;
    b.usersEffects.unshift(
      makeEffect(
        "clear",
        { power: 100, rounds: 0 },
        {
          targetType: "user",
          creatorId: "defender",
          targetId: "attacker",
          isNew: true,
          createdRound: 2,
        },
      ),
    );
    expect(applyEffects(b, "attacker").newBattle.usersState[0]?.enmity).toBe(100);
  });

  it("starts clones at zero and exposes enmity through public battle masking", () => {
    const actor = makeBattleUser("attacker", { enmity: 500 });
    const users = [actor];
    const tag = makeEffect(
      "clone",
      { power: 100, rounds: 3 },
      { creatorId: "attacker", isNew: true, longitude: 2, latitude: 2 },
    ) as GroundEffect;
    clone(users, tag, { jutsus: {} });
    expect(users[1]?.enmity).toBe(0);
    expect(actor.enmity).toBe(500);
    const masked = maskBattle(makeCompleteBattle({ usersState: users }), "opponent");
    expect(masked.usersState[0]?.enmity).toBe(500);
    expect(masked.usersState[1]?.enmity).toBe(0);
  });

  it("accepts both modes and passive gear and rejects negative power", () => {
    const schema = z
      .array(z.union([IncreaseAggroTag, DecreaseAggroTag]))
      .superRefine(SuperRefinePassiveEffects);
    expect(
      schema.safeParse([
        { type: "increaseaggro", power: 50 },
        { type: "decreaseaggro", power: 30 },
      ]).success,
    ).toBe(true);
    expect(IncreaseAggroTag.safeParse({ power: -1 }).success).toBe(false);
    expect(DecreaseAggroTag.safeParse({ aggroMode: "invalid" }).success).toBe(false);
  });
});
