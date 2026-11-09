import { describe, expect, it } from "bun:test";
import {
  SAGE_MASTERY_DAILY_ACTIVATIONS,
  SAGE_MODE_ACTIVATION_JUTSU_ID,
} from "@/drizzle/constants";
import { handleInjectedJutsus } from "@/libs/combat/actions";
import type { BattleUserState } from "@/libs/combat/types";
import { SAGE_MODE_ACTIVATION_JUTSU } from "@/libs/sageMode";
import { makeInjectBattle } from "../../setup/combat";
import { activateSageMode, makeSageMode, makeSageUser } from "./helpers/sageMode";

const activationJutsus = {
  [SAGE_MODE_ACTIVATION_JUTSU_ID]: SAGE_MODE_ACTIVATION_JUTSU,
};

/** Daily cap of an equipped sage with no mastery experience. */
const DAILY_CAP = SAGE_MASTERY_DAILY_ACTIVATIONS.INITIATE;

describe("sage activation daily-cap gating", () => {
  it("offers the Activation action below the daily cap", () => {
    const user = makeSageUser({ dailySageActivations: DAILY_CAP - 1 });
    const jutsus = handleInjectedJutsus(
      makeInjectBattle(user, { jutsus: activationJutsus }),
      user,
    );
    expect(jutsus.some((j) => j.jutsuId === SAGE_MODE_ACTIVATION_JUTSU_ID)).toBe(true);
  });

  it("hides the Activation action at the daily cap", () => {
    const user = makeSageUser({ dailySageActivations: DAILY_CAP });
    const jutsus = handleInjectedJutsus(
      makeInjectBattle(user, { jutsus: activationJutsus }),
      user,
    );
    expect(jutsus.some((j) => j.jutsuId === SAGE_MODE_ACTIVATION_JUTSU_ID)).toBe(false);
  });
});

const runActivate = (user: BattleUserState) =>
  activateSageMode(
    user,
    makeInjectBattle(user, { sageModes: { "sage-1": makeSageMode() } }),
  );

describe("sage activation daily-cap enforcement in combat", () => {
  it("refuses activation at the daily cap without spending resources", () => {
    const user = makeSageUser({ dailySageActivations: DAILY_CAP, curChakra: 5000 });
    runActivate(user);
    expect(user.sageModeActivated).not.toBe(true);
    expect(user.curChakra).toBe(5000);
    expect(user.dailySageActivations).toBe(DAILY_CAP);
  });

  it("activates below the cap and increments the daily count", () => {
    const user = makeSageUser({ dailySageActivations: 3 });
    runActivate(user);
    expect(user.sageModeActivated).toBe(true);
    expect(user.dailySageActivations).toBe(4);
  });
});
