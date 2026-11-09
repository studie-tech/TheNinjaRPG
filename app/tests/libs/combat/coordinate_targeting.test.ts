import { describe, expect, it } from "bun:test";
import type { Item, Jutsu } from "@/drizzle/schema";
import {
  insertAction,
  userItemToAction,
  userJutsuToAction,
} from "@/libs/combat/actions";
import { validateActionTarget } from "@/libs/combat/targetValidation";
import type { CombatAction, GroundEffect, ReturnedBattle } from "@/libs/combat/types";
import {
  getActionAffectedTiles,
  getAffectedTiles,
  getBattleGrid,
} from "@/libs/combat/util";
import { getPossibleActionTiles } from "@/libs/hexgrid";
import {
  DamageTag,
  HealTag,
  JutsuValidator,
  JutsuValidatorRawSchema,
  MoveTag,
  SuperRefinePassiveEffects,
} from "@/validators/combat";
import {
  type CoordinateTargeting,
  coordinateTargetingSchema,
} from "@/validators/coordinateTargeting";
import {
  makeBattleUser,
  makeCombatAction,
  makeCompleteBattle,
  makeEffect,
  makeJutsu,
} from "../../setup/combat";

const coordinate = (longitude: number, latitude: number) => ({ longitude, latitude });
const pattern = (
  overrides: Partial<CoordinateTargeting> = {},
): CoordinateTargeting => ({
  origin: "BATTLEFIELD",
  selection: "ALL",
  coordinates: [coordinate(1, 1)],
  randomCount: 1,
  ...overrides,
});
const action = (overrides: Partial<CombatAction> = {}): CombatAction =>
  makeCombatAction({
    id: "pattern",
    name: "Pattern",
    target: "GROUND",
    method: "COORDINATES",
    coordinateTargeting: pattern(),
    range: 2,
    chakraCost: 10,
    level: 1,
    effects: [DamageTag.parse({ power: 10, calculation: "static", rounds: 2 })],
    ...overrides,
  });
const scenario = () => {
  const actor = makeBattleUser("actor", {
    longitude: 0,
    latitude: 0,
    direction: "left",
  });
  const ally = makeBattleUser("ally", { longitude: 1, latitude: 1, direction: "left" });
  const enemy = makeBattleUser("enemy", {
    longitude: 3,
    latitude: 3,
    direction: "right",
  });
  const battle = makeCompleteBattle({
    width: 5,
    height: 5,
    usersState: [actor, ally, enemy],
    createdAt: new Date(0),
    updatedAt: new Date(0),
    roundStartAt: new Date(),
    activeUserId: "actor",
  });
  const grid = getBattleGrid(20, battle as ReturnedBattle);
  const origin = grid.getHex({ col: 0, row: 0 });
  const clicked = grid.getHex({ col: 2, row: 2 });
  if (!origin || !clicked) throw new Error("Missing fixture tiles");
  const resolve = (cast = action(), preview = false) =>
    getAffectedTiles({
      a: origin,
      b: clicked,
      action: cast,
      grid,
      users: battle.usersState,
      ground: battle.groundEffects,
      userId: "actor",
      preview,
    });
  const cast = (ability = action(), longitude = 2, latitude = 2) =>
    insertAction({
      battle,
      grid,
      action: ability,
      actorId: "actor",
      longitude,
      latitude,
    });
  return { actor, ally, enemy, battle, grid, origin, clicked, resolve, cast };
};
const positions = (tiles: ReturnType<typeof getAffectedTiles>["green"]) =>
  [...tiles].map((tile) => `${tile.col},${tile.row}`).sort();

describe("coordinate pattern resolution", () => {
  it("selects fixed coordinates, deduplicates stored lists, and clips outside the map", () => {
    const { resolve } = scenario();
    expect(
      positions(
        resolve(
          action({
            coordinateTargeting: pattern({
              coordinates: [
                coordinate(0, 0),
                coordinate(4, 4),
                coordinate(4, 4),
                coordinate(99, 99),
              ],
            }),
          }),
        ).green,
      ),
    ).toEqual(["0,0", "4,4"]);
  });
  it("excludes safe tiles from the whole battlefield", () => {
    const { resolve } = scenario();
    const tiles = resolve(
      action({
        coordinateTargeting: pattern({
          selection: "EXCLUDE",
          coordinates: [coordinate(0, 0), coordinate(4, 4)],
        }),
      }),
    ).green;
    expect(tiles.size).toBe(23);
    expect(positions(tiles)).not.toContain("0,0");
    expect(positions(tiles)).not.toContain("4,4");
  });
  it.each(["CASTER", "TARGET"] as const)(
    "translates %s patterns as column/row offsets",
    (origin) => {
      const { resolve } = scenario();
      const tiles = resolve(
        action({
          coordinateTargeting: pattern({
            origin,
            coordinates: [coordinate(0, 0), coordinate(-1, 0), coordinate(1, 1)],
          }),
        }),
      ).green;
      expect(positions(tiles)).toEqual(
        origin === "CASTER" ? ["0,0", "1,1"] : ["1,2", "2,2", "3,3"],
      );
    },
  );
  it("chooses valid random candidates without replacement and caps the count", () => {
    const { resolve } = scenario();
    const ability = action({
      target: "OPPONENT",
      coordinateTargeting: pattern({
        selection: "RANDOM",
        randomCount: 10,
        coordinates: [coordinate(0, 0), coordinate(1, 1), coordinate(3, 3)],
      }),
    });
    expect(positions(resolve(ability).green)).toEqual(["3,3"]);
  });
  it("random empty lists sample the whole map while preview shows all candidates", () => {
    const { resolve } = scenario();
    const ability = action({
      coordinateTargeting: pattern({
        selection: "RANDOM",
        randomCount: 3,
        coordinates: [],
      }),
    });
    expect(resolve(ability).green.size).toBe(3);
    expect(resolve(ability, true).green.size).toBe(25);
  });
  it.each([
    "SELF",
    "ALLY",
    "OPPONENT",
    "OTHER_USER",
    "CHARACTER",
    "EMPTY_GROUND",
  ] as const)("preserves %s target eligibility", (target) => {
    const { resolve } = scenario();
    const tiles = resolve(
      action({
        target,
        coordinateTargeting: pattern({ selection: "EXCLUDE", coordinates: [] }),
      }),
    ).green;
    const expected =
      target === "SELF"
        ? 1
        : target === "ALLY"
          ? 2
          : target === "OPPONENT"
            ? 1
            : target === "OTHER_USER"
              ? 2
              : target === "CHARACTER"
                ? 3
                : 22;
    expect(tiles.size).toBe(expected);
  });
  it("excludes dead and fled characters", () => {
    const { enemy, resolve } = scenario();
    const ability = action({
      target: "OPPONENT",
      coordinateTargeting: pattern({ coordinates: [coordinate(3, 3)] }),
    });
    enemy.curHealth = 0;
    expect(resolve(ability).green.size).toBe(0);
    enemy.curHealth = 100;
    enemy.fledBattle = true;
    expect(resolve(ability).green.size).toBe(0);
  });
  it("uses normal barriers and damage eligibility", () => {
    const { battle, resolve } = scenario();
    battle.groundEffects.push({
      ...makeEffect("barrier", { staticAssetPath: "barrier" }),
      longitude: 1,
      latitude: 1,
    } as GroundEffect);
    expect(resolve(action()).green.size).toBe(1);
    expect(resolve(action({ effects: [HealTag.parse({})] })).green.size).toBe(0);
  });
  it.each([
    "SINGLE",
    "AOE_LINE_SHOOT",
    "AOE_WALL_SHOOT",
    "AOE_LARGE_WALL_SHOOT",
    "AOE_CIRCLE_SHOOT",
    "AOE_SPIRAL_SHOOT",
    "AOE_CIRCLE_SPAWN",
  ] as const)("constrains CHARACTER target selection by range for %s", (method) => {
    const { grid, origin } = scenario();
    const ability = action({ target: "CHARACTER", method, range: 0 });
    const targets = getPossibleActionTiles(ability, origin, grid);
    expect(targets?.size).toBe(1);
    expect(targets?.getHex(origin)).toBe(origin);
  });
  it("permits the full grid for CHARACTER actions with the ALL method", () => {
    const { grid, origin } = scenario();
    expect(
      getPossibleActionTiles(
        action({ target: "CHARACTER", method: "ALL", range: 0 }),
        origin,
        grid,
      ),
    ).toBe(grid);
  });
  it("restricts clicked target anchors but permits global and caster patterns", () => {
    const { grid, origin, clicked, battle } = scenario();
    for (const originType of ["BATTLEFIELD", "CASTER", "TARGET"] as const) {
      const ability = action({
        range: 0,
        coordinateTargeting: pattern({
          origin: originType,
          coordinates: [coordinate(0, 0)],
        }),
      });
      const restrictGrid = getPossibleActionTiles(ability, origin, grid);
      expect(
        getAffectedTiles({
          a: origin,
          b: clicked,
          action: ability,
          grid,
          restrictGrid,
          users: battle.usersState,
          ground: [],
          userId: "actor",
        }).green.size,
      ).toBe(originType === "TARGET" ? 0 : 1);
    }
  });
});

describe("coordinate casts and preview", () => {
  it("places damage, protection and healing on separate tiles in a single cast", () => {
    const { battle, cast } = scenario();
    const heal = HealTag.parse({
      target: "COORDINATES",
      coordinateTargeting: pattern({ coordinates: [coordinate(4, 4)] }),
      power: 20,
      calculation: "static",
      rounds: 2,
    });
    const protection = makeEffect("decreasedamagetaken", {
      target: "COORDINATES",
      coordinateTargeting: pattern({ coordinates: [coordinate(0, 0)] }),
      power: 50,
      calculation: "percentage",
    });
    expect(
      cast(
        action({
          coordinateTargeting: pattern({
            selection: "EXCLUDE",
            coordinates: [coordinate(0, 0), coordinate(4, 4)],
          }),
          effects: [DamageTag.parse({ rounds: 2 }), heal, protection],
        }),
      ),
    ).toBe(true);
    expect(
      battle.groundEffects.filter((effect) => effect.type === "damage"),
    ).toHaveLength(23);
    expect(
      battle.groundEffects
        .filter((effect) => effect.type === "heal")
        .map((effect) => [effect.longitude, effect.latitude]),
    ).toEqual([[4, 4]]);
    expect(
      battle.groundEffects
        .filter((effect) => effect.type === "decreasedamagetaken")
        .map((effect) => [effect.longitude, effect.latitude]),
    ).toEqual([[0, 0]]);
  });
  it("allows a coordinate tag outside the parent pattern and only charges once", () => {
    const { actor, battle, cast } = scenario();
    const before = actor.curChakra;
    expect(
      cast(
        action({
          method: "SINGLE",
          target: "SELF",
          range: 0,
          effects: [
            HealTag.parse({
              target: "COORDINATES",
              coordinateTargeting: pattern({ coordinates: [coordinate(4, 4)] }),
            }),
          ],
        }),
        0,
        0,
      ),
    ).toBe(true);
    expect(
      battle.groundEffects.map((effect) => [effect.longitude, effect.latitude]),
    ).toEqual([[4, 4]]);
    expect(actor.curChakra).toBe(before - 10);
    expect(actor.usedActions).toHaveLength(1);
  });
  it("shares one random parent sample among inherited tags", () => {
    const { battle, cast } = scenario();
    expect(
      cast(
        action({
          coordinateTargeting: pattern({
            selection: "RANDOM",
            coordinates: [],
            randomCount: 3,
          }),
          effects: [DamageTag.parse({}), HealTag.parse({ target: "INHERIT" })],
        }),
      ),
    ).toBe(true);
    const damage = battle.groundEffects
      .filter((effect) => effect.type === "damage")
      .map((effect) => `${effect.longitude},${effect.latitude}`)
      .sort();
    const heal = battle.groundEffects
      .filter((effect) => effect.type === "heal")
      .map((effect) => `${effect.longitude},${effect.latitude}`)
      .sort();
    expect(damage).toHaveLength(3);
    expect(heal).toEqual(damage);
  });
  it("applies self tags once for a multi-tile cast", () => {
    const { battle, cast } = scenario();
    expect(
      cast(
        action({
          coordinateTargeting: pattern({ selection: "EXCLUDE", coordinates: [] }),
          effects: [DamageTag.parse({}), HealTag.parse({ target: "SELF" })],
        }),
      ),
    ).toBe(true);
    expect(
      battle.usersEffects.filter(
        (effect) => effect.type === "heal" && effect.targetId === "actor",
      ),
    ).toHaveLength(1);
  });
  it.each(["GROUND", "OPPONENT"] as const)(
    "keeps an enemy-only self tag off the caster on a %s cast",
    (target) => {
      const { battle, cast } = scenario();
      expect(
        cast(
          action({
            target,
            coordinateTargeting: pattern({ selection: "EXCLUDE", coordinates: [] }),
            effects: [
              DamageTag.parse({}),
              HealTag.parse({ target: "SELF", friendlyFire: "ENEMIES" }),
            ],
          }),
        ),
      ).toBe(true);
      expect(battle.usersEffects.filter((effect) => effect.type === "heal")).toEqual(
        [],
      );
    },
  );
  it.each(["GROUND", "OPPONENT"] as const)(
    "applies self tags once when only independent coordinates accept a %s cast",
    (target) => {
      const { actor, battle, cast } = scenario();
      const before = { chakra: actor.curChakra, ap: actor.actionPoints };
      expect(
        cast(
          action({
            target,
            coordinateTargeting: pattern({
              origin: "CASTER",
              coordinates: [coordinate(-1, 0)],
            }),
            effects: [
              HealTag.parse({ target: "SELF" }),
              DamageTag.parse({}),
              DamageTag.parse({
                target: "COORDINATES",
                coordinateTargeting: pattern({
                  coordinates: [coordinate(3, 3), coordinate(4, 4)],
                }),
              }),
            ],
          }),
        ),
      ).toBe(true);
      expect(
        battle.usersEffects.filter(
          (effect) => effect.type === "heal" && effect.targetId === "actor",
        ),
      ).toHaveLength(1);
      expect(battle.usersEffects).toHaveLength(1);
      expect(
        battle.groundEffects.map((effect) => [effect.longitude, effect.latitude]),
      ).toEqual([
        [3, 3],
        [4, 4],
      ]);
      expect(actor.curChakra).toBe(before.chakra - 10);
      expect(actor.actionPoints).toBe(before.ap - 10);
      expect(actor.usedActions).toHaveLength(1);
    },
  );
  it("rejects self tags when all coordinate patterns are empty without spending costs", () => {
    const { actor, battle, cast } = scenario();
    const before = {
      health: actor.curHealth,
      chakra: actor.curChakra,
      stamina: actor.curStamina,
      ap: actor.actionPoints,
    };
    expect(
      cast(
        action({
          healthCost: 10,
          staminaCost: 10,
          coordinateTargeting: pattern({
            origin: "CASTER",
            coordinates: [coordinate(-1, 0)],
          }),
          effects: [
            HealTag.parse({ target: "SELF" }),
            DamageTag.parse({
              target: "COORDINATES",
              coordinateTargeting: pattern({ coordinates: [coordinate(99, 99)] }),
            }),
          ],
        }),
      ),
    ).toBe(false);
    expect(actor.curHealth).toBe(before.health);
    expect(actor.curChakra).toBe(before.chakra);
    expect(actor.curStamina).toBe(before.stamina);
    expect(actor.actionPoints).toBe(before.ap);
    expect(actor.usedActions).toEqual([]);
    expect(battle.usersEffects).toEqual([]);
    expect(battle.groundEffects).toEqual([]);
  });
  it("rejects empty patterns before spending pools, AP, or recording usage", () => {
    const { actor, battle, cast } = scenario();
    const before = { chakra: actor.curChakra, ap: actor.actionPoints };
    expect(
      cast(
        action({ coordinateTargeting: pattern({ coordinates: [coordinate(99, 99)] }) }),
      ),
    ).toBe(false);
    expect(actor.curChakra).toBe(before.chakra);
    expect(actor.actionPoints).toBe(before.ap);
    expect(actor.usedActions).toEqual([]);
    expect(battle.groundEffects).toEqual([]);
  });
  it("keeps End Turn valid when the action has no effects", () => {
    const { actor, origin, grid, battle, cast } = scenario();
    const wait = action({
      id: "wait",
      method: "SINGLE",
      target: "SELF",
      effects: [],
      range: 0,
      chakraCost: 0,
      actionCostPerc: 100,
    });
    expect(
      getActionAffectedTiles({
        a: origin,
        b: origin,
        action: wait,
        grid,
        users: battle.usersState,
        ground: [],
        userId: "actor",
      }).green.size,
    ).toBe(1);
    expect(cast(wait, 0, 0)).toBe(true);
    expect(actor.actionPoints).toBe(0);
  });
  it("previews random candidates and permits anchors on excluded safe tiles", () => {
    const { actor, origin, grid, battle } = scenario();
    const ability = action({
      coordinateTargeting: pattern({
        selection: "EXCLUDE",
        coordinates: [coordinate(0, 0)],
      }),
    });
    const result = validateActionTarget({
      user: actor,
      battle: battle as ReturnedBattle,
      action: ability,
      grid,
      target: origin,
      timeDiff: 0,
      precomputedUserId: "actor",
      precomputedActions: [ability],
    });
    expect(result.isValid).toBe(true);
    expect(result.greenTiles?.size).toBe(24);
  });
  it("preloads coordinate mechanics into both item and jutsu actions", () => {
    const { actor, battle } = scenario();
    const ability = action({ methodSize: { x: 2, y: 1 } });
    battle.extraState.jutsus = {
      pattern: {
        ...ability,
        id: "pattern",
        chakraCostReducePerLvl: 0,
        healthCostReducePerLvl: 0,
        staminaCostReducePerLvl: 0,
      } as unknown as Jutsu,
    };
    battle.extraState.items = {
      pattern: {
        ...ability,
        id: "pattern",
        chakraCostReducePerLvl: 0,
        healthCostReducePerLvl: 0,
        staminaCostReducePerLvl: 0,
      } as unknown as Item,
    };
    const jutsuAction = userJutsuToAction(
      { id: "owned", jutsuId: "pattern", level: 1, originalCooldown: 0 } as never,
      battle,
    );
    const itemAction = userItemToAction(
      { id: "owned", itemId: "pattern", originalCooldown: 0 } as never,
      actor,
      battle,
    );
    expect(jutsuAction.coordinateTargeting).toEqual(
      ability.coordinateTargeting ?? null,
    );
    expect(jutsuAction.methodSize).toEqual(ability.methodSize ?? null);
    expect(itemAction.methodSize).toEqual(ability.methodSize ?? null);
    expect(itemAction.coordinateTargeting).toEqual(ability.coordinateTargeting ?? null);
  });
});

describe("coordinate runtime guards", () => {
  it("rejects mixed movement and coordinate tags without spending pools", () => {
    const { actor, cast } = scenario();
    const before = actor.curChakra;
    expect(
      cast(
        action({
          method: "SINGLE",
          target: "EMPTY_GROUND",
          effects: [
            MoveTag.parse({}),
            DamageTag.parse({ target: "COORDINATES", coordinateTargeting: pattern() }),
          ],
        }),
      ),
    ).toBe(false);
    expect(actor.curChakra).toBe(before);
    expect(actor.longitude).toBe(0);
    expect(actor.latitude).toBe(0);
  });
  it("enforces range for target-relative tags on a global parent", () => {
    const { grid, origin } = scenario();
    const ability = action({
      method: "ALL",
      range: 0,
      effects: [
        DamageTag.parse({
          target: "COORDINATES",
          coordinateTargeting: pattern({ origin: "TARGET" }),
        }),
      ],
    });
    expect(getPossibleActionTiles(ability, origin, grid)?.size).toBe(1);
  });
  it("rejects coordinate tags for passive effects", () => {
    const issues: unknown[] = [];
    SuperRefinePassiveEffects(
      [DamageTag.parse({ target: "COORDINATES", coordinateTargeting: pattern() })],
      { addIssue: (issue: unknown) => issues.push(issue) } as never,
    );
    expect(issues).toHaveLength(1);
  });
});

describe("coordinate validation", () => {
  it("accepts relative negative offsets and random whole-map selection", () => {
    expect(
      coordinateTargetingSchema.safeParse(
        pattern({ origin: "CASTER", coordinates: [coordinate(-1, -1)] }),
      ).success,
    ).toBe(true);
    expect(
      coordinateTargetingSchema.safeParse(
        pattern({ selection: "RANDOM", coordinates: [] }),
      ).success,
    ).toBe(true);
  });
  it.each([
    { coordinates: [] },
    { coordinates: [coordinate(-1, 0)] },
    { coordinates: [coordinate(1.5, 0)] },
    { coordinates: [coordinate(0, 0), coordinate(0, 0)] },
    { selection: "RANDOM", randomCount: 0 },
    { selection: "RANDOM", randomCount: 1.5 },
  ])("rejects invalid coordinate configuration %j", (invalid) => {
    expect(
      coordinateTargetingSchema.safeParse({ ...pattern(), ...invalid }).success,
    ).toBe(false);
  });
  it("requires tag coordinate configuration and rejects coordinate movement", () => {
    const effects = JutsuValidatorRawSchema.shape.effects;
    expect(
      effects.safeParse([DamageTag.parse({ target: "COORDINATES" })]).success,
    ).toBe(false);
    expect(
      effects.safeParse([
        MoveTag.parse({ target: "COORDINATES", coordinateTargeting: pattern() }),
      ]).success,
    ).toBe(false);
  });
  it("requires a parent pattern and rejects coordinate parent movement", () => {
    const data = makeJutsu({
      jutsuType: "AI",
      requiredRank: "JONIN",
      method: "COORDINATES",
      target: "EMPTY_GROUND",
      actionCostPerc: 10,
      effects: [MoveTag.parse({})],
    });
    const result = JutsuValidator.safeParse({
      ...data,
      coordinateTargeting: pattern(),
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues.some((issue) => issue.path[0] === "method")).toBe(
        true,
      );
    const missing = JutsuValidator.safeParse({
      ...data,
      effects: [DamageTag.parse({})],
    });
    expect(missing.success).toBe(false);
    if (!missing.success)
      expect(
        missing.error.issues.some((issue) => issue.path[0] === "coordinateTargeting"),
      ).toBe(true);
  });
});
