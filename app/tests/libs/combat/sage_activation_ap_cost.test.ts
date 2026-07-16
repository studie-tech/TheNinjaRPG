import { describe, expect, it } from "vitest";
import {
  SAGE_MODE_ACTIVATION_JUTSU_ID,
  SAGE_MODE_DEFAULT_ACTION_COST_PERC,
} from "@/drizzle/constants";
import type { SageMode } from "@/drizzle/schema";
import { availableUserActions } from "@/libs/combat/actions";
import { SAGE_MODE_ACTIVATION_JUTSU_FALLBACK } from "@/libs/combat/sageModeActivationJutsu";
import { makeBattleUser } from "./helpers/battleScenario";
import type { CompleteBattle } from "@/libs/combat/types";

const makeSageMode = (overrides: Partial<SageMode> = {}): SageMode =>
  ({
    id: "sage-1",
    image: "mode.webp",
    level: 1,
    activationRounds: 3,
    chakraCostPerc: 0,
    staminaCostPerc: 0,
    actionCostPerc: SAGE_MODE_DEFAULT_ACTION_COST_PERC,
    effects: [],
    ...overrides,
  }) as unknown as SageMode;

const makeBattle = (
  user: ReturnType<typeof makeBattleUser>,
  sageModes: Record<string, SageMode>,
): CompleteBattle =>
  ({
    battleType: "COMBAT",
    round: 1,
    usersState: [user],
    usersEffects: [],
    groundEffects: [],
    extraState: {
      jutsus: { [SAGE_MODE_ACTIVATION_JUTSU_ID]: SAGE_MODE_ACTIVATION_JUTSU_FALLBACK },
      sageModes,
    },
  }) as unknown as CompleteBattle;

const sageUser = () =>
  makeBattleUser("sage", {
    sageModeId: "sage-1",
    sageModeUsedThisBattle: false,
    sageMasteryExperience: 0,
    dailySageActivations: 0,
    curChakra: 5000,
    maxChakra: 5000,
    curStamina: 5000,
    maxStamina: 5000,
  });

const activationCost = (sageModes: Record<string, SageMode>) => {
  const user = sageUser();
  const actions = availableUserActions(makeBattle(user, sageModes), "sage");
  return actions.find((a) => a.id === SAGE_MODE_ACTIVATION_JUTSU_ID)?.actionCostPerc;
};

describe("sage activation AP cost", () => {
  it("charges the equipped mode's AP cost", () => {
    expect(activationCost({ "sage-1": makeSageMode({ actionCostPerc: 25 }) })).toBe(25);
  });

  it("keeps a cheap per-mode cost rather than treating it as unset", () => {
    expect(activationCost({ "sage-1": makeSageMode({ actionCostPerc: 10 }) })).toBe(10);
  });

  it("falls back to the default when the mode is absent from battle state", () => {
    expect(activationCost({})).toBe(SAGE_MODE_DEFAULT_ACTION_COST_PERC);
  });
});
