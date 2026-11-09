import { describe, expect, it } from "bun:test";
import { alignBattle, hasNoAvailableActions } from "@/libs/combat/turn";
import type { BattleUserState, CompleteBattle } from "@/libs/combat/types";
import { makeBattleUser, makeCompleteBattle } from "../../setup/combat";

/**
 *  1. alignBattle splices orphaned summons on EVERY call, for every battle in the
 *     game -- not just on round progression. A battle with no summons in it must
 *     be completely unaffected.
 *  2. hasNoAvailableActions drives round progression for all actors, and its
 *     action-set choice goes through wantsHumanActionSet. Ordinary humans and
 *     ordinary AI keep their own action sets.
 */

const battleOf = (usersState: BattleUserState[], over: Record<string, unknown> = {}) =>
  makeCompleteBattle({
    usersState,
    activeUserId: usersState[0]?.userId,
    roundStartAt: new Date(Date.now() - 10 * 60 * 1000), // past the turn timer
    updatedAt: new Date(),
    version: 1,
    round: 3,
    ...over,
  }) as CompleteBattle;

describe("alignBattle leaves a summon-free battle untouched", () => {
  const plain = () => [
    makeBattleUser("p1", { curHealth: 100, isAi: false }),
    makeBattleUser("e1", { curHealth: 100, isAi: true }),
  ];

  it("keeps every combatant", () => {
    const battle = battleOf(plain());
    alignBattle(battle, [], "p1");
    expect(battle.usersState.map((u) => u.userId).sort()).toEqual(["e1", "p1"]);
  });

  it("still advances the actor and picks someone who exists", () => {
    const battle = battleOf(plain());
    const { actor } = alignBattle(battle, [], "p1");
    expect(battle.usersState.some((u) => u.userId === actor.userId)).toBe(true);
    expect(battle.activeUserId).toBe(actor.userId);
  });

  it("refills action points when the round progresses", () => {
    const users = plain();
    users.forEach((u) => {
      u.actionPoints = 5;
      u.round = 3;
    });
    const battle = battleOf(users);
    const { progressRound } = alignBattle(battle, [], "p1");
    expect(progressRound).toBe(true);
    expect(battle.usersState.every((u) => u.actionPoints === 100)).toBe(true);
    expect(battle.round).toBe(4);
  });

  it("does not disturb a battle where a summon's controller is alive", () => {
    const battle = battleOf([
      makeBattleUser("p1", { curHealth: 100, isAi: false }),
      makeBattleUser("s1", {
        controllerId: "p1",
        isAi: true,
        isSummon: true,
        isOriginal: true,
        curHealth: 500,
      }),
      makeBattleUser("e1", { curHealth: 100, isAi: true }),
    ]);
    alignBattle(battle, [], "p1");
    expect(battle.usersState.map((u) => u.userId).sort()).toEqual(["e1", "p1", "s1"]);
  });
});

describe("hasNoAvailableActions for ordinary actors", () => {
  // An actor with no jutsu/items and zero action points can afford nothing,
  // whichever set it is evaluated against -- so "no actions" must hold for
  // ordinary humans AND ordinary AI.
  const broke = (over: Partial<BattleUserState>) =>
    makeBattleUser("x", {
      curHealth: 100,
      actionPoints: 0,
      jutsus: [],
      items: [],
      basicActions: [],
      ...over,
    });

  it("an ordinary human with nothing affordable has no actions", () => {
    const u = broke({ userId: "h1", isAi: false });
    const battle = battleOf([u, makeBattleUser("e1", { curHealth: 100, isAi: true })]);
    expect(hasNoAvailableActions(battle, "h1")).toBe(true);
  });

  it("an ordinary AI with nothing affordable has no actions", () => {
    const u = broke({ userId: "a1", isAi: true });
    const battle = battleOf([u, makeBattleUser("p1", { curHealth: 100, isAi: false })]);
    expect(hasNoAvailableActions(battle, "a1")).toBe(true);
  });

  it("treats an actor missing from the battle as having no actions", () => {
    // The lookup misses and the function falls through to its default. alignBattle
    // can remove a spliced summon between an actorId being chosen and this being
    // asked about it.
    const battle = battleOf([makeBattleUser("p1", { curHealth: 100 })]);
    expect(hasNoAvailableActions(battle, "ghost")).toBe(true);
  });

  it("treats a dead or fled actor as having no actions", () => {
    const dead = makeBattleUser("d1", { curHealth: 0 });
    const fled = makeBattleUser("f1", { curHealth: 100, fledBattle: true });
    const left = makeBattleUser("l1", { curHealth: 100, leftBattle: true });
    const battle = battleOf([dead, fled, left]);
    expect(hasNoAvailableActions(battle, "d1")).toBe(true);
    expect(hasNoAvailableActions(battle, "f1")).toBe(true);
    expect(hasNoAvailableActions(battle, "l1")).toBe(true);
  });
});
