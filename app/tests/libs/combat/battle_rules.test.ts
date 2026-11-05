import { describe, expect, it } from "bun:test";
import type { BattleType } from "@/drizzle/constants";
import { getRemainingCooldown } from "@/libs/combat/actions";
import { sendsToHospital } from "@/libs/combat/util";

describe("sendsToHospital", () => {
  const battle = (battleType: BattleType, forceKeepPools = false) => ({
    battleType,
    forceKeepPools,
  });

  it("hospitalizes a defeated user in an ordinary battle", () => {
    expect(sendsToHospital(battle("COMBAT"), 0)).toBe(true);
    expect(sendsToHospital(battle("COMBAT"), -5)).toBe(true);
  });

  it("leaves a surviving user awake", () => {
    expect(sendsToHospital(battle("COMBAT"), 1)).toBe(false);
  });

  it("exempts sparring and ranked battles", () => {
    expect(sendsToHospital(battle("SPARRING"), 0)).toBe(false);
    expect(sendsToHospital(battle("RANKED_PVP"), 0)).toBe(false);
    expect(sendsToHospital(battle("RANKED_SPARRING"), 0)).toBe(false);
  });

  it("exempts battles that keep pools", () => {
    expect(sendsToHospital(battle("QUEST", true), 0)).toBe(false);
  });
});

describe("getRemainingCooldown", () => {
  it("counts the rounds left since the last use", () => {
    expect(getRemainingCooldown({ cooldown: 3, lastUsedRound: 4 }, 5)).toBe(2);
    expect(getRemainingCooldown({ cooldown: 3, lastUsedRound: 4 }, 7)).toBe(0);
    expect(getRemainingCooldown({ cooldown: 3, lastUsedRound: 4 }, 9)).toBe(0);
  });

  it("treats a falsy last use as never used, as target validation does", () => {
    expect(getRemainingCooldown({ cooldown: 3, lastUsedRound: 0 }, 1)).toBe(0);
    expect(getRemainingCooldown({ cooldown: 3 }, 1)).toBe(0);
  });

  it("is ready when reset to the negative original cooldown", () => {
    expect(getRemainingCooldown({ cooldown: 3, lastUsedRound: -3 }, 0)).toBe(0);
  });

  it("has nothing to report without a cooldown or a round", () => {
    expect(getRemainingCooldown({ cooldown: 0, lastUsedRound: 4 }, 5)).toBe(0);
    expect(getRemainingCooldown({ cooldown: 3, lastUsedRound: 4 }, undefined)).toBe(0);
  });
});
