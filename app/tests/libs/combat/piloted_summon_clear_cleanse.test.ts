import { describe, expect, it } from "bun:test";
import { availableUserActions } from "@/libs/combat/actions";
import type { BattleUserState } from "@/libs/combat/types";
import { makeBattleUser, makeInjectBattle } from "./helpers/battleScenario";

/**
 * Issue #1756: a player-piloted summon handed its controller a second basic
 * Clear/Cleanse on an independent cooldown. availableUserActions backs both the
 * action bar and the router's action lookup, so gating it there removes the
 * button and rejects a crafted request alike.
 */

const P = "p1";

const player = () => makeBattleUser(P, { curHealth: 100, isAi: false });

const summon = (over: Partial<BattleUserState> = {}) =>
  makeBattleUser("s1", {
    controllerId: P,
    username: "Demon",
    isAi: true,
    isSummon: true,
    isOriginal: true,
    curHealth: 500,
    ...over,
  });

const actionIds = (users: BattleUserState[], actorId: string) =>
  availableUserActions(makeInjectBattle(users), actorId, true, true).map((a) => a.id);

describe("piloted summons have no basic clear/cleanse", () => {
  it("excludes clear and cleanse for a piloted summon, keeping other basics", () => {
    const ids = actionIds([player(), summon({ isPiloted: true })], "s1");
    expect(ids).not.toContain("clear");
    expect(ids).not.toContain("cleanse");
    expect(ids).toEqual(
      expect.arrayContaining(["basicAttack", "basicHeal", "move", "flee"]),
    );
  });

  it("keeps clear and cleanse for the controlling player", () => {
    const ids = actionIds([player(), summon({ isPiloted: true })], P);
    expect(ids).toEqual(expect.arrayContaining(["clear", "cleanse"]));
  });

  it("leaves AI-driven (non-piloted) summons unchanged", () => {
    const ids = actionIds([player(), summon({ isPiloted: false })], "s1");
    expect(ids).toEqual(expect.arrayContaining(["clear", "cleanse"]));
  });
});
