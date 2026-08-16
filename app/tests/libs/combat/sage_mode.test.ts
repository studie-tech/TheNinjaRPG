import { describe, expect, it } from "vitest";
import { SAGE_MODE_ACTIVATION_JUTSU_ID } from "@/drizzle/constants";
import { applySageModeAfterRoundTransition, applySingleEffect } from "@/libs/combat/process";
import { cleanse, getPower } from "@/libs/combat/tags";
import { isEffectActive } from "@/libs/combat/util";
import { makeBattleUser, makeEffect, makeTag } from "./helpers/battleScenario";
import type {
  ActionEffect,
  CompleteBattle,
  Consequence,
  GroundEffect,
  UserEffect,
} from "@/libs/combat/types";
import type { SageMode } from "@/drizzle/schema";

/**
 * Minimal SageMode fixture whose after-effect is a simple stat-reduction
 * "exhaustion" tag. Only the fields read by the transition are populated.
 */
const makeSageMode = (): SageMode =>
  ({
    id: "sage-1",
    level: 1,
    afterEffectRounds: 2,
    afterEffects: [
      makeTag("decreasestat", {
        power: 10,
        rounds: 2,
        calculation: "percentage",
        statTypes: ["Ninjutsu"],
        generalTypes: [],
      }),
    ],
  }) as unknown as SageMode;

/** Minimal COMBAT battle whose `extraState.sageModes` holds `makeSageMode()`. */
const makeSageBattle = (
  usersState: ReturnType<typeof makeBattleUser>[],
  usersEffects: UserEffect[] = [],
): CompleteBattle =>
  ({
    id: "battle-1",
    battleType: "COMBAT",
    round: 5,
    usersState,
    usersEffects,
    groundEffects: [],
    extraState: { sageModes: { "sage-1": makeSageMode() } },
  }) as unknown as CompleteBattle;

describe("applySageModeAfterRoundTransition", () => {
  it("does not strip a bystander's max-pool buff when sage after-effects apply", () => {
    // Bystander has an active +2000 max-health buff: curHealth 7000 (above base
    // max 5000), with the prior-round adjustment tracked on the user.
    const bystander = makeBattleUser("bystander", {
      curHealth: 7000,
      maxHealth: 5000,
      _prevHealthAdj: 2000,
      sageModeActivated: false,
    });
    // Sage user whose sage buffs have all expired (no active sageMode effects present).
    const sage = makeBattleUser("sage", {
      sageModeActivated: true,
      sageModeId: "sage-1",
      sageModeUsedThisBattle: true,
    });
    const battle = makeSageBattle([bystander, sage]);

    applySageModeAfterRoundTransition(battle);

    const bystanderAfter = battle.usersState.find((u) => u.userId === "bystander");
    expect(bystanderAfter?.curHealth).toBe(7000);
  });

  it("queues the after-effects onto the battle so the normal pipeline applies them", () => {
    const sage = makeBattleUser("sage", {
      sageModeActivated: true,
      sageModeId: "sage-1",
    });
    const battle = makeSageBattle([sage]);

    applySageModeAfterRoundTransition(battle);

    const queued = battle.usersEffects.filter(
      (e) => e.fromType === "sageModeAfter" && e.targetId === "sage",
    );
    expect(queued).toHaveLength(1);
    // Duration comes from the sage mode's After-Effect Duration, not the per-tag rounds.
    expect(queued[0]?.rounds).toBe(2);
  });

  it("marks sage mode spent and deactivated once buffs have expired", () => {
    const sage = makeBattleUser("sage", {
      sageModeActivated: true,
      sageModeId: "sage-1",
    });
    const battle = makeSageBattle([sage]);

    applySageModeAfterRoundTransition(battle);

    const sageAfter = battle.usersState.find((u) => u.userId === "sage");
    expect(sageAfter?.sageModeActivated).toBe(false);
    expect(sageAfter?.sageModeUsedThisBattle).toBe(true);
    expect(sageAfter?.sageModeActivatedRound).toBeNull();
    expect(sageAfter?.sageModeExpiresRound).toBeNull();
  });

  it("does nothing while sage buffs are still active", () => {
    const sage = makeBattleUser("sage", {
      sageModeActivated: true,
      sageModeId: "sage-1",
    });
    // An active sage buff still on the user — the transition must NOT fire yet.
    const activeSageBuff = makeTag("increasestat", {
      power: 10,
      rounds: 3,
      calculation: "percentage",
      statTypes: ["Ninjutsu"],
      generalTypes: [],
    }) as unknown as UserEffect;
    const activeEffect: UserEffect = {
      ...activeSageBuff,
      id: "active-sage",
      creatorId: "sage",
      targetId: "sage",
      fromType: "sageMode",
      isNew: false,
      castThisRound: false,
      createdRound: 4,
      rounds: 3,
    };
    const battle = makeSageBattle([sage], [activeEffect]);

    applySageModeAfterRoundTransition(battle);

    expect(
      battle.usersEffects.some((e) => e.fromType === "sageModeAfter"),
    ).toBe(false);
    const sageAfter = battle.usersState.find((u) => u.userId === "sage");
    expect(sageAfter?.sageModeActivated).toBe(true);
  });

  it("keeps sage mode active for the full window when the active effects were all instant", () => {
    // A mode whose active effects are all instant leaves no lasting `fromType:'sageMode'`
    // buff, so buff presence cannot anchor the active window. Expiry must be driven by
    // `sageModeExpiresRound`; otherwise the active phase collapses into exhaustion the
    // very next round.
    const sage = makeBattleUser("sage", {
      sageModeActivated: true,
      sageModeId: "sage-1",
      sageModeExpiresRound: 8, // battle round is 5 -> window still open
    });
    const battle = makeSageBattle([sage]); // no active sageMode effects present

    applySageModeAfterRoundTransition(battle);

    const sageAfter = battle.usersState.find((u) => u.userId === "sage");
    expect(sageAfter?.sageModeActivated).toBe(true);
    expect(battle.usersEffects.some((e) => e.fromType === "sageModeAfter")).toBe(false);
  });

  it("fires after-effects once the activation window has elapsed even with no lasting buff", () => {
    const sage = makeBattleUser("sage", {
      sageModeActivated: true,
      sageModeId: "sage-1",
      sageModeExpiresRound: 5, // battle round is 5 -> window elapsed
    });
    const battle = makeSageBattle([sage]);

    applySageModeAfterRoundTransition(battle);

    const sageAfter = battle.usersState.find((u) => u.userId === "sage");
    expect(sageAfter?.sageModeActivated).toBe(false);
    expect(battle.usersEffects.some((e) => e.fromType === "sageModeAfter")).toBe(true);
  });

  it("does not queue after-effects when afterEffectRounds is 0", () => {
    const sage = makeBattleUser("sage", {
      sageModeActivated: true,
      sageModeId: "sage-zero",
      sageModeExpiresRound: 5,
    });
    const battle = {
      ...makeSageBattle([sage]),
      extraState: {
        sageModes: {
          "sage-zero": {
            ...makeSageMode(),
            id: "sage-zero",
            afterEffectRounds: 0,
          },
        },
      },
    } as unknown as CompleteBattle;

    applySageModeAfterRoundTransition(battle);

    expect(battle.usersEffects.some((e) => e.fromType === "sageModeAfter")).toBe(false);
    expect(battle.usersState.find((u) => u.userId === "sage")?.sageModeActivated).toBe(
      false,
    );
  });
});

describe("sageModeAfter protection", () => {
  it("does not cleanse a sageModeAfter exhaustion effect", () => {
    const user = makeBattleUser("sage", { userId: "sage" });
    const after = makeEffect(
      "decreasestat",
      { power: 10, rounds: 2, calculation: "percentage", statTypes: ["Ninjutsu"], generalTypes: [] },
      { id: "after-1", creatorId: "sage", targetId: "sage", targetType: "user",
        fromType: "sageModeAfter", isNew: false, castThisRound: false, createdRound: 1 },
    );
    const usersEffects: UserEffect[] = [after];
    const cleanseEffect = makeEffect(
      "cleanse",
      { power: 100 },
      { id: "cleanse-1", creatorId: "sage", targetId: "sage", targetType: "user",
        isNew: true, castThisRound: true, createdRound: 1, fromType: "basic" },
    );
    cleanse(cleanseEffect, usersEffects, user);
    expect(usersEffects.find((e) => e.id === "after-1")?.rounds).toBe(2);
  });
});

describe("sage mode active-phase aura teardown at expiry", () => {
  // A `type: "visual"` effect bypasses normal round expiry: `applySingleEffect`
  // re-pushes it unconditionally regardless of `rounds` (the
  // `... || effect.type === "visual"` branch). That means an active-phase sage aura
  // outlives its `activationRounds` and lingers for the rest of the battle unless
  // something explicitly tears it down once `sageModeActivated` flips back to false.
  const makeAuraSageMode = (): SageMode =>
    ({
      id: "sage-aura",
      level: 1,
      activationRounds: 2,
      chakraCostPerc: 0,
      staminaCostPerc: 0,
      afterEffectRounds: 0,
      afterEffects: [],
      effects: [
        makeTag("increasestat", {
          power: 10,
          calculation: "static",
          statTypes: ["Ninjutsu"],
          generalTypes: [],
        }),
        makeTag("visual", { staticAssetPath: "aura.webp" }),
      ],
    }) as unknown as SageMode;

  const makeAuraBattle = (user: ReturnType<typeof makeBattleUser>): CompleteBattle =>
    ({
      id: "battle-aura",
      battleType: "COMBAT",
      round: 1,
      usersState: [user],
      usersEffects: [],
      groundEffects: [],
      extraState: { sageModes: { "sage-aura": makeAuraSageMode() } },
    }) as unknown as CompleteBattle;

  const activateEffect = (): UserEffect =>
    makeEffect(
      "activatesagemode",
      {},
      {
        id: "act-aura",
        creatorId: "sage",
        targetId: "sage",
        targetType: "user",
        isNew: true,
        castThisRound: true,
        createdRound: 1,
        actionId: SAGE_MODE_ACTIVATION_JUTSU_ID,
      },
    );

  it("removes the active-phase visual aura once activationRounds elapse", () => {
    const user = makeBattleUser("sage", {
      sageModeId: "sage-aura",
      curChakra: 5000,
      maxChakra: 5000,
      curStamina: 5000,
      maxStamina: 5000,
    });
    const battle = makeAuraBattle(user);

    // Activate: applyActivateSageMode realizes both fixture effects with
    // fromType "sageMode" and rounds = activationRounds (2).
    const newUsersEffects: UserEffect[] = [];
    applySingleEffect(
      new Map<string, Consequence>(),
      [user],
      newUsersEffects,
      [] as GroundEffect[],
      [] as ActionEffect[],
      new Set<string>(),
      battle,
      "sage",
      activateEffect(),
    );
    battle.usersEffects = newUsersEffects;
    expect(user.sageModeActivated).toBe(true);
    expect(
      battle.usersEffects.some((e) => e.type === "visual" && e.fromType === "sageMode"),
    ).toBe(true);

    // Advance two rounds (activationRounds), mirroring alignBattle's per-round
    // `rounds - 1` decrement followed by applySingleEffect's active-or-visual
    // retention filter.
    for (let round = 0; round < 2; round++) {
      battle.round += 1;
      battle.usersEffects = battle.usersEffects
        .map((e) => (e.rounds !== undefined ? { ...e, rounds: e.rounds - 1 } : e))
        .filter((e) => isEffectActive(e) || e.type === "visual");
    }

    // The buff has expired and dropped normally; the visual aura lingers (the bug)
    // with rounds now <= 0, so no sage effect is reported "active" and the
    // after-round transition fires.
    const stillActiveSage = battle.usersEffects.some(
      (e) => e.fromType === "sageMode" && e.targetId === "sage" && isEffectActive(e),
    );
    expect(stillActiveSage).toBe(false);

    applySageModeAfterRoundTransition(battle);

    const lingering = battle.usersEffects.filter(
      (e) => e.targetId === "sage" && e.fromType === "sageMode",
    );
    expect(lingering).toHaveLength(0);
  });
});

describe("sage mode activation level scaling", () => {
  // The catalog `level` column only gates the roll pool; the ACTIVE level applied
  // in combat is computed from `requiredSageMastery` vs. the user's accumulated
  // sage mastery experience (see getActiveSageLevel in @/libs/sageMode).
  const requiredSageMastery = 50_000;

  const makeScalingSageMode = (): SageMode =>
    ({
      id: "sage-scaling",
      level: 1,
      requiredSageMastery,
      activationRounds: 3,
      chakraCostPerc: 0,
      staminaCostPerc: 0,
      effects: [
        makeTag("increasestat", {
          power: 10,
          powerPerLevel: 1,
          rounds: 3,
          calculation: "static",
          statTypes: ["Ninjutsu"],
          generalTypes: [],
        }),
      ],
    }) as unknown as SageMode;

  const makeScalingBattle = (
    user: ReturnType<typeof makeBattleUser>,
  ): CompleteBattle =>
    ({
      battleType: "COMBAT",
      round: 1,
      usersState: [user],
      usersEffects: [],
      groundEffects: [],
      extraState: { sageModes: { "sage-scaling": makeScalingSageMode() } },
    }) as unknown as CompleteBattle;

  const activateEffect = (): UserEffect =>
    makeEffect(
      "activatesagemode",
      {},
      {
        id: "act-scaling",
        creatorId: "sage",
        targetId: "sage",
        targetType: "user",
        isNew: true,
        castThisRound: true,
        createdRound: 1,
        actionId: SAGE_MODE_ACTIVATION_JUTSU_ID,
      },
    );

  const runScalingActivation = (sageMasteryExperience: number) => {
    const user = makeBattleUser("sage", {
      sageModeId: "sage-scaling",
      sageMasteryExperience,
      curChakra: 5000,
      maxChakra: 5000,
      curStamina: 5000,
      maxStamina: 5000,
    });
    const battle = makeScalingBattle(user);
    const newUsersEffects: UserEffect[] = [];
    applySingleEffect(
      new Map<string, Consequence>(),
      [user],
      newUsersEffects,
      [] as GroundEffect[],
      [] as ActionEffect[],
      new Set<string>(),
      battle,
      "sage",
      activateEffect(),
    );
    return newUsersEffects.find(
      (e) => e.fromType === "sageMode" && e.type === "increasestat",
    );
  };

  it("realizes the level-1 buff below the mastery threshold", () => {
    const realized = runScalingActivation(requiredSageMastery - 1);
    expect(realized?.level).toBe(1);
    expect(realized && getPower(realized).power).toBe(11); // 10 + 1*1
  });

  it("realizes the level-2 buff at/above the mastery threshold", () => {
    const realized = runScalingActivation(requiredSageMastery);
    expect(realized?.level).toBe(2);
    expect(realized && getPower(realized).power).toBe(12); // 10 + 2*1
  });
});

describe("sage mode level2Effects activation", () => {
  const requiredSageMastery = 100;

  const makeLevel2SageMode = (): SageMode =>
    ({
      id: "sage-level2",
      level: 1,
      requiredSageMastery,
      activationRounds: 3,
      chakraCostPerc: 0,
      staminaCostPerc: 0,
      effects: [
        makeTag("increasestat", {
          power: 10,
          rounds: 3,
          calculation: "static",
          statTypes: ["Ninjutsu"],
          generalTypes: [],
        }),
      ],
      level2Effects: [
        makeTag("increasestat", {
          power: 20,
          rounds: 3,
          calculation: "static",
          statTypes: ["Genjutsu"],
          generalTypes: [],
        }),
      ],
    }) as unknown as SageMode;

  const makeLevel2Battle = (
    user: ReturnType<typeof makeBattleUser>,
  ): CompleteBattle =>
    ({
      battleType: "COMBAT",
      round: 1,
      usersState: [user],
      usersEffects: [],
      groundEffects: [],
      extraState: { sageModes: { "sage-level2": makeLevel2SageMode() } },
    }) as unknown as CompleteBattle;

  const activateEffect = (): UserEffect =>
    makeEffect(
      "activatesagemode",
      {},
      {
        id: "act-level2",
        creatorId: "sage",
        targetId: "sage",
        targetType: "user",
        isNew: true,
        castThisRound: true,
        createdRound: 1,
        actionId: SAGE_MODE_ACTIVATION_JUTSU_ID,
      },
    );

  const runLevel2Activation = (sageMasteryExperience: number) => {
    const user = makeBattleUser("sage", {
      sageModeId: "sage-level2",
      sageMasteryExperience,
      curChakra: 5000,
      maxChakra: 5000,
      curStamina: 5000,
      maxStamina: 5000,
    });
    const battle = makeLevel2Battle(user);
    const newUsersEffects: UserEffect[] = [];
    applySingleEffect(
      new Map<string, Consequence>(),
      [user],
      newUsersEffects,
      [] as GroundEffect[],
      [] as ActionEffect[],
      new Set<string>(),
      battle,
      "sage",
      activateEffect(),
    );
    return newUsersEffects
      .filter((e) => e.fromType === "sageMode" && e.type === "increasestat")
      .map((e) => getPower(e).power);
  };

  it("does not apply the level2-only effect below the mastery threshold", () => {
    const powers = runLevel2Activation(requiredSageMastery - 1);
    expect(powers).toHaveLength(1);
    expect(powers).toContain(10);
    expect(powers).not.toContain(20);
  });

  it("applies the level2-only effect in addition to the base effect at/above the mastery threshold", () => {
    const powers = runLevel2Activation(requiredSageMastery);
    expect(powers).toHaveLength(2);
    expect(powers).toEqual(expect.arrayContaining([10, 20]));
  });
});

describe("sage mode instant tags", () => {
  it("applies one-shot after-effects immediately even if the next actor is not the sage", () => {
    const sage = makeBattleUser("sage", {
      sageModeActivated: true,
      sageModeId: "sage-instant-after",
      sageModeExpiresRound: 5,
      curHealth: 4000,
      maxHealth: 5000,
    });
    const battle = {
      ...makeSageBattle([sage]),
      extraState: {
        sageModes: {
          "sage-instant-after": {
            id: "sage-instant-after",
            afterEffectRounds: 3,
            afterEffects: [
              makeTag("heal", { power: 10, rounds: 0, calculation: "static" }),
            ],
          },
        },
      },
    } as unknown as CompleteBattle;

    applySageModeAfterRoundTransition(battle);

    const sageAfter = battle.usersState.find((u) => u.userId === "sage");
    expect(sageAfter?.curHealth).toBeGreaterThan(4000);
    expect(
      battle.usersEffects.some(
        (e) => e.fromType === "sageModeAfter" && e.rounds === 0,
      ),
    ).toBe(false);
  });
});
