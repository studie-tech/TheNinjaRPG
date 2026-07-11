import { describe, expect, it } from "vitest";
import { applySageModeAfterRoundTransition } from "@/libs/combat/process";
import { makeBattleUser, makeTag } from "./helpers/battleScenario";
import type { CompleteBattle, UserEffect } from "@/libs/combat/types";
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
});
