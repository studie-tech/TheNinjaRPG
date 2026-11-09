import { describe, expect, it } from "bun:test";
import { SHIELD_MAX_HEALTH } from "@/drizzle/constants";
import { insertAction } from "@/libs/combat/actions";
import { SAGE_MODE_ACTIVATION_JUTSU } from "@/libs/sageMode";
import { applyEffects } from "@/libs/combat/process";
import { getBattleGrid } from "@/libs/combat/util";
import {
  ClearTag,
  ConsumeTag,
  DamageTag,
  JutsuValidatorRawSchema,
  SageModeValidator,
} from "@/validators/combat";
import type {
  BattleUserState,
  CombatAction,
  CompleteBattle,
  UserEffect,
} from "@/libs/combat/types";
import {
  makeBattleUser,
  makeCombatAction,
  makeCompleteBattle,
  makeDamageEffect,
  makeEffect,
  makeJutsu,
  makeShield,
} from "../../setup/combat";
import { makeActivateSageEffect, makeSageMode } from "./helpers/sageMode";

const ROUND = 3;

const makeBattle = (
  usersState: BattleUserState[],
  usersEffects: UserEffect[],
): CompleteBattle => makeCompleteBattle({ round: ROUND, usersState, usersEffects });

const makeAttacker = (overrides: Record<string, unknown> = {}) =>
  makeBattleUser("attacker", { curHealth: 1000, maxHealth: 1000, ...overrides });
const makeDefender = (id = "defender", overrides: Record<string, unknown> = {}) =>
  makeBattleUser(id, {
    curHealth: 100_000_000,
    maxHealth: 100_000_000,
    ...overrides,
  });

const makeAttack = (
  id = "damage-1",
  creatorId = "attacker",
  targetId = "defender",
): UserEffect =>
  makeDamageEffect({
    id,
    creatorId,
    targetId,
    isNew: true,
    castThisRound: true,
    createdRound: ROUND,
    rounds: 0,
    targetType: "user",
  } as Partial<UserEffect>);

const makeConsume = (power: number, shieldRounds = 3, rounds = 3): UserEffect =>
  makeEffect(
    "consume",
    { power, calculation: "percentage", shieldRounds, rounds },
    {
      id: "consume-1",
      creatorId: "attacker",
      targetId: "attacker",
      isNew: true,
      castThisRound: true,
      createdRound: ROUND,
      actionId: "consume-action",
      targetType: "user",
    },
  );

const consumeShields = (effects: UserEffect[]) =>
  effects.filter(
    (e) => e.type === "shield" && e.targetId === "attacker" && (e.power ?? 0) > 0,
  );
const findConsumeShield = (effects: UserEffect[]) => consumeShields(effects)[0];

/** Health `before` lost by the time `battle` was reached. */
const healthLostBy = (before: BattleUserState, battle: CompleteBattle) =>
  before.curHealth -
  (battle.usersState.find((u) => u.userId === before.userId)?.curHealth ?? 0);

describe("applyEffects — consume", () => {
  it("converts a percentage of damage dealt into a shield on the attacker", () => {
    const attacker = makeAttacker();
    const defender = makeDefender();
    const battle = makeBattle([attacker, defender], [makeAttack(), makeConsume(50)]);
    const { newBattle, actionEffects } = applyEffects(
      battle,
      "attacker",
      makeCombatAction(),
    );

    const healthLost = healthLostBy(defender, newBattle);
    expect(healthLost).toBeGreaterThan(0);

    const shields = consumeShields(newBattle.usersEffects);
    expect(shields).toHaveLength(1);
    expect(shields[0]?.power).toBeCloseTo(Math.floor(healthLost * 0.5), 0);
    expect(shields[0]?.rounds).toBe(3);
    expect(
      actionEffects.some((e) => e.txt.includes("consumes") && e.txt.includes("shield")),
    ).toBe(true);
  });

  it("keeps the active duration separate from the generated shield duration", () => {
    const battle = makeBattle(
      [makeAttacker(), makeDefender()],
      [makeAttack(), makeConsume(25, 5)],
    );
    const { newBattle } = applyEffects(battle, "attacker", makeCombatAction());

    expect(newBattle.usersEffects.find((e) => e.type === "consume")?.rounds).toBe(3);
    const shield = newBattle.usersEffects.find(
      (e) => e.type === "shield" && e.targetId === "attacker",
    );
    expect(shield).toBeDefined();
    expect(shield?.rounds).toBe(5);
  });

  it("sizes the consume shield off pre-shield damage when the defender has a shield", () => {
    // No-shield reference: consume (50%) of the full hit; healthLost == raw damage.
    const refDefender = makeDefender();
    const { newBattle: ref } = applyEffects(
      makeBattle([makeAttacker(), refDefender], [makeAttack(), makeConsume(50)]),
      "attacker",
      makeCombatAction(),
    );
    const refHealthLost = healthLostBy(refDefender, ref);
    const refShield = findConsumeShield(ref.usersEffects);
    expect(refHealthLost).toBeGreaterThan(0);
    expect(refShield?.power).toBeGreaterThan(0);

    // Same hit, but the defender's shield absorbs the damage (post-shield HP loss ~0).
    const shieldedDefender = makeDefender();
    const { newBattle: shielded } = applyEffects(
      makeBattle(
        [makeAttacker(), shieldedDefender],
        [makeAttack(), makeConsume(50), makeShield("defender", ROUND)],
      ),
      "attacker",
      makeCombatAction(),
    );
    const shieldedHealthLost = healthLostBy(shieldedDefender, shielded);
    const consumeShield = findConsumeShield(shielded.usersEffects);

    expect(shieldedHealthLost).toBeLessThan(refHealthLost);
    // Consume is sized off the FULL pre-shield hit, so the granted shield matches the
    // no-shield reference even when post-shield damage collapses toward 0.
    expect(consumeShield?.power).toBeCloseTo(refShield!.power!, 0);
  });

  it("merges consume shields across multiple damage hits on the same target", () => {
    // Two hits on the same target contribute to one per-caster shield before merging.
    const defender = makeDefender();
    const { newBattle } = applyEffects(
      makeBattle(
        [makeAttacker(), defender],
        [makeAttack("damage-1"), makeAttack("damage-2"), makeConsume(50)],
      ),
      "attacker",
      makeCombatAction(),
    );
    const healthLost = healthLostBy(defender, newBattle);
    const shields = consumeShields(newBattle.usersEffects);

    expect(healthLost).toBeGreaterThan(0);
    expect(shields).toHaveLength(1);
    expect(shields[0]?.power).toBeCloseTo(Math.floor(healthLost * 0.5), 0);
  });

  it("grants one aggregated shield when the action hits multiple targets", () => {
    // collapseConsequences merges by targetId, so a two-target action leaves two
    // collapsed consequences. The attacker must still end up with a single shield sized
    // off the combined hit rather than one shield per damaged target.
    const first = makeDefender("defender-a");
    const second = makeDefender("defender-b");
    const { newBattle, actionEffects } = applyEffects(
      makeBattle(
        [makeAttacker(), first, second],
        [
          makeAttack("damage-a", "attacker", "defender-a"),
          makeAttack("damage-b", "attacker", "defender-b"),
          makeConsume(50),
        ],
      ),
      "attacker",
      makeCombatAction(),
    );
    const perDefenderLost = [first, second].map((defender) =>
      healthLostBy(defender, newBattle),
    );
    const healthLost = perDefenderLost.reduce((total, lost) => total + lost, 0);
    const shields = consumeShields(newBattle.usersEffects);

    // Both targets must actually be hit, else the single-shield assertion is vacuous.
    perDefenderLost.forEach((lost) => expect(lost).toBeGreaterThan(0));
    expect(shields).toHaveLength(1);
    expect(shields[0]?.power).toBeCloseTo(Math.floor(healthLost * 0.5), 0);
    expect(actionEffects.filter((e) => e.txt.includes("consumes"))).toHaveLength(1);
  });

  it("grants a shield that absorbs incoming damage on a later action", () => {
    // Drive createConsumeShieldEffect through applyEffects, then confirm the resulting
    // effect actually soaks damage (catches a broken ShieldTag field that would leave a
    // non-absorbing shield in usersEffects).
    const { newBattle: afterConsume } = applyEffects(
      makeBattle([makeAttacker(), makeDefender()], [makeAttack(), makeConsume(50)]),
      "attacker",
      makeCombatAction(),
    );
    const consumeShield = findConsumeShield(afterConsume.usersEffects);
    expect(consumeShield).toBeDefined();
    expect(consumeShield!.power).toBeGreaterThan(0);
    const shieldHpBefore = consumeShield!.power;

    // Control: defender hits attacker with no shield.
    const controlAttacker = makeAttacker({
      curHealth: 100_000_000,
      maxHealth: 100_000_000,
    });
    const { newBattle: control } = applyEffects(
      makeBattle(
        [controlAttacker, makeDefender()],
        [makeAttack("retaliation", "defender", "attacker")],
      ),
      "defender",
      makeCombatAction(),
    );
    const controlLost = healthLostBy(controlAttacker, control);
    expect(controlLost).toBeGreaterThan(0);

    // Same retaliation with the consume-granted shield carried forward.
    const shieldedAttacker = makeAttacker({
      curHealth: 100_000_000,
      maxHealth: 100_000_000,
    });
    const { newBattle: shielded, actionEffects } = applyEffects(
      makeBattle(
        [shieldedAttacker, makeDefender()],
        [
          { ...consumeShield!, power: shieldHpBefore },
          makeAttack("retaliation", "defender", "attacker"),
        ],
      ),
      "defender",
      makeCombatAction(),
    );
    const shieldedLost = healthLostBy(shieldedAttacker, shielded);
    const remainingShield = findConsumeShield(shielded.usersEffects);

    expect(shieldedLost).toBeLessThan(controlLost);
    expect(actionEffects.some((e) => e.txt.includes("shield absorbs"))).toBe(true);
    // Shield HP decreased (or was destroyed) by the absorbed amount.
    expect(
      (remainingShield?.power ?? 0) < shieldHpBefore || remainingShield === undefined,
    ).toBe(true);
  });
});

describe("active Consume damage conversion", () => {
  const activeConsume = (overrides: Partial<UserEffect> = {}): UserEffect =>
    ({
      ...makeConsume(50),
      isNew: false,
      castThisRound: false,
      createdRound: ROUND - 1,
      ...overrides,
    }) as UserEffect;
  const staticHit = (creatorId = "attacker", targetId = "defender") =>
    makeDamageEffect({
      ...makeAttack("static-hit", creatorId, targetId),
      power: 100,
      powerPerLevel: 0,
      calculation: "static",
      statTypes: ["None"],
    } as Partial<UserEffect>);
  const shieldHp = (battle: CompleteBattle, userId = "attacker") =>
    battle.usersEffects
      .filter((e) => e.type === "shield" && e.targetId === userId)
      .reduce((hp, e) => hp + e.power, 0);

  it("preserves authored durations and defaults new tags to three active rounds", () => {
    expect(ConsumeTag.parse({}).rounds).toBe(3);
    expect(ConsumeTag.parse({ rounds: 7, shieldRounds: 2 })).toMatchObject({
      rounds: 7,
      shieldRounds: 2,
    });
  });

  it("stacks shields from different actions during the same active round", () => {
    const first = applyEffects(
      makeBattle([makeAttacker(), makeDefender()], [staticHit(), activeConsume()]),
      "attacker",
      makeCombatAction(),
    ).newBattle;
    const firstShield = findConsumeShield(first.usersEffects)!;
    const second = applyEffects(
      {
        ...first,
        usersEffects: [
          ...first.usersEffects,
          { ...staticHit(), id: "second-hit", actionId: "other-jutsu" },
        ],
      },
      "attacker",
      makeCombatAction(),
    ).newBattle;
    expect(firstShield.power).toBeGreaterThan(0);
    expect(shieldHp(second)).toBe(firstShield.power * 2);
    expect(second.usersEffects.filter((e) => e.type === "shield")).toHaveLength(2);
  });

  it("converts subsequent damage in a later round", () => {
    const { newBattle } = applyEffects(
      {
        ...makeBattle(
          [makeAttacker(), makeDefender()],
          [{ ...staticHit(), createdRound: ROUND + 1 }, activeConsume({ rounds: 1 })],
        ),
        round: ROUND + 1,
      },
      "attacker",
      makeCombatAction(),
    );
    expect(shieldHp(newBattle)).toBeGreaterThan(0);
  });

  it("expires without removing shields previously earned", () => {
    const first = applyEffects(
      makeBattle([makeAttacker(), makeDefender()], [staticHit(), activeConsume()]),
      "attacker",
      makeCombatAction(),
    ).newBattle;
    const expired = first.usersEffects.map((e) =>
      e.type === "consume" ? { ...e, rounds: 0 } : e,
    );
    const second = applyEffects(
      { ...first, round: ROUND + 1, usersEffects: [...expired, staticHit()] },
      "attacker",
      makeCombatAction(),
    ).newBattle;
    expect(shieldHp(second)).toBe(shieldHp(first));
    expect(second.usersEffects.some((e) => e.type === "consume")).toBe(false);
  });

  it("supports zero-duration conversion only on the casting action", () => {
    const { newBattle } = applyEffects(
      makeBattle(
        [makeAttacker(), makeDefender()],
        [staticHit(), makeConsume(50, 3, 0)],
      ),
      "attacker",
      makeCombatAction(),
    );
    expect(shieldHp(newBattle)).toBeGreaterThan(0);
    expect(newBattle.usersEffects.some((e) => e.type === "consume")).toBe(false);
    const stale = applyEffects(
      makeBattle(
        [makeAttacker(), makeDefender()],
        [staticHit(), activeConsume({ rounds: 0 })],
      ),
      "attacker",
      makeCombatAction(),
    ).newBattle;
    expect(shieldHp(stale)).toBe(0);
  });

  it("keeps a zero-duration conversion when a Sage activation grants Clear", () => {
    const sageMode = makeSageMode({
      effects: [ClearTag.parse({ power: 100, rounds: 3 })],
    });
    const battle = makeBattle(
      [makeAttacker({ sageModeId: sageMode.id }), makeDefender()],
      [
        staticHit(),
        makeConsume(50, 3, 0),
        makeActivateSageEffect("attacker", { createdRound: ROUND }),
      ],
    );
    battle.extraState.sageModes = { [sageMode.id]: sageMode };
    const { newBattle, actionEffects } = applyEffects(
      battle,
      "attacker",
      makeCombatAction(),
    );
    expect(actionEffects.map((e) => e.txt)).toContain(
      "attacker was cleared of all positive status effects. ",
    );
    expect(shieldHp(newBattle)).toBeGreaterThan(0);
  });

  it("converts residual damage during the victim's turn", () => {
    const defender = makeDefender();
    const residual = {
      ...staticHit(),
      isNew: false,
      castThisRound: false,
      createdRound: ROUND - 1,
      rounds: 2,
    };
    const { newBattle, actionEffects } = applyEffects(
      makeBattle([makeAttacker(), defender], [residual, activeConsume()]),
      "defender",
      makeCombatAction(),
    );
    const lost =
      defender.curHealth -
      newBattle.usersState.find((u) => u.userId === "defender")!.curHealth;
    expect(actionEffects.some((e) => e.txt.includes("residual damage"))).toBe(true);
    expect(lost).toBeGreaterThan(0);
    expect(shieldHp(newBattle)).toBe(Math.floor(lost * 0.5));
  });

  it("converts health drain without converting chakra or stamina drain", () => {
    const drain = makeEffect(
      "drain",
      {
        power: 100,
        calculation: "static",
        poolsAffected: ["Health", "Chakra", "Stamina"],
        rounds: 2,
      },
      {
        creatorId: "attacker",
        targetId: "defender",
        targetType: "user",
        createdRound: ROUND - 1,
        isNew: false,
      },
    );
    const defender = makeDefender();
    const { newBattle } = applyEffects(
      makeBattle([makeAttacker(), defender], [drain, activeConsume()]),
      "defender",
      makeCombatAction(),
    );
    const lost =
      defender.curHealth -
      newBattle.usersState.find((u) => u.userId === "defender")!.curHealth;
    expect(lost).toBeGreaterThan(0);
    expect(shieldHp(newBattle)).toBe(Math.floor(lost * 0.5));
  });

  it("keeps damage from another caster out of the consume shield", () => {
    const { newBattle } = applyEffects(
      makeBattle(
        [makeAttacker(), makeDefender(), makeDefender("other")],
        [staticHit("other"), staticHit(), activeConsume()],
      ),
      "attacker",
      makeCombatAction(),
    );
    const reference = applyEffects(
      makeBattle([makeAttacker(), makeDefender()], [staticHit(), activeConsume()]),
      "attacker",
      makeCombatAction(),
    ).newBattle;
    expect(shieldHp(newBattle)).toBe(shieldHp(reference));
  });

  it("converts reflected damage for the defender", () => {
    const reflect = makeEffect(
      "reflect",
      { power: 50, calculation: "percentage", rounds: 2 },
      {
        creatorId: "defender",
        targetId: "defender",
        targetType: "user",
        createdRound: ROUND - 1,
        isNew: false,
      },
    );
    const consume = activeConsume({ creatorId: "defender", targetId: "defender" });
    const { newBattle } = applyEffects(
      makeBattle([makeAttacker(), makeDefender()], [staticHit(), reflect, consume]),
      "attacker",
      makeCombatAction(),
    );
    const reflected =
      1000 - newBattle.usersState.find((u) => u.userId === "attacker")!.curHealth;
    expect(reflected).toBeGreaterThan(0);
    expect(shieldHp(newBattle, "defender")).toBe(Math.floor(reflected * 0.5));
    expect(shieldHp(newBattle)).toBe(0);
  });

  it.each([0, 25])(
    "converts ground-hit reflection on Sage activation with %i percent existing Consume",
    (existingPower) => {
      const sageMode = makeSageMode(
        SageModeValidator.parse({
          ...makeSageMode(),
          name: "Consume Sage",
          description: "Converts outgoing damage into a shield",
          villageId: null,
          effects: [ConsumeTag.parse({ power: 50, rounds: 7, shieldRounds: 2 })],
        }),
      );
      const initial = makeCompleteBattle({
        width: 5,
        height: 5,
        round: 1,
        createdAt: new Date(0),
        usersState: [
          makeAttacker({ sageModeId: sageMode.id }),
          makeDefender("defender", { curHealth: 1000, maxHealth: 1000 }),
        ],
        extraState: { sageModes: { [sageMode.id]: sageMode } },
      });
      const groundAction = {
        ...JutsuValidatorRawSchema.parse(
          makeJutsu({
            name: "Ground attack",
            target: "GROUND",
            range: 3,
            effects: [
              DamageTag.parse({
                power: 100,
                calculation: "static",
                rounds: 3,
                statTypes: ["None"],
              }),
            ],
          }),
        ),
        id: "ground-hit",
        type: "jutsu",
        updatedAt: 0,
        originalCooldown: 0,
        level: 0,
      } as CombatAction;
      expect(
        insertAction({
          battle: initial,
          grid: getBattleGrid(20, initial),
          action: groundAction,
          actorId: "defender",
          longitude: 0,
          latitude: 0,
        }),
      ).toBe(true);
      const battle = applyEffects(initial, "defender", groundAction).newBattle;
      expect(battle.groundEffects).toHaveLength(1);
      battle.round = ROUND;
      battle.usersEffects.push(
        makeEffect(
          "reflect",
          { power: 50, calculation: "percentage", rounds: 3 },
          {
            creatorId: "attacker",
            targetId: "attacker",
            targetType: "user",
            createdRound: ROUND - 1,
            isNew: false,
          },
        ),
      );
      if (existingPower)
        battle.usersEffects.push(
          activeConsume({ power: existingPower, shieldRounds: 5 }),
        );
      const action = {
        ...SAGE_MODE_ACTIVATION_JUTSU,
        type: "jutsu",
        updatedAt: 0,
        originalCooldown: 0,
        level: 0,
      } as CombatAction;
      expect(
        insertAction({
          battle,
          grid: getBattleGrid(20, battle),
          action,
          actorId: "attacker",
          longitude: 0,
          latitude: 0,
        }),
      ).toBe(true);

      const { newBattle, actionEffects } = applyEffects(battle, "attacker", action);

      expect(newBattle.usersState[0]?.sageModeActivated).toBe(true);
      expect(newBattle.usersState[0]?.curHealth).toBe(840);
      expect(newBattle.usersState[1]?.curHealth).toBe(960);
      expect(
        newBattle.usersEffects.find(
          (e) => e.type === "consume" && e.fromType === "sageMode",
        )?.rounds,
      ).toBe(sageMode.activationRounds);
      expect(shieldHp(newBattle)).toBe((40 * (50 + existingPower)) / 100);
      expect(findConsumeShield(newBattle.usersEffects)?.rounds).toBe(
        existingPower ? 5 : 2,
      );
      expect(actionEffects.filter((e) => e.txt.includes("consumes"))).toHaveLength(1);
    },
  );

  it("combines Diffuse repayments and new damage with capped conversion and the longest shield duration", () => {
    const defender = makeDefender("defender", {
      diffuseDamage: [
        {
          attackerId: "attacker",
          sourceUserId: "attacker",
          remainingDamage: 200,
          remainingTurns: 2,
          lastAppliedRound: ROUND - 1,
          creditDamage: true,
        },
      ],
    });
    const { newBattle, actionEffects } = applyEffects(
      makeBattle(
        [makeAttacker(), defender],
        [
          staticHit(),
          activeConsume(),
          activeConsume({
            id: "bloodline-consume",
            fromType: "bloodline",
            power: 75,
            shieldRounds: 6,
          }),
        ],
      ),
      "defender",
      makeCombatAction(),
    );
    const healthLost = defender.curHealth - newBattle.usersState[1]!.curHealth;
    expect(healthLost).toBeGreaterThan(100);
    expect(shieldHp(newBattle)).toBe(healthLost);
    expect(findConsumeShield(newBattle.usersEffects)?.rounds).toBe(6);
    expect(actionEffects.filter((e) => e.txt.includes("consumes"))).toHaveLength(1);
  });

  it("does not generate shields from self-inflicted damage", () => {
    const { newBattle } = applyEffects(
      makeBattle(
        [makeAttacker()],
        [staticHit("attacker", "attacker"), activeConsume()],
      ),
      "attacker",
      makeCombatAction(),
    );
    expect(shieldHp(newBattle)).toBe(0);
  });

  it("does not convert reflected damage from a self-targeted cast", () => {
    const jutsu = JutsuValidatorRawSchema.parse(
      makeJutsu({
        target: "SELF",
        range: 0,
        effects: [
          DamageTag.parse({
            power: 100,
            calculation: "static",
            rounds: 0,
            target: "SELF",
            friendlyFire: "FRIENDLY",
            statTypes: ["None"],
          }),
        ],
      }),
    );
    const action: CombatAction = {
      ...jutsu,
      id: "self-hit",
      type: "jutsu",
      updatedAt: 0,
      originalCooldown: 0,
      level: 0,
    };
    const battle = makeCompleteBattle({
      createdAt: new Date(0),
      round: ROUND,
      width: 5,
      height: 5,
      usersState: [makeAttacker(), makeDefender()],
      usersEffects: [
        activeConsume(),
        makeEffect(
          "reflect",
          { power: 50, calculation: "percentage", rounds: 2 },
          {
            creatorId: "attacker",
            targetId: "attacker",
            targetType: "user",
            createdRound: ROUND - 1,
          },
        ),
      ],
    });
    expect(
      insertAction({
        battle,
        grid: getBattleGrid(20, battle),
        action,
        actorId: "attacker",
        longitude: 0,
        latitude: 0,
      }),
    ).toBe(true);

    const { newBattle, actionEffects } = applyEffects(battle, "attacker", action);
    expect(newBattle.usersState[0]?.curHealth).toBe(880);
    expect(
      actionEffects.some((e) => e.txt === "attacker takes 40.00 reflect damage"),
    ).toBe(true);
    expect(shieldHp(newBattle)).toBe(0);
    expect(actionEffects.some((e) => e.txt.includes("consumes"))).toBe(false);
  });

  it("does not convert damage when Consume is sealed", () => {
    const seal = makeEffect(
      "seal",
      { power: 100, rounds: 3 },
      {
        creatorId: "defender",
        targetId: "attacker",
        targetType: "user",
        isNew: false,
        createdRound: ROUND - 2,
      },
    );
    const { newBattle } = applyEffects(
      makeBattle(
        [makeAttacker(), makeDefender()],
        [staticHit(), activeConsume({ fromType: "bloodline" }), seal],
      ),
      "attacker",
      makeCombatAction(),
    );
    expect(shieldHp(newBattle)).toBe(0);
  });
  it("accepts standalone active buffs but requires a hit for instant Consume", () => {
    expect(
      JutsuValidatorRawSchema.safeParse(
        makeJutsu({ effects: [ConsumeTag.parse({ rounds: 3 })] }),
      ).success,
    ).toBe(true);
    expect(
      JutsuValidatorRawSchema.safeParse(
        makeJutsu({ effects: [ConsumeTag.parse({ rounds: 0 })] }),
      ).success,
    ).toBe(false);
  });

  it("attributes simultaneous drain ticks to their own casters", () => {
    const drains = ["attacker", "other"].map((creatorId) =>
      makeEffect(
        "drain",
        { power: 20, calculation: "static", poolsAffected: ["Health"], rounds: 2 },
        {
          id: `drain-${creatorId}`,
          creatorId,
          targetId: "defender",
          targetType: "user",
          createdRound: ROUND - 1,
          isNew: false,
        },
      ),
    );
    const { newBattle } = applyEffects(
      makeBattle(
        [makeAttacker(), makeDefender(), makeDefender("other")],
        [...drains, activeConsume()],
      ),
      "defender",
      makeCombatAction(),
    );
    expect(shieldHp(newBattle)).toBe(10);
  });

  it("converts poison damage while the victim spends pools", () => {
    const poison = makeEffect(
      "poison",
      { power: 50, calculation: "percentage", rounds: 2 },
      {
        creatorId: "attacker",
        targetId: "defender",
        targetType: "user",
        createdRound: ROUND - 1,
        isNew: false,
      },
    );
    const { newBattle } = applyEffects(
      makeBattle([makeAttacker(), makeDefender()], [poison, activeConsume()]),
      "defender",
      makeCombatAction({ chakraCost: 100, staminaCost: 100 }),
    );
    expect(shieldHp(newBattle)).toBe(50);
  });

  it("respects the Reflect cap when granting a shield", () => {
    const reflect = makeEffect(
      "reflect",
      { power: 100, calculation: "percentage", rounds: 2 },
      {
        creatorId: "defender",
        targetId: "defender",
        targetType: "user",
        createdRound: ROUND - 1,
        isNew: false,
      },
    );
    const { newBattle } = applyEffects(
      makeBattle(
        [makeAttacker(), makeDefender()],
        [
          staticHit(),
          reflect,
          activeConsume({ creatorId: "defender", targetId: "defender" }),
        ],
      ),
      "attacker",
      makeCombatAction(),
    );
    const returnedDamage =
      1000 - newBattle.usersState.find((u) => u.userId === "attacker")!.curHealth;
    expect(shieldHp(newBattle, "defender")).toBe(Math.floor(returnedDamage * 0.5));
  });

  it("does not convert immediate or deferred recoil into an opponent's shield", () => {
    const recoil = makeEffect(
      "recoil",
      { power: 50, calculation: "percentage", rounds: 2 },
      {
        creatorId: "defender",
        targetId: "attacker",
        targetType: "user",
        createdRound: ROUND - 1,
        isNew: false,
      },
    );
    const diffuse = makeEffect(
      "diffuse",
      { power: 50, delayRounds: 2, rounds: 3 },
      {
        creatorId: "attacker",
        targetId: "attacker",
        targetType: "user",
        createdRound: ROUND - 1,
        isNew: false,
      },
    );
    const first = applyEffects(
      makeBattle(
        [makeAttacker(), makeDefender()],
        [
          staticHit(),
          recoil,
          diffuse,
          activeConsume({ creatorId: "defender", targetId: "defender" }),
        ],
      ),
      "attacker",
      makeCombatAction(),
    ).newBattle;
    expect(shieldHp(first, "defender")).toBe(0);
    const second = applyEffects(
      { ...first, round: ROUND + 1 },
      "attacker",
      makeCombatAction(),
    ).newBattle;
    expect(shieldHp(second, "defender")).toBe(0);
    expect(
      second.usersState.find((u) => u.userId === "attacker")!.curHealth,
    ).toBeLessThan(first.usersState.find((u) => u.userId === "attacker")!.curHealth);
  });

  it.each([0, 3])(
    "does not convert a cleared Consume with %i active rounds",
    (rounds) => {
      const clear = makeEffect(
        "clear",
        { power: 100, rounds: 0 },
        {
          creatorId: "defender",
          targetId: "attacker",
          targetType: "user",
          createdRound: ROUND,
          isNew: true,
        },
      );
      const { newBattle, actionEffects } = applyEffects(
        makeBattle(
          [makeAttacker(), makeDefender()],
          [staticHit(), makeConsume(50, 3, rounds), clear],
        ),
        "attacker",
        makeCombatAction(),
      );
      expect(actionEffects.some((e) => e.txt.includes("cleared"))).toBe(true);
      expect(shieldHp(newBattle)).toBe(0);
      expect(actionEffects.some((e) => e.txt.includes("consumes"))).toBe(false);
    },
  );

  it("keeps deferred summon damage conversion on its caster and quest credit on its controller", () => {
    const summon = makeBattleUser("summon", {
      isSummon: true,
      controllerId: "attacker",
      direction: "left",
    });
    const diffuse = makeEffect(
      "diffuse",
      { power: 50, delayRounds: 2, rounds: 3 },
      {
        creatorId: "defender",
        targetId: "defender",
        targetType: "user",
        createdRound: ROUND - 1,
        isNew: false,
      },
    );
    const consume = activeConsume({ creatorId: "summon", targetId: "summon" });
    const first = applyEffects(
      makeBattle(
        [makeAttacker(), makeDefender(), summon],
        [staticHit("summon"), diffuse, consume],
      ),
      "summon",
      makeCombatAction(),
    ).newBattle;
    const initialShield = shieldHp(first, "summon");
    const debt = first.usersState.find((u) => u.userId === "defender")!
      .diffuseDamage![0]!;
    expect(debt.attackerId).toBe("attacker");
    expect(debt.sourceUserId).toBe("summon");
    const second = applyEffects(
      { ...first, round: ROUND + 1 },
      "defender",
      makeCombatAction(),
    ).newBattle;
    expect(shieldHp(second, "summon")).toBe(
      initialShield + Math.floor((debt.remainingDamage / debt.remainingTurns) * 0.5),
    );
    expect(shieldHp(second)).toBe(0);
  });
  it("attributes wound ticks separately for each caster", () => {
    const wounds = ["attacker", "other"].map((creatorId) =>
      makeEffect(
        "wound",
        { power: 20, rounds: 2 },
        {
          id: `wound-${creatorId}`,
          creatorId,
          targetId: "defender",
          targetType: "user",
          createdRound: ROUND - 1,
          isNew: false,
          timeTracker: { originalDamage: 100 },
        },
      ),
    );
    const { newBattle } = applyEffects(
      makeBattle(
        [makeAttacker(), makeDefender(), makeDefender("other")],
        [...wounds, activeConsume()],
      ),
      "defender",
      makeCombatAction(),
    );
    expect(shieldHp(newBattle)).toBe(10);
  });

  it("caps conversion at 100% and generated shield HP at the schema maximum", () => {
    const { newBattle } = applyEffects(
      makeBattle(
        [makeAttacker(), makeDefender()],
        [{ ...staticHit(), power: 1000000 }, activeConsume({ power: 200 })],
      ),
      "attacker",
      makeCombatAction(),
    );
    expect(shieldHp(newBattle)).toBe(SHIELD_MAX_HEALTH);
  });
});
