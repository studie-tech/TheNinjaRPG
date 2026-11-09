import { describe, expect, it } from "bun:test";
import {
  SAGE_MODE_ACTIVATION_JUTSU_ID,
  SAGE_MODE_DEFAULT_ACTION_COST_PERC,
} from "@/drizzle/constants";
import type { SageMode } from "@/drizzle/schema";
import { availableUserActions } from "@/libs/combat/actions";
import { SAGE_MODE_ACTIVATION_JUTSU } from "@/libs/sageMode";
import { makeInjectBattle } from "../../setup/combat";
import { makeSageMode, makeSageUser } from "./helpers/sageMode";

/** AP cost of the Activation action after `availableUserActions` builds it. */
const activationCost = (sageModes: Record<string, SageMode>) => {
  const user = makeSageUser();
  const actions = availableUserActions(
    makeInjectBattle(user, {
      jutsus: { [SAGE_MODE_ACTIVATION_JUTSU_ID]: SAGE_MODE_ACTIVATION_JUTSU },
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
