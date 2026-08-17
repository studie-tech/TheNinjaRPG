import { describe, expect, it, vi } from "vitest";

// Override ONLY checkFriendlyFire — do NOT stub applyEffects. Under `bun test` vi.mock merges the
// factory over the real module and the override is process-global, so stubbing applyEffects here
// leaks into sibling suites that drive the real applyEffects (summon/poison/used_tag_types damage-
// credit tests) and crashes them. This suite never calls applyEffects, so leaving it real is inert.
vi.mock("@/libs/combat/process", () => ({
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
    const battle = makeBattleWithWeapon({
      damage: {
        power: 22,
        powerPerLevel: 1,
        statTypes: ["Ninjutsu"],
        generalTypes: [],
      },
    });
    const user = { userId: "attacker", level: 100 } as ReturnedUserState;
    const userItem = makeBattleUserItem({ level: 1 });

    const action = userItemToAction(userItem, user, battle);
    const damageEffect = {
      ...(action.effects[0] as UserEffect),
      level: action.level,
    };

    expect(action.level).toBe(1);
    expect(getPower(damageEffect).power).toBe(23);
  });

  it("scales weapon damage power from the item ownership level", () => {
    const battle = makeBattleWithWeapon({
      damage: {
        power: 22,
        powerPerLevel: 1,
        statTypes: ["Ninjutsu"],
        generalTypes: [],
      },
    });
    const user = { userId: "attacker", level: 1 } as ReturnedUserState;
    const userItem = makeBattleUserItem({ level: 10 });

    const action = userItemToAction(userItem, user, battle);
    const damageEffect = {
      ...(action.effects[0] as UserEffect),
      level: action.level,
    };

    expect(action.level).toBe(10);
    expect(getPower(damageEffect).power).toBe(32);
  });

  it("keeps character-level scaling for AI users' items", () => {
    // AI users never earn item XP, so their gear scales from character level
    // instead of being pinned to item level 1.
    const battle = makeBattleWithWeapon({
      damage: {
        power: 22,
        powerPerLevel: 1,
        statTypes: ["Ninjutsu"],
        generalTypes: [],
      },
    });
    const user = { userId: "attacker", level: 100, isAi: true } as ReturnedUserState;
    const userItem = makeBattleUserItem({ level: 1 });

    const action = userItemToAction(userItem, user, battle);

    expect(action.level).toBe(100);
  });

  it("keeps a 30EP weapon below a comparable 50EP damage jutsu at equal levels", () => {
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
    // Level 1 is the minimum ownership level a real item can have
    const userItem = makeBattleUserItem({ level: 1 });
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
      level: 1,
    });

    const weaponDamage = damageCalc(
      weaponDamageEffect,
      attacker,
      defender,
      dmgConfig,
    );
    const jutsuDamage = damageCalc(jutsuDamageEffect, attacker, defender, dmgConfig);

    expect(getPower(weaponDamageEffect).power).toBe(31);
    expect(jutsuDamage).toBeGreaterThan(weaponDamage);
    expect(jutsuDamage / weaponDamage).toBeCloseTo(50 / 31, 2);
  });
});
