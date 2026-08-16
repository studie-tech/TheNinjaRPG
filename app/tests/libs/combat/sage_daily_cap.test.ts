import { describe, expect, it } from "vitest";
import { SAGE_MODE_ACTIVATION_JUTSU_ID } from "@/drizzle/constants";
import type { SageMode } from "@/drizzle/schema";
import { handleInjectedJutsus } from "@/libs/combat/actions";
import { applySingleEffect } from "@/libs/combat/process";
import { SAGE_MODE_ACTIVATION_JUTSU_FALLBACK } from "@/libs/combat/sageModeActivationJutsu";
import { makeBattleUser, makeEffect } from "./helpers/battleScenario";
import type {
  ActionEffect,
  CompleteBattle,
  Consequence,
  GroundEffect,
  UserEffect,
} from "@/libs/combat/types";

/** COMBAT battle with only the injected Activation jutsu in extra state. */
const makeInjectBattle = (
  user: ReturnType<typeof makeBattleUser>,
): CompleteBattle =>
  ({
    battleType: "COMBAT",
    round: 1,
    usersState: [user],
    usersEffects: [],
    groundEffects: [],
    extraState: {
      jutsus: { [SAGE_MODE_ACTIVATION_JUTSU_ID]: SAGE_MODE_ACTIVATION_JUTSU_FALLBACK },
    },
  }) as unknown as CompleteBattle;

/** Equipped sage at INITIATE daily cap (10), with the given activations used today. */
const sageUser = (dailySageActivations: number) =>
  makeBattleUser("sage", {
    sageModeId: "sage-1",
    sageModeUsedThisBattle: false,
    sageMasteryExperience: 0, // cap = 10
    dailySageActivations,
  });

describe("sage activation daily-cap gating", () => {
  it("offers the Activation action below the daily cap", () => {
    const user = sageUser(9);
    const jutsus = handleInjectedJutsus(makeInjectBattle(user), user);
    expect(jutsus.some((j) => j.jutsuId === SAGE_MODE_ACTIVATION_JUTSU_ID)).toBe(true);
  });

  it("hides the Activation action at the daily cap", () => {
    const user = sageUser(10);
    const jutsus = handleInjectedJutsus(makeInjectBattle(user), user);
    expect(jutsus.some((j) => j.jutsuId === SAGE_MODE_ACTIVATION_JUTSU_ID)).toBe(false);
  });
});

/** Zero-cost catalog fixture so activation tests isolate the daily-cap guard. */
const makeSageMode = (): SageMode =>
  ({ id: "sage-1", level: 1, activationRounds: 3, chakraCostPerc: 0, staminaCostPerc: 0, effects: [] }) as unknown as SageMode;

/** Battle whose extra state holds `makeSageMode()` for `applySingleEffect`. */
const makeActivateBattle = (
  user: ReturnType<typeof makeBattleUser>,
): CompleteBattle =>
  ({
    battleType: "COMBAT",
    round: 1,
    usersState: [user],
    usersEffects: [],
    groundEffects: [],
    extraState: { sageModes: { "sage-1": makeSageMode() } },
  }) as unknown as CompleteBattle;

/** `activatesagemode` tag stamped with the real Activation jutsu id. */
const activateEffect = (): UserEffect =>
  makeEffect(
    "activatesagemode",
    {},
    { id: "act-1", creatorId: "sage", targetId: "sage", targetType: "user", isNew: true, castThisRound: true, createdRound: 1, actionId: SAGE_MODE_ACTIVATION_JUTSU_ID },
  );

/** Run one Activation through `applySingleEffect` against `user`. */
const runActivate = (user: ReturnType<typeof makeBattleUser>) => {
  const battle = makeActivateBattle(user);
  applySingleEffect(
    new Map<string, Consequence>(),
    [user],
    [] as UserEffect[],
    [] as GroundEffect[],
    [] as ActionEffect[],
    new Set<string>(),
    battle,
    "sage",
    activateEffect(),
  );
};

describe("sage activation daily-cap enforcement in combat", () => {
  it("refuses activation at the daily cap without spending resources", () => {
    const user = makeBattleUser("sage", {
      sageModeId: "sage-1", sageMasteryExperience: 0, dailySageActivations: 10,
      curChakra: 5000, maxChakra: 5000, curStamina: 5000, maxStamina: 5000,
    });
    runActivate(user);
    expect(user.sageModeActivated).not.toBe(true);
    expect(user.curChakra).toBe(5000);
    expect(user.dailySageActivations).toBe(10);
  });

  it("activates below the cap and increments the daily count", () => {
    const user = makeBattleUser("sage", {
      sageModeId: "sage-1", sageMasteryExperience: 0, dailySageActivations: 3,
      curChakra: 5000, maxChakra: 5000, curStamina: 5000, maxStamina: 5000,
    });
    runActivate(user);
    expect(user.sageModeActivated).toBe(true);
    expect(user.dailySageActivations).toBe(4);
  });
});
