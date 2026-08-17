import { describe, it, expect } from "vitest";
import { alignBattle } from "@/libs/combat/util";
import { makeBattleUser, makeCompleteBattle } from "./helpers/battleScenario";
import type { BattleUserState } from "@/libs/combat/types";

/**
 * alignBattle must remove masterless summons BEFORE it selects the next actor.
 * If the splice ran afterwards, the orphan could be picked as the actor and then
 * removed underneath the caller, leaving battle.activeUserId pointing at a user
 * that is no longer in usersState and naming a removed summon in the
 * "It is now X's turn" battle-log line.
 */

// Turn order is usersState order, so put the orphan directly after the actor the
// ring is currently on -- it is the one the timer advance would land on next.
const scenario = (): BattleUserState[] => [
  makeBattleUser("enemy", { curHealth: 100, isAi: true }),
  makeBattleUser("orphan-summon", {
    controllerId: "dead-player",
    isAi: true,
    isSummon: true,
    isOriginal: true,
    curHealth: 500,
  }),
  makeBattleUser("dead-player", { curHealth: 0 }),
];

const battleWith = (usersState: BattleUserState[]) =>
  makeCompleteBattle({
    usersState,
    activeUserId: "enemy",
    // Well past COMBAT_SECONDS so calcActiveUser advances to the next actor.
    roundStartAt: new Date(Date.now() - 10 * 60 * 1000),
    updatedAt: new Date(),
    version: 1,
  });

describe("alignBattle orphan cleanup ordering", () => {
  it("never selects a masterless summon as the next actor", () => {
    const battle = battleWith(scenario());

    const { actor } = alignBattle(battle, [], "enemy");

    expect(actor.userId).toBe("enemy");
    expect(battle.activeUserId).toBe("enemy");
  });

  it("leaves activeUserId pointing at a user that is still in usersState", () => {
    const battle = battleWith(scenario());

    alignBattle(battle, [], "enemy");

    expect(battle.usersState.some((u) => u.userId === "orphan-summon")).toBe(false);
    expect(battle.usersState.some((u) => u.userId === battle.activeUserId)).toBe(true);
  });

  it("cleans up orphans even when the round does not progress", () => {
    // Previously the splice was gated on progressRound, so a summon orphaned
    // mid-round lingered until the next round boundary.
    const battle = makeCompleteBattle({
      usersState: scenario(),
      activeUserId: "enemy",
      roundStartAt: new Date(),
      updatedAt: new Date(),
      version: 1,
    });

    alignBattle(battle, [], "enemy");

    expect(battle.usersState.some((u) => u.userId === "orphan-summon")).toBe(false);
  });

  it("keeps a summon whose controller is still fighting", () => {
    const battle = battleWith([
      makeBattleUser("enemy", { curHealth: 100, isAi: true }),
      makeBattleUser("summon", {
        controllerId: "player",
        isAi: true,
        isSummon: true,
        isOriginal: true,
        curHealth: 500,
      }),
      makeBattleUser("player", { curHealth: 100 }),
    ]);

    alignBattle(battle, [], "enemy");

    expect(battle.usersState.some((u) => u.userId === "summon")).toBe(true);
  });
});
