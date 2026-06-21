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
import { getPower } from "@/libs/combat/tags";
import type { ReturnedUserState, UserEffect } from "@/libs/combat/types";
import { makeBattleUserItem, makeBattleWithWeapon } from "./helpers/battleScenario";

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
});
