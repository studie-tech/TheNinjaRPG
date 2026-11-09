import {
  SAGE_MODE_ACTIVATION_JUTSU_ID,
  SAGE_MODE_DEFAULT_ACTION_COST_PERC,
} from "@/drizzle/constants";
import type { SageMode } from "@/drizzle/schema";
import { applySingleEffect } from "@/libs/combat/process";
import type {
  ActionEffect,
  BattleUserState,
  CompleteBattle,
  Consequence,
  GroundEffect,
  UserEffect,
} from "@/libs/combat/types";
import {
  type EffectRuntimeOverrides,
  makeBattleUser,
  makeEffect,
} from "../../../setup/combat";

/**
 * Partial `SageMode` catalog row for combat tests. Only fields the processor
 * reads need to be set; override per suite (after-effects, costs, level 2).
 */
export const makeSageMode = (overrides: Partial<SageMode> = {}): SageMode =>
  ({
    id: "sage-1",
    image: "mode.webp",
    level: 1,
    activationRounds: 3,
    afterEffectRounds: 2,
    chakraCostPerc: 0,
    staminaCostPerc: 0,
    actionCostPerc: SAGE_MODE_DEFAULT_ACTION_COST_PERC,
    requiredSageMastery: 0,
    effects: [],
    afterEffects: [],
    level2Effects: [],
    ...overrides,
  }) as unknown as SageMode;

/**
 * Realized `activatesagemode` tag stamped with the injected Activation jutsu id
 * so `applyActivateSageMode` accepts it.
 */
export const makeActivateSageEffect = (
  userId = "sage",
  runtime: EffectRuntimeOverrides = {},
): UserEffect =>
  makeEffect(
    "activatesagemode",
    {},
    {
      id: "act-1",
      creatorId: userId,
      targetId: userId,
      targetType: "user",
      isNew: true,
      castThisRound: true,
      createdRound: 1,
      actionId: SAGE_MODE_ACTIVATION_JUTSU_ID,
      ...runtime,
    },
  );

/** Actor `sage` with mode `sage-1` equipped, unused this battle, no daily activations. */
export const makeSageUser = (
  overrides: Partial<BattleUserState> = {},
): BattleUserState =>
  makeBattleUser("sage", {
    sageModeId: "sage-1",
    sageModeUsedThisBattle: false,
    sageMasteryExperience: 0,
    dailySageActivations: 0,
    ...overrides,
  });

/** Runs one Activation through `applySingleEffect` and returns the effects it realized. */
export const activateSageMode = (
  user: BattleUserState,
  battle: CompleteBattle,
  runtime: EffectRuntimeOverrides = {},
): UserEffect[] => {
  const usersEffects: UserEffect[] = [];
  applySingleEffect(
    {
      consequences: new Map<string, Consequence>(),
      newUsersState: [user],
      newUsersEffects: usersEffects,
      newGroundEffects: [] as GroundEffect[],
      actionEffects: [] as ActionEffect[],
      appliedEffects: new Set<string>(),
      battle,
      actorId: user.userId,
    },
    makeActivateSageEffect(user.userId, runtime),
  );
  return usersEffects;
};
