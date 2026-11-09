import { describe, expect, it } from "bun:test";
import { availableUserActions } from "@/libs/combat/actions";
import { maskBattle, maskUsersState } from "@/libs/combat/masking";
import { shouldPilotSummon } from "@/libs/combat/summon";
import { wantsHumanActionSet } from "@/libs/combat/turn";
import type { BattleUserState } from "@/libs/combat/types";
import { makeBattleUser, makeCompleteBattle } from "../../setup/combat";

const P = "p1";

const pilotedSummon = () =>
  makeBattleUser("summon1", {
    controllerId: "player1",
    isAi: true,
    isSummon: true,
    isPiloted: true,
  });

describe("shouldPilotSummon", () => {
  // Battle type is deliberately not a parameter: summon() refuses to spawn in
  // AutoBattleTypes before this is called, so summonsAllowedInBattle owns that
  // rule (see summon.test.ts) and repeating it here would pin dead code.

  it("pilots when the jutsu opts in, controller is a human, and battle is interactive", () => {
    expect(shouldPilotSummon({ isAi: false }, true)).toBe(true);
  });

  it("does NOT pilot when the jutsu is not playerControlled (flag off / absent)", () => {
    expect(shouldPilotSummon({ isAi: false }, false)).toBe(false);
    expect(shouldPilotSummon({ isAi: false }, undefined)).toBe(false);
  });

  it("does NOT pilot when controller is AI, even if the jutsu opts in", () => {
    expect(shouldPilotSummon({ isAi: true }, true)).toBe(false);
  });

  it("does NOT pilot when controller is missing, even if the jutsu opts in", () => {
    expect(shouldPilotSummon(undefined, true)).toBe(false);
  });
});

describe("wantsHumanActionSet", () => {
  it("human player -> human set", () => {
    expect(wantsHumanActionSet(makeBattleUser("x", { isAi: false }))).toBe(true);
  });
  it("AI NPC -> AI set", () => {
    expect(wantsHumanActionSet(makeBattleUser("x", { isAi: true }))).toBe(false);
  });
  it("AI (non-piloted) summon -> AI set", () => {
    expect(
      wantsHumanActionSet(makeBattleUser("x", { isAi: true, isSummon: true })),
    ).toBe(false);
  });
  it("piloted summon -> human set", () => {
    expect(
      wantsHumanActionSet(
        makeBattleUser("x", { isAi: true, isSummon: true, isPiloted: true }),
      ),
    ).toBe(true);
  });
});

describe("isPiloted masking round-trip", () => {
  it("keeps isPiloted for the controller (full state)", () => {
    const [masked] = maskUsersState([pilotedSummon()], "player1");
    expect(masked?.isPiloted).toBe(true);
  });

  it("keeps isPiloted for an opponent (public state)", () => {
    const [masked] = maskUsersState([pilotedSummon()], "enemy1");
    expect(masked?.isPiloted).toBe(true);
  });

  it("leaves isPiloted undefined for a non-piloted user (self/full state)", () => {
    const human = makeBattleUser("player1");
    const [maskedSelf] = maskUsersState([human], "player1");
    expect(maskedSelf?.isPiloted).toBeUndefined();
  });

  it("leaves isPiloted undefined for a non-piloted user (opponent/public state)", () => {
    const human = makeBattleUser("player1");
    const [maskedOther] = maskUsersState([human], "enemy1");
    expect(maskedOther?.isPiloted).toBeUndefined();
  });

  it("strips a private (non-allow-listed) field but retains isPiloted", () => {
    const summon = makeBattleUser("summon1", {
      controllerId: "player1",
      isPiloted: true,
      strength: 50, // privateState -> must be stripped for an opponent
    });
    const masked = maskBattle(
      makeCompleteBattle({ usersState: [summon] }),
      "opponentX",
    );
    expect(masked.usersState[0]).not.toHaveProperty("strength");
    expect(masked.usersState[0]).toHaveProperty("isPiloted", true);
  });
});

/**
 * A player-piloted summon must not hand its controller a second basic
 * Clear/Cleanse on an independent cooldown. availableUserActions backs both the
 * action bar and the router's action lookup, so gating it there removes the
 * button and rejects a crafted request alike.
 */
describe("piloted summons have no basic clear/cleanse", () => {
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
    availableUserActions(
      makeCompleteBattle({ usersState: users }),
      actorId,
      true,
      true,
    ).map((a) => a.id);

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
