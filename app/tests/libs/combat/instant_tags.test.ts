import { describe, expect, it } from "bun:test";
import { insertAction } from "@/libs/combat/actions";
import { applyEffects } from "@/libs/combat/process";
import { alignBattle, calcApReduction } from "@/libs/combat/turn";
import type { CombatAction, CompleteBattle } from "@/libs/combat/types";
import { getActiveTargetEffects, getBattleGrid } from "@/libs/combat/util";
import { inheritJutsuReskinEffects } from "@/libs/jutsu/reskins";
import { AllTags, type ZodAllTags } from "@/validators/combat";
import {
  makeBattleUser,
  makeCombatAction,
  makeCompleteBattle,
  makeEffect,
  makeTag,
} from "../../setup/combat";

const scenario = () =>
  makeCompleteBattle({
    round: 2,
    width: 5,
    height: 5,
    createdAt: new Date(0),
    usersState: [
      makeBattleUser("attacker", { curHealth: 1000, maxHealth: 5000 }),
      makeBattleUser("defender", {
        curHealth: 1000,
        maxHealth: 5000,
        direction: "right",
      }),
    ],
  });
const cast = (
  battle: CompleteBattle,
  effects: ZodAllTags[],
  overrides: Partial<CombatAction> = {},
  position = { longitude: 1, latitude: 0 },
) => {
  const action = makeCombatAction({
    id: "instant-jutsu",
    name: "Instant jutsu",
    type: "jutsu",
    target: "OPPONENT",
    range: 3,
    level: 0,
    effects,
    ...overrides,
  });
  expect(
    insertAction({
      battle,
      action,
      actorId: "attacker",
      ...position,
      grid: getBattleGrid(20, battle),
    }),
  ).toBe(true);
  return { action, ...applyEffects(battle, "attacker", action) };
};
const hp = (battle: CompleteBattle, id = "defender") =>
  battle.usersState.find((user) => user.userId === id)!.curHealth;
const damage = (instant?: boolean, rounds = 0) =>
  makeTag("damage", {
    power: 10,
    powerPerLevel: 0,
    calculation: "static",
    rounds,
    instant,
  });

describe("instant Jutsu tags", () => {
  it("round-trips timing without changing legacy defaults or reskin mechanics", () => {
    const tag = damage(true, 3);
    expect(AllTags.parse(JSON.parse(JSON.stringify(tag))).instant).toBe(true);
    expect(damage().instant).toBeUndefined();
    expect(inheritJutsuReskinEffects([tag], [damage(false)])[0]?.instant).toBe(true);
    expect(inheritJutsuReskinEffects([damage(false)], [tag])[0]?.instant).toBe(false);
  });

  it.each([undefined, false, true])(
    "applies duration damage on the casting round only when instant is %s",
    (instant) => {
      const { newBattle } = cast(scenario(), [damage(instant, 3)]);
      expect(hp(newBattle) < 1000).toBe(instant === true);
    },
  );

  it("ticks recurring damage once per round, including its casting round", () => {
    const result = cast(scenario(), [damage(true, 3)]);
    const health = hp(result.newBattle);
    expect(health).toBeLessThan(1000);
    const again = applyEffects(result.newBattle, "defender", result.action).newBattle;
    expect(hp(again)).toBe(health);
    again.round++;
    expect(hp(applyEffects(again, "defender").newBattle)).toBeLessThan(health);
  });

  it("allows same-cast damage modifiers independent of authored tag order", () => {
    const base = hp(cast(scenario(), [damage()]).newBattle);
    for (const instant of [false, true]) {
      for (const reverse of [false, true]) {
        const tags = [
          damage(),
          makeTag("increasedamagegiven", {
            target: "SELF",
            power: 50,
            calculation: "percentage",
            instant,
            rounds: 3,
          }),
        ];
        const { newBattle } = cast(scenario(), reverse ? tags.reverse() : tags);
        if (instant) expect(hp(newBattle)).toBeLessThan(base);
        else expect(hp(newBattle)).toBe(base);
      }
    }
  });

  it.each([false, true])(
    "resolves stealth after inserting the full cast (stealth first: %s)",
    (stealthFirst) => {
      const base = hp(cast(scenario(), [damage()]).newBattle);
      for (const instant of [false, true]) {
        for (const power of [0, 100]) {
          const tags = [makeTag("stealth", { instant, power, rounds: 3 }), damage()];
          const { action, newBattle } = cast(
            scenario(),
            stealthFirst ? tags : tags.reverse(),
          );
          expect(hp(newBattle)).toBe(base);
          expect(action.battleDescription).not.toContain("cannot be targeted");
          expect(
            newBattle.usersEffects.some((effect) => effect.type === "stealth"),
          ).toBe(power === 100);
          const followup = cast(newBattle, [damage()], { id: "followup-jutsu" });
          if (instant && power === 100) {
            expect(hp(followup.newBattle)).toBe(base);
            expect(followup.action.battleDescription).toContain("cannot be targeted");
          } else {
            expect(hp(followup.newBattle)).toBeLessThan(base);
          }
        }
      }
    },
  );

  it("handles mixed instant and delayed recurring tags independently", () => {
    const { newBattle } = cast(scenario(), [
      damage(true, 3),
      makeTag("heal", { target: "SELF", power: 10, rounds: 3 }),
    ]);
    expect(hp(newBattle)).toBeLessThan(1000);
    expect(hp(newBattle, "attacker")).toBe(1000);
  });

  it("starts healing immediately without repeating it on other actors' actions", () => {
    const { newBattle } = cast(scenario(), [
      makeTag("heal", { target: "SELF", power: 10, rounds: 3, instant: true }),
    ]);
    expect(hp(newBattle, "attacker")).toBeGreaterThan(1000);
    const again = applyEffects(newBattle, "defender").newBattle;
    expect(hp(again, "attacker")).toBe(hp(newBattle, "attacker"));
  });

  it("makes instant stun and action restrictions visible to subsequent actions", () => {
    const { newBattle } = cast(scenario(), [
      makeTag("stun", { power: 100, apReduction: 20, rounds: 3, instant: true }),
    ]);
    expect(calcApReduction(newBattle, "defender")).toBe(20);
    const { newBattle: delayed } = cast(scenario(), [
      makeTag("stun", { power: 100, apReduction: 20, rounds: 3 }),
    ]);
    expect(calcApReduction(delayed, "defender")).toBe(0);
  });

  it("keeps non-Jutsu timing unchanged even if its JSON contains instant", () => {
    const { newBattle } = cast(scenario(), [damage(true, 3)], { type: "item" });
    expect(hp(newBattle)).toBe(1000);
  });

  it("counts the casting round toward instant duration and preserves delayed duration", () => {
    const battle = cast(scenario(), [
      damage(true, 3),
      makeTag("heal", { target: "SELF", power: 10, rounds: 3 }),
    ]).newBattle;
    for (const remaining of [2, 1, 0]) {
      battle.usersState.forEach((user) => {
        user.actionPoints = 0;
        user.round = battle.round;
      });
      battle.roundStartAt = new Date(0);
      expect(alignBattle(battle, [], "attacker").progressRound).toBe(true);
      expect(
        battle.usersEffects.find((effect) => effect.type === "damage")?.rounds,
      ).toBe(remaining);
      expect(battle.usersEffects.find((effect) => effect.type === "heal")?.rounds).toBe(
        remaining + 1,
      );
    }
  });

  it("keeps prevention activation and Clear interactions unchanged", () => {
    const instantPrevent = makeEffect(
      "healprevent",
      { instant: true, power: 100, rounds: 3 },
      {
        fromType: "jutsu",
        targetId: "attacker",
        isNew: false,
        castThisRound: true,
        createdRound: 2,
      },
    );
    expect(
      getActiveTargetEffects([instantPrevent], "attacker", "healprevent", false),
    ).toHaveLength(0);
    const battle = scenario();
    battle.usersEffects = [instantPrevent];
    const { newBattle } = cast(battle, [
      damage(),
      makeTag("vamp", { power: 50, rounds: 0 }),
    ]);
    expect(hp(newBattle, "attacker")).toBeGreaterThan(1000);
    const cleared = cast(scenario(), [
      damage(),
      makeTag("increasedamagetaken", { instant: true, power: 50, rounds: 3 }),
      makeTag("cleanse", { power: 100 }),
    ]);
    expect(hp(cleared.newBattle)).toBe(hp(cast(scenario(), [damage()]).newBattle));
  });

  it("keeps ground projections immediate and unaffected by the opt-in", () => {
    for (const instant of [false, true]) {
      const { newBattle } = cast(scenario(), [damage(instant, 3)], {
        target: "GROUND",
      });
      expect(hp(newBattle)).toBeLessThan(1000);
    }
  });

  it("combines existing and same-cast potency once, excluding delayed tags from the cast", () => {
    const battle = scenario();
    battle.usersEffects = [
      makeEffect(
        "increasepotency",
        { target: "SELF", power: 20, calculation: "static", affectedTag: "damage" },
        { fromType: "bloodline", targetId: "attacker", targetType: "user" },
      ),
    ];
    const { newBattle } = cast(battle, [
      damage(true, 3),
      makeTag("increasepotency", {
        instant: true,
        target: "SELF",
        power: 50,
        calculation: "percentage",
        affectedTag: "damage",
      }),
      makeTag("increasepotency", {
        target: "SELF",
        power: 100,
        calculation: "static",
        affectedTag: "damage",
      }),
    ]);
    const hit = newBattle.usersEffects.find((effect) => effect.type === "damage")!;
    expect(hit.power).toBe(45);
    expect(hit.powerPerLevel).toBe(0);
    const again = applyEffects(newBattle, "defender").newBattle;
    expect(again.usersEffects.find((effect) => effect.id === hit.id)?.power).toBe(45);
  });

  it("does not grant same-cast potency if its normal prevention roll rejects it", () => {
    const battle = scenario();
    battle.usersEffects = [
      makeEffect(
        "buffprevent",
        { power: 100, rounds: 3 },
        { targetId: "attacker", targetType: "user", createdRound: 1 },
      ),
    ];
    const { newBattle } = cast(battle, [
      damage(true, 3),
      makeTag("increasepotency", {
        instant: true,
        target: "SELF",
        power: 50,
        affectedTag: "damage",
      }),
    ]);
    expect(
      newBattle.usersEffects.find((effect) => effect.type === "damage")?.power,
    ).toBe(10);
  });
});

it("does not rebake earlier ground casts of the same Jutsu in one round", () => {
  const tags = [
    damage(false, 3),
    makeTag("increasepotency", {
      instant: true,
      target: "SELF",
      power: 20,
      affectedTag: "damage",
    }),
  ];
  const first = cast(scenario(), tags, { target: "GROUND", actionCostPerc: 10 });
  const ground = first.newBattle.groundEffects.find(
    (effect) => effect.type === "damage",
  )!;
  expect(ground.power).toBe(30);
  const second = cast(first.newBattle, tags, { target: "GROUND", actionCostPerc: 10 });
  expect(
    second.newBattle.groundEffects.find((effect) => effect.id === ground.id)?.power,
  ).toBe(30);
});

it("preserves same-cast ground potency timing regardless of its instant field", () => {
  const results = [false, true].map((instant) => {
    const result = cast(
      scenario(),
      [
        damage(false, 3),
        makeTag("increasepotency", {
          instant,
          target: "INHERIT",
          power: 20,
          affectedTag: "damage",
        }),
      ],
      { target: "GROUND" },
      { longitude: 0, latitude: 0 },
    );
    return {
      hp: hp(result.newBattle, "attacker"),
      power: result.newBattle.groundEffects.find((effect) => effect.type === "damage")
        ?.power,
    };
  });
  expect(results[0]).toEqual(results[1]);
});

it("retains existing potency when an instant potency tag has no eligible recipient", () => {
  const battle = scenario();
  battle.usersEffects = [
    makeEffect(
      "increasepotency",
      { power: 20, affectedTag: "damage" },
      { targetId: "attacker", targetType: "user", fromType: "bloodline" },
    ),
  ];
  const result = cast(battle, [
    damage(true, 3),
    makeTag("increasepotency", {
      instant: true,
      target: "SELF",
      friendlyFire: "ENEMIES",
      power: 50,
      affectedTag: "damage",
    }),
  ]);
  expect(
    result.newBattle.usersEffects.find((effect) => effect.type === "damage")?.power,
  ).toBe(30);
});
