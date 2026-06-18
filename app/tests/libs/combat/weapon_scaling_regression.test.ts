import { describe, expect, it, vi } from "vitest";

vi.mock("@/libs/combat/process", () => ({
  applyEffects: vi.fn(() => ({
    newBattle: {},
    actionEffects: [],
  })),
  checkFriendlyFire: vi.fn(() => true),
}));

vi.mock("@/libs/hexgrid", () => ({
  getPossibleActionTiles: vi.fn(() => new Set()),
  PathCalculator: vi.fn(),
}));

vi.mock("@/server/db", () => ({
  drizzleDB: {},
}));

import { userItemToAction } from "@/libs/combat/actions";
import { getPower } from "@/libs/combat/tags";
import type {
  BattleUserItem,
  ReturnedBattle,
  ReturnedUserState,
  UserEffect,
} from "@/libs/combat/types";
import { DamageTag } from "@/validators/combat";

const makeBattleWithWeapon = (): ReturnedBattle => {
  const weapon = {
    id: "weapon-1",
    name: "Regression Weapon",
    image: "/weapon.png",
    battleDescription: "",
    itemType: "WEAPON",
    target: "OTHER_USER",
    method: "SINGLE",
    range: 1,
    healthCost: 0,
    healthCostReducePerLvl: 0,
    chakraCost: 0,
    chakraCostReducePerLvl: 0,
    staminaCost: 0,
    staminaCostReducePerLvl: 0,
    actionCostPerc: 40,
    cooldown: 0,
    maxDurability: 100,
    effects: [
      DamageTag.parse({
        power: 22,
        powerPerLevel: 1,
        calculation: "formula",
        statTypes: ["Highest"],
        generalTypes: ["Highest"],
      }),
    ],
  };

  return {
    extraState: {
      items: { [weapon.id]: weapon },
    },
  } as unknown as ReturnedBattle;
};

describe("weapon action scaling", () => {
  it("does not scale weapon damage power from the user's character level", () => {
    const battle = makeBattleWithWeapon();
    const user = { userId: "attacker", level: 100 } as ReturnedUserState;
    const userItem = {
      id: "user-item-1",
      itemId: "weapon-1",
      quantity: 1,
      equipped: "HAND_1",
      durability: 100,
      dropChancePerc: 0,
      lastUsedRound: 0,
      originalCooldown: 0,
    } as BattleUserItem;

    const action = userItemToAction(userItem, user, battle);
    const damageEffect = {
      ...(action.effects[0] as UserEffect),
      level: action.level,
    };

    expect(action.level).toBe(0);
    expect(getPower(damageEffect).power).toBe(22);
  });
});
