import { describe, expect, it } from "vitest";
import {
  SAGE_MODE_ACTIVATION_JUTSU_ID,
  SAGE_MODE_DEFAULT_ACTION_COST_PERC,
} from "@/drizzle/constants";
import type { SageMode } from "@/drizzle/schema";
import { availableUserActions } from "@/libs/combat/actions";
import { SAGE_MODE_ACTIVATION_JUTSU_FALLBACK } from "@/libs/combat/sageModeActivationJutsu";
import { makeBattleUser, makeInjectBattle } from "./helpers/battleScenario";
import { makeSageMode } from "./helpers/sageMode";

/** Actor with an equipped mode, unused this battle, and full pools. */
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

/** AP cost of the Activation action after `availableUserActions` builds it. */
const activationCost = (sageModes: Record<string, SageMode>) => {
  const user = sageUser();
  const actions = availableUserActions(
    makeInjectBattle(user, {
      jutsus: { [SAGE_MODE_ACTIVATION_JUTSU_ID]: SAGE_MODE_ACTIVATION_JUTSU_FALLBACK },
      sageModes,
    }),
    "sage",
  );
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
