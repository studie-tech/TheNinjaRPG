import { describe, expect, it } from "bun:test";
import { Grid, rectangle } from "honeycomb-grid";
import { performAIaction } from "@/libs/combat/ai_v2";
import type {
  BattleUserState,
  CompleteBattle,
  ExtraState,
  UserEffect,
} from "@/libs/combat/types";
import { applyPoolAdjustmentsToBase } from "@/libs/combat/util";
import { TerrainHex } from "@/libs/hexgrid";
import {
  ActionEndTurn,
  ActionMoveTowardsOpponent,
  ActionUseSpecificJutsu,
  AiRule,
  type AvailableTarget,
  ConditionHasEffect,
  ConditionHealthBelow,
  ConditionPlayerWithinRange,
  ConditionSpecificRound,
  ConditionSummonWithinRange,
  ConditionTargetHasEffect,
  enforceExtraRules,
  getActionSchema,
  getBackupRules,
  type ZodAllAiAction,
  type ZodAllAiCondition,
} from "@/validators/ai";
import { makeEffect, makeJutsu, makeTag } from "../../setup/combat";
import { makeAiBattle, makeAiUser as mkUser } from "./helpers/aiScenario";

const DAMAGE_JUTSU = "j-damage";
const PROFILE = "profile-1";

const damageJutsu = makeJutsu({
  id: DAMAGE_JUTSU,
  name: "Test Strike",
  battleDescription: "%user strikes %target",
  target: "CHARACTER",
  range: 20,
  staminaCost: 10,
  effects: [
    makeTag("damage", {
      power: 20,
      powerPerLevel: 0,
      calculation: "formula",
      statTypes: ["Ninjutsu"],
      generalTypes: [],
      elements: [],
      rounds: 0,
      target: "INHERIT",
      friendlyFire: "ALL",
      description: "dmg",
    }),
  ],
});

const mkBattle = (human: BattleUserState): CompleteBattle =>
  makeAiBattle({
    battleType: "ARENA",
    activeUserId: human.userId,
    width: 10,
    height: 10,
    usersState: [human],
    extraState: {
      jutsus: { [DAMAGE_JUTSU]: structuredClone(damageJutsu) },
      items: {},
      aiProfiles: {
        [PROFILE]: {
          id: PROFILE,
          name: "always strike",
          includeDefaultRules: false,
          rules: [],
        },
      } as unknown as ExtraState["aiProfiles"],
    },
  });

const setup = (
  target: AvailableTarget = "CLOSEST_OPPONENT",
  conditions: ZodAllAiCondition[] = [],
) => {
  const actor = mkUser({
    userId: "actor",
    controllerId: "actor",
    villageId: "ally",
    aiProfileId: PROFILE,
    longitude: 1,
    latitude: 1,
    jutsus: [
      {
        id: "uj1",
        jutsuId: DAMAGE_JUTSU,
        level: 1,
        experience: 0,
        equipped: true,
        lastUsedRound: -99,
        originalCooldown: 0,
      },
    ],
  });
  const battle = mkBattle(actor);
  battle.usersState = [
    actor,
    mkUser({
      userId: "boss",
      controllerId: "boss",
      villageId: "enemy",
      direction: "left",
      longitude: 4,
      latitude: 1,
      maxHealth: 9000,
      curHealth: 3000,
      enmity: 800,
    }),
    mkUser({
      userId: "minion",
      controllerId: "minion",
      villageId: "enemy",
      direction: "left",
      longitude: 3,
      latitude: 1,
      maxHealth: 2000,
      curHealth: 800,
      enmity: 20,
    }),
    mkUser({
      userId: "ally-boss",
      controllerId: "ally-boss",
      villageId: "ally",
      longitude: 1,
      latitude: 3,
      maxHealth: 10000,
    }),
    mkUser({
      userId: "ally-minion",
      controllerId: "ally-minion",
      villageId: "ally",
      longitude: 1,
      latitude: 2,
      maxHealth: 1000,
      curHealth: 1000,
    }),
  ];
  battle.extraState.aiProfiles[PROFILE]!.rules = [
    {
      conditions,
      action: ActionUseSpecificJutsu.parse({ jutsuId: DAMAGE_JUTSU, target }),
    },
    { conditions: [], action: ActionEndTurn.parse({}) },
  ];
  const grid = new Grid(TerrainHex, rectangle({ width: 10, height: 10 }));
  return { battle, grid, run: () => performAIaction(battle, grid, "actor") };
};

describe("AI targeting and clauses", () => {
  it.each([
    ["HIGHEST_ENMITY_OPPONENT", "boss"],
    ["LOWEST_ENMITY_OPPONENT", "minion"],
    ["HIGHEST_MAX_HEALTH_ALLY", "ally-boss"],
    ["HIGHEST_MAX_HEALTH_OPPONENT", "boss"],
    ["LOWEST_HEALTH_OPPONENT", "minion"],
    ["LOWEST_MAX_HEALTH_ALLY", "ally-minion"],
    ["CLOSEST_OPPONENT", "minion"],
    ["CLOSEST_ALLY", "actor"],
    ["SELF", "actor"],
  ] as const)("%s selects %s", (target, id) => {
    const { battle, run } = setup(target);
    const initial = battle.usersState.map((user) => ({
      id: user.userId,
      health: user.curHealth,
    }));
    const result = run();
    expect(result.nextActionId).toBe(DAMAGE_JUTSU);
    for (const before of initial) {
      const after = result.nextBattle.usersState.find(
        (user) => user.userId === before.id,
      )!;
      if (before.id === id) expect(after.curHealth).toBeLessThan(before.health);
      else expect(after.curHealth).toBe(before.health);
    }
  });

  for (const battleType of [
    "ARENA",
    "SPARRING",
    "KAGE_PVP",
    "CLAN_BATTLE",
    "COMBAT",
    "SHRINE_WAR",
    "QUEST",
    "OVERWORLD",
  ] as const) {
    it(`${battleType} targets enemies by side even when an ally shares the enemy template`, () => {
      const { battle, run } = setup("HIGHEST_MAX_HEALTH_OPPONENT");
      battle.battleType = battleType;
      for (const user of battle.usersState) {
        user.direction =
          user.userId.startsWith("ally") || user.userId === "actor" ? "left" : "right";
        user.villageId = "same-village";
        user.controllerId = "same-template";
      }
      const result = run();
      expect(result.nextActionId).toBe(DAMAGE_JUTSU);
      expect(
        result.nextBattle.usersState.find((u) => u.userId === "boss")?.curHealth,
      ).toBeLessThan(3000);
      expect(
        result.nextBattle.usersState.find((u) => u.userId === "ally-boss")?.curHealth,
      ).toBe(5000);
    });
  }

  it.each([
    ["same-village", "HIGHEST_MAX_HEALTH_OPPONENT", "boss"],
    ["same-village", "HIGHEST_MAX_HEALTH_ALLY", "ally-boss"],
    ["opposing-village", "HIGHEST_MAX_HEALTH_OPPONENT", "boss"],
    ["opposing-village", "HIGHEST_MAX_HEALTH_ALLY", "ally-boss"],
  ] as const)(
    "clan AI in %s uses %s to select %s on its battlefield team",
    (enemyVillage, target, id) => {
      const { battle, run } = setup(target);
      battle.battleType = "CLAN_BATTLE";
      for (const user of battle.usersState) {
        user.direction =
          user.userId.startsWith("ally") || user.userId === "actor" ? "left" : "right";
        user.villageId = user.direction === "left" ? "same-village" : enemyVillage;
      }
      const result = run();
      expect(result.nextActionId).toBe(DAMAGE_JUTSU);
      for (const user of battle.usersState) {
        const health = result.nextBattle.usersState.find(
          (u) => u.userId === user.userId,
        )!.curHealth;
        if (user.userId === id) expect(health).toBeLessThan(user.curHealth);
        else expect(health).toBe(user.curHealth);
      }
    },
  );

  it("ignores dead and fled targets", () => {
    const { battle, run } = setup("HIGHEST_MAX_HEALTH_OPPONENT");
    battle.usersState.push(
      mkUser({
        userId: "dead",
        villageId: "enemy",
        direction: "left",
        maxHealth: 99999,
        curHealth: 0,
      }),
      mkUser({
        userId: "fled",
        villageId: "enemy",
        direction: "left",
        maxHealth: 99999,
        fledBattle: true,
      }),
    );
    expect(
      run().nextBattle.usersState.find((user) => user.userId === "boss")!.curHealth,
    ).toBeLessThan(3000);
  });

  it.each(["HIGHEST_ENMITY_OPPONENT", "LOWEST_ENMITY_OPPONENT"] as const)(
    "%s ignores unavailable opponents and handles unset enmity",
    (target) => {
      const { battle, run } = setup(target);
      battle.usersState.push(
        mkUser({
          userId: "dead",
          villageId: "enemy",
          direction: "left",
          curHealth: 0,
          enmity: 9999,
        }),
        mkUser({
          userId: "fled",
          villageId: "enemy",
          direction: "left",
          fledBattle: true,
          enmity: 0,
        }),
      );
      const expected = target === "HIGHEST_ENMITY_OPPONENT" ? "boss" : "minion";
      expect(
        run().nextBattle.usersState.find((u) => u.userId === expected)!.curHealth,
      ).toBeLessThan(battle.usersState.find((u) => u.userId === expected)!.curHealth);
      for (const user of battle.usersState) delete user.enmity;
      expect(run().nextActionId).toBe(DAMAGE_JUTSU);
      battle.usersState = [battle.usersState[0]!];
      expect(() => run()).not.toThrow();
    },
  );

  it("uses effective maximum health including active pool effects", () => {
    const { battle, run } = setup("HIGHEST_MAX_HEALTH_OPPONENT");
    battle.usersEffects.push({
      id: "buff",
      type: "increasemaxpools",
      targetId: "minion",
      creatorId: "minion",
      power: 20000,
      powerPerLevel: 0,
      level: 1,
      calculation: "static",
      poolsAffected: ["Health"],
      rounds: 5,
    } as UserEffect);
    const minion = battle.usersState.find((user) => user.userId === "minion")!;
    applyPoolAdjustmentsToBase(minion, battle.usersEffects);
    const startingHealth = minion.curHealth;
    const result = run();
    expect(result.nextActionId).toBe(DAMAGE_JUTSU);
    expect(
      result.nextBattle.usersState.find((user) => user.userId === "boss")!.curHealth,
    ).toBe(3000);
    expect(
      result.nextBattle.usersState.find((user) => user.userId === "minion")!.curHealth,
    ).toBeLessThan(startingHealth);
  });

  for (const type of ["player", "summon"] as const) {
    const schema =
      type === "player" ? ConditionPlayerWithinRange : ConditionSummonWithinRange;
    it.each([
      [-1, false],
      [0, true],
      [1, false],
    ])(`${type} range boundary offset %s matches %s`, (offset, expected) => {
      const { battle, grid, run } = setup();
      const enemy = battle.usersState.find((user) => user.userId === "minion")!;
      enemy.isAi = type !== "player";
      enemy.isSummon = type === "summon";
      const origin = grid.getHex({ col: 1, row: 1 })!;
      const destination = grid.getHex({ col: enemy.longitude, row: enemy.latitude })!;
      const distance = grid.distance(origin, destination);
      battle.extraState.aiProfiles[PROFILE]!.rules[0]!.conditions = [
        schema.parse({ minRange: distance + offset, maxRange: distance + offset }),
      ];
      expect(run().nextActionId).toBe(expected ? DAMAGE_JUTSU : "wait");
    });
    it(`${type} range excludes allies, dead enemies and other combatant kinds`, () => {
      const { battle, run } = setup("CLOSEST_OPPONENT", [
        schema.parse({ maxRange: 20 }),
      ]);
      for (const user of battle.usersState) {
        user.isAi = type !== "player";
        user.isSummon = type === "summon";
      }
      // Keep the actor AI-driven, kill the minion, and leave the boss alive as an AI
      // non-summon, so it is neither a player nor a summon.
      battle.usersState[0]!.isAi = true;
      battle.usersState[1]!.curHealth = 0;
      battle.usersState[2]!.curHealth = 0;
      battle.usersState[1]!.curHealth = 3000;
      battle.usersState[1]!.isAi = true;
      battle.usersState[1]!.isSummon = false;
      expect(run().nextActionId).toBe("wait");
    });
  }

  describe.each([
    [
      "has_effect",
      "actor",
      "minion",
      (threshold: number) =>
        ConditionHasEffect.parse({ effectType: "shield", threshold }),
    ],
    [
      "target_has_effect",
      "minion",
      "actor",
      (threshold: number) =>
        ConditionTargetHasEffect.parse({ effectType: "shield", threshold }),
    ],
  ] as const)("%s", (_name, holder, bystander, condition) => {
    const shield = (
      id: string,
      targetId: string,
      power: number,
      type: "shield" | "heal" = "shield",
    ) =>
      makeEffect(
        type,
        { power, rounds: 5 },
        { id, targetId, creatorId: targetId, isNew: false, castThisRound: false },
      );
    const matches = (threshold: number, effects: UserEffect[]) => {
      const { battle, run } = setup("CLOSEST_OPPONENT", [condition(threshold)]);
      battle.usersEffects.push(...effects);
      return run().nextActionId === DAMAGE_JUTSU;
    };

    it("passes a zero threshold without any effect", () => {
      expect(matches(0, [])).toBe(true);
    });
    it("fails without a matching effect on its user", () => {
      expect(matches(1, [])).toBe(false);
      expect(matches(1, [shield("other", bystander, 50)])).toBe(false);
      expect(matches(1, [shield("other", holder, 50, "heal")])).toBe(false);
    });
    it("sums matching power up to and including the threshold", () => {
      const effects = [shield("first", holder, 20), shield("second", holder, 30)];
      expect(matches(50, effects)).toBe(true);
      expect(matches(51, effects)).toBe(false);
    });
  });

  it.each([
    [1, 100, true],
    [2, 100, false],
    [1, 10, false],
  ])("AND clauses round=%s health=%s", (round, health, matches) => {
    const { battle, run } = setup("CLOSEST_OPPONENT", [
      ConditionSpecificRound.parse({ value: round }),
      ConditionHealthBelow.parse({ value: health }),
    ]);
    battle.usersState[0]!.curHealth = 2500;
    expect(run().nextActionId).toBe(matches ? DAMAGE_JUTSU : "wait");
  });

  it.each([
    "EMPTY_GROUND_CLOSEST_TO_OPPONENT",
    "EMPTY_GROUND_CLOSEST_TO_SELF",
  ] as const)("%s uses actual candidate tile distances", (target) => {
    const { battle, grid, run } = setup(target);
    const jutsu = battle.extraState.jutsus[DAMAGE_JUTSU]!;
    jutsu.target = "GROUND";
    jutsu.range = 2;
    jutsu.effects = [
      { type: "move", power: 100, powerPerLevel: 0, target: "INHERIT" },
    ] as typeof jutsu.effects;
    const { nextBattle, nextActionId } = run();
    expect(nextActionId).toBe(DAMAGE_JUTSU);
    const actor = nextBattle.usersState[0]!;
    const selected = grid.getHex({ col: actor.longitude, row: actor.latitude })!;
    const center = grid.getHex(
      target === "EMPTY_GROUND_CLOSEST_TO_SELF"
        ? { col: 1, row: 1 }
        : { col: 3, row: 1 },
    )!;
    expect(grid.distance(selected, center)).toBe(1);
    expect(
      nextBattle.usersState
        .slice(1)
        .some(
          (user) =>
            user.longitude === actor.longitude && user.latitude === actor.latitude,
        ),
    ).toBe(false);
  });
});

describe("AI rule validation and compatibility", () => {
  it("accepts existing profiles without editor metadata", () => {
    const rule = { conditions: [], action: ActionEndTurn.parse({}) };
    expect(AiRule.parse(rule)).toEqual(rule);
  });
  it("rejects reversed, fractional, and negative ranges", () => {
    for (const condition of [
      { minRange: 5, maxRange: 2 },
      { minRange: -1 },
      { maxRange: 1.5 },
    ]) {
      expect(
        AiRule.safeParse({
          conditions: [{ type: "player_within_range", ...condition }],
          action: ActionEndTurn.parse({}),
        }).success,
      ).toBe(false);
    }
  });
  it("does not duplicate catch-alls with editor metadata", () => {
    const rules = getBackupRules().map((rule, index) => ({
      ...rule,
      id: `${index}`,
      group: { id: "group", name: "Fallback", note: "" },
    }));
    enforceExtraRules(rules, getBackupRules());
    expect(rules).toHaveLength(getBackupRules().length);
  });
});

describe("AI coordinate actions", () => {
  const coordinateAction = (longitude: number, latitude: number) =>
    ActionUseSpecificJutsu.parse({
      jutsuId: DAMAGE_JUTSU,
      target: "COORDINATE",
      coordinates: { longitude, latitude },
    });
  it("attacks the character on the configured tile rather than the closest enemy", () => {
    const { battle, run } = setup();
    battle.extraState.aiProfiles[PROFILE]!.rules[0]!.action = coordinateAction(4, 1);
    const result = run();
    expect(result.nextActionId).toBe(DAMAGE_JUTSU);
    expect(result.nextBattle.usersState[1]!.curHealth).toBeLessThan(3000);
    expect(result.nextBattle.usersState[2]!.curHealth).toBe(800);
  });
  it.each([
    [99, 1],
    [1, 99],
    [0, 0],
  ])("skips invalid character target (%s, %s) without spending pools", (x, y) => {
    const { battle, run } = setup();
    battle.extraState.aiProfiles[PROFILE]!.rules[0]!.action = coordinateAction(x, y);
    const result = run();
    expect(result.nextActionId).toBe("wait");
    expect(result.nextBattle.usersState[0]!.curStamina).toBe(5000);
    expect(result.nextBattle.usersState[0]!.jutsus[0]!.lastUsedRound).toBe(-99);
  });
  it("respects jutsu range and falls through to the next rule", () => {
    const { battle, run } = setup();
    battle.extraState.aiProfiles[PROFILE]!.rules[0]!.action = coordinateAction(4, 1);
    battle.extraState.jutsus[DAMAGE_JUTSU]!.range = 1;
    expect(run().nextActionId).toBe("wait");
  });
  it("casts a ground movement jutsu at the exact coordinate", () => {
    const { battle, run } = setup();
    battle.extraState.aiProfiles[PROFILE]!.rules[0]!.action = coordinateAction(7, 4);
    const jutsu = battle.extraState.jutsus[DAMAGE_JUTSU]!;
    jutsu.target = "EMPTY_GROUND";
    jutsu.effects = [
      { type: "move", power: 100, powerPerLevel: 0, target: "INHERIT" },
    ] as typeof jutsu.effects;
    const result = run();
    expect(result.nextActionId).toBe(DAMAGE_JUTSU);
    expect(result.nextBattle.usersState[0]!.longitude).toBe(7);
    expect(result.nextBattle.usersState[0]!.latitude).toBe(4);
  });
  it("rejects occupied destinations for ground movement", () => {
    const { battle, run } = setup();
    battle.extraState.aiProfiles[PROFILE]!.rules[0]!.action = coordinateAction(4, 1);
    const jutsu = battle.extraState.jutsus[DAMAGE_JUTSU]!;
    jutsu.target = "EMPTY_GROUND";
    jutsu.effects = [
      { type: "move", power: 100, powerPerLevel: 0, target: "INHERIT" },
    ] as typeof jutsu.effects;
    expect(run().nextActionId).toBe("wait");
  });
  it("summons a preloaded creature at the configured coordinate", () => {
    const { battle, run } = setup();
    battle.usersState.push(
      mkUser({
        userId: "template",
        controllerId: "totem",
        isSummon: true,
        isSummonTemplate: true,
        curHealth: 0,
        longitude: -1,
        latitude: -1,
      }),
    );
    const jutsu = battle.extraState.jutsus[DAMAGE_JUTSU]!;
    jutsu.target = "EMPTY_GROUND";
    jutsu.effects = [
      {
        type: "summon",
        aiId: "totem",
        aiHp: 100,
        power: 100,
        powerPerLevel: 0,
        calculation: "percentage",
        rounds: 3,
        target: "INHERIT",
      },
    ] as typeof jutsu.effects;
    battle.extraState.aiProfiles[PROFILE]!.rules[0]!.action = coordinateAction(7, 4);
    const result = run();
    expect(result.nextActionId).toBe(DAMAGE_JUTSU);
    const summoned = result.nextBattle.usersState.find(
      (u) => u.controllerId === "actor" && u.isSummon,
    );
    expect(summoned).toMatchObject({ longitude: 7, latitude: 4, curHealth: 100 });
  });
  it.each([
    "use_random_jutsu",
    "use_highest_power_action",
    "use_highest_power_jutsu",
    "use_combo_action",
  ] as const)("%s uses the same coordinate resolver", (type) => {
    const { battle, run } = setup();
    battle.extraState.aiProfiles[PROFILE]!.rules[0]!.action = getActionSchema(
      type,
    ).parse({
      target: "COORDINATE",
      coordinates: { longitude: 4, latitude: 1 },
      effect: "damage",
      comboIds: [DAMAGE_JUTSU],
    }) as ZodAllAiAction;
    const result = run();
    expect(result.nextActionId).toBe(DAMAGE_JUTSU);
    expect(result.nextBattle.usersState[1]!.curHealth).toBeLessThan(3000);
  });
  it.each(["use_specific_item", "use_random_item", "use_highest_power_item"] as const)(
    "%s targets the configured tile",
    (type) => {
      const { battle, run } = setup();
      const itemId = "coordinate-item";
      battle.usersState[0]!.jutsus = [];
      battle.usersState[0]!.items = [
        {
          id: "owned",
          itemId,
          quantity: 2,
          level: 1,
          experience: 0,
          dropChancePerc: 0,
          durability: 100,
          equipped: "HAND_1",
          lastUsedRound: -99,
          originalCooldown: 0,
        },
      ] as BattleUserState["items"];
      battle.extraState.items[itemId] = {
        ...structuredClone(damageJutsu),
        id: itemId,
        itemType: "WEAPON",
        maxDurability: 100,
        preventBattleUsage: false,
      } as unknown as (typeof battle.extraState.items)[string];
      battle.extraState.aiProfiles[PROFILE]!.rules[0]!.action = getActionSchema(
        type,
      ).parse({
        itemId,
        target: "COORDINATE",
        coordinates: { longitude: 4, latitude: 1 },
        effect: "damage",
      }) as ZodAllAiAction;
      const result = run();
      expect(result.nextActionId).toBe(itemId);
      expect(result.nextBattle.usersState[1]!.curHealth).toBeLessThan(3000);
      expect(result.nextBattle.usersState[2]!.curHealth).toBe(800);
    },
  );
  it("walks the final step onto an adjacent coordinate", () => {
    const { battle, run } = setup();
    battle.extraState.aiProfiles[PROFILE]!.rules[0]!.action =
      ActionMoveTowardsOpponent.parse({
        target: "COORDINATE",
        coordinates: { longitude: 0, latitude: 1 },
      });
    const result = run();
    expect(result.nextActionId).toBe("move");
    expect(result.nextBattle.usersState[0]!.longitude).toBe(0);
    expect(result.nextBattle.usersState[0]!.latitude).toBe(1);
  });
  it("skips movement once already at the coordinate", () => {
    const { battle, run } = setup();
    battle.extraState.aiProfiles[PROFILE]!.rules[0]!.action =
      ActionMoveTowardsOpponent.parse({
        target: "COORDINATE",
        coordinates: { longitude: 1, latitude: 1 },
      });
    expect(run().nextActionId).toBe("wait");
  });
  it("skips movement to a blocked adjacent coordinate", () => {
    const { battle, run } = setup();
    battle.extraState.aiProfiles[PROFILE]!.rules[0]!.action =
      ActionMoveTowardsOpponent.parse({
        target: "COORDINATE",
        coordinates: { longitude: 1, latitude: 2 },
      });
    expect(run().nextActionId).toBe("wait");
  });
  it("paths toward distant coordinates one legal step at a time", () => {
    const { battle, grid, run } = setup();
    battle.extraState.aiProfiles[PROFILE]!.rules[0]!.action =
      ActionMoveTowardsOpponent.parse({
        target: "COORDINATE",
        coordinates: { longitude: 0, latitude: 5 },
      });
    const result = run();
    expect(result.nextActionId).toBe("move");
    const moved = result.nextBattle.usersState[0]!;
    expect(
      grid.distance(
        grid.getHex({ col: 1, row: 1 })!,
        grid.getHex({ col: moved.longitude, row: moved.latitude })!,
      ),
    ).toBe(1);
  });
});
