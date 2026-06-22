import { describe, expect, it, vi } from "vitest";

vi.mock("@/libs/combat/process", () => ({
  applyEffects: vi.fn(() => ({
    newBattle: {},
    actionEffects: [],
  })),
  checkFriendlyFire: vi.fn(() => true),
}));

vi.mock("@/libs/hexgrid", () => ({
  getPossibleActionTiles: vi.fn((_action, _userHex, grid) => grid),
  PathCalculator: vi.fn(() => ({
    getShortestPath: vi.fn(() => []),
  })),
}));

vi.mock("@/server/db", () => ({
  drizzleDB: {},
}));

import { userItemToAction } from "@/libs/combat/actions";
import { dmgConfig } from "@/libs/combat/constants";
import { damageCalc, getPower } from "@/libs/combat/tags";
import type { ReturnedUserState, UserEffect } from "@/libs/combat/types";
import {
  makeBattleUser,
  makeBattleUserItem,
  makeBattleWithWeapon,
  makeDamageEffect,
} from "./helpers/battleScenario";

describe("weapon action scaling", () => {
  it("does not scale weapon damage power from the user's character level", () => {
    const battle = makeBattleWithWeapon();
    const user = { userId: "attacker", level: 100 } as ReturnedUserState;
    const userItem = makeBattleUserItem();

    const action = userItemToAction(userItem, user, battle);
    const damageEffect = {
      ...(action.effects[0] as UserEffect),
      level: action.level,
    };

    expect(action.level).toBe(0);
    expect(getPower(damageEffect).power).toBe(22);
  });

  it("keeps a 30EP weapon below a comparable 50EP damage jutsu", () => {
    // Regression test for: https://discord.com/channels/1080832341234159667/1375094434437271572/1518261967616475248
    const battle = makeBattleWithWeapon({
      damage: {
        power: 30,
        powerPerLevel: 1,
        statTypes: ["Ninjutsu"],
        generalTypes: [],
      },
    });
    const user = { userId: "attacker", level: 100 } as ReturnedUserState;
    const userItem = makeBattleUserItem();
    const attacker = makeBattleUser("attacker", { level: 100 });
    const defender = makeBattleUser("defender", { level: 100 });

    const weaponAction = userItemToAction(userItem, user, battle);
    const weaponDamageEffect = {
      ...(weaponAction.effects[0] as UserEffect),
      level: weaponAction.level,
    };
    const jutsuDamageEffect = makeDamageEffect({
      power: 50,
      statTypes: ["Ninjutsu"],
      generalTypes: [],
      level: 0,
    });

    const weaponDamage = damageCalc(
      weaponDamageEffect,
      attacker,
      defender,
      dmgConfig,
    );
    const jutsuDamage = damageCalc(jutsuDamageEffect, attacker, defender, dmgConfig);

    expect(getPower(weaponDamageEffect).power).toBe(30);
    expect(jutsuDamage).toBeGreaterThan(weaponDamage);
    expect(jutsuDamage / weaponDamage).toBeCloseTo(50 / 30, 2);
  });
});
