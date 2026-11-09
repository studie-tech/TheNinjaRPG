import { describe, expect, it } from "bun:test";
import { insertAction } from "@/libs/combat/actions";
import { applyEffects } from "@/libs/combat/process";
import type { ReturnedBattle, UserEffect } from "@/libs/combat/types";
import { getBattleGrid } from "@/libs/combat/util";
import {
  BarrierTag,
  CloneTag,
  DamageTag,
  HealTag,
  MoveTag,
  PoisonTag,
  StealthTag,
  SummonTag,
  VisualTag,
} from "@/validators/combat";
import {
  makeBasicAttack,
  makeBattleUser,
  makeCompleteBattle,
} from "../../setup/combat";

const setup = () => {
  const stats = { curHealth: 1000, maxHealth: 1000, offence: 100, defence: 100 };
  const actor = makeBattleUser("actor", {
    ...stats,
    direction: "left",
    longitude: 0,
    latitude: 0,
  });
  const enemy = makeBattleUser("enemy", {
    ...stats,
    direction: "right",
    longitude: 1,
    latitude: 0,
  });
  const ally = makeBattleUser("ally", {
    ...stats,
    direction: "left",
    longitude: 0,
    latitude: 1,
  });
  const battle = makeCompleteBattle({
    width: 5,
    height: 5,
    createdAt: new Date("2020-01-01T00:00:00Z"),
    updatedAt: new Date("2020-01-01T00:00:00Z"),
    roundStartAt: new Date("2020-01-01T00:00:00Z"),
    usersState: [actor, enemy, ally],
  });
  battle.usersState[0]!.enemySkillIds = ["skill", "bloodright"];
  battle.extraState.enemySkills = {
    skill: [PoisonTag.parse({ power: 20, powerPerLevel: 0, rounds: 3 })],
    bloodright: [PoisonTag.parse({ power: 10, powerPerLevel: 0, rounds: 2 })],
  };
  const action = makeBasicAttack({ range: 3 });
  const cast = (longitude = 1, latitude = 0) =>
    insertAction({
      battle,
      grid: getBattleGrid(20, battle as unknown as ReturnedBattle),
      action,
      actorId: "actor",
      longitude,
      latitude,
    });
  const procs = () => battle.usersEffects.filter((e) => e.fromType === "skill");
  return { actor, battle, action, enemy, cast, procs };
};

describe("enemy-targeted skill and bloodright effects", () => {
  it("casts fresh effects from both sources on the attacked enemy, retaining immutable templates", () => {
    const { battle, cast, procs } = setup();
    const templates = structuredClone(battle.extraState.enemySkills);
    expect(cast()).toBe(true);
    expect(procs()).toHaveLength(2);
    for (const effect of procs()) {
      expect(effect).toMatchObject({
        creatorId: "actor",
        targetId: "enemy",
        fromType: "skill",
        level: 100,
        createdRound: 1,
        isNew: true,
        castThisRound: true,
      });
    }
    expect(procs().map((e) => e.actionId)).toEqual(["skill", "bloodright"]);
    expect(battle.extraState.enemySkills).toEqual(templates);
    expect(procs()[0]!.id).not.toBe(procs()[1]!.id);
  });

  it("does not trigger on allies or empty tiles", () => {
    const { cast, procs } = setup();
    cast(0, 1);
    cast(2, 0);
    expect(procs()).toHaveLength(0);
  });

  it.each([
    SummonTag.parse({ aiId: "summoned-ai" }),
    CloneTag.parse({}),
    BarrierTag.parse({ staticAssetPath: "barrier" }),
    VisualTag.parse({}),
  ])(
    "routes enemy $type tags to battlefield processing while preserving user passives",
    (tag) => {
      const { battle, cast, procs } = setup();
      battle.extraState.enemySkills!.skill = [tag];
      expect(cast()).toBe(true);
      expect(battle.groundEffects).toMatchObject([
        {
          type: tag.type,
          creatorId: "actor",
          longitude: 1,
          latitude: 0,
          fromType: "skill",
          createdRound: battle.round,
          isNew: true,
        },
      ]);
      expect(procs().map((effect) => effect.type)).toEqual(["poison"]);
      expect(battle.extraState.enemySkills!.skill).toEqual([tag]);
    },
  );

  it("ignores enemy movement passives without suppressing other sources", () => {
    const { battle, cast, procs } = setup();
    battle.extraState.enemySkills!.skill = [MoveTag.parse({})];
    expect(cast()).toBe(true);
    expect(battle.groundEffects).toEqual([]);
    expect(procs().map((effect) => effect.type)).toEqual(["poison"]);
    expect(applyEffects(battle, "actor").newBattle.usersState[0]).toMatchObject({
      longitude: 0,
      latitude: 0,
    });
  });

  it("does not trigger on self heals or movement", () => {
    for (const tag of [HealTag.parse({}), MoveTag.parse({})]) {
      const { action, cast, procs } = setup();
      action.target = tag.type === "move" ? "EMPTY_GROUND" : "SELF";
      action.effects = [tag];
      cast(tag.type === "move" ? 1 : 0);
      expect(procs()).toHaveLength(0);
    }
  });

  it("does not trigger when the target is stealthed or the action is unaffordable", () => {
    const stealth = setup();
    stealth.battle.usersEffects.push({
      ...StealthTag.parse({}),
      id: "stealth",
      targetId: "enemy",
      isNew: false,
      rounds: 3,
    } as UserEffect);
    stealth.cast();
    expect(stealth.procs()).toHaveLength(0);
    const unaffordable = setup();
    unaffordable.action.actionCostPerc = 200;
    expect(unaffordable.cast()).toBe(false);
    expect(unaffordable.procs()).toHaveLength(0);
  });

  it("triggers once per enemy for multi-tag area actions, excluding allies", () => {
    const { action, cast, procs } = setup();
    action.target = "CHARACTER";
    action.method = "AOE_CIRCLE_SPAWN";
    action.effects.push(DamageTag.parse({ power: 20 }));
    cast();
    expect(procs()).toHaveLength(2);
    expect(procs().every((e) => e.targetId === "enemy")).toBe(true);
  });

  it("triggers on enemies reached by ground actions and respects tag friendly-fire restrictions", () => {
    const { battle, action, cast, procs } = setup();
    action.target = "GROUND";
    battle.extraState.enemySkills!.bloodright![0]!.friendlyFire = "FRIENDLY";
    cast();
    expect(procs()).toHaveLength(1);
    expect(procs()[0]).toMatchObject({ targetId: "enemy", actionId: "skill" });
  });

  it("does not classify a teammate's summon as an enemy", () => {
    const { battle, cast, procs } = setup();
    const enemy = battle.usersState.find((u) => u.userId === "enemy")!;
    enemy.direction = "left";
    enemy.isSummon = true;
    enemy.controllerId = "ally";
    cast();
    expect(procs()).toHaveLength(0);
  });

  it("accepts battle snapshots without preloaded enemy skills", () => {
    const { battle, cast, procs } = setup();
    delete battle.extraState.enemySkills;
    delete battle.usersState[0]!.enemySkillIds;
    expect(cast()).toBe(true);
    expect(procs()).toHaveLength(0);
  });
});
