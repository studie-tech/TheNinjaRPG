import { describe, expect, it } from "vitest";
import { getBattleClaimIds } from "@/libs/combat/util";

// A single AI row backs every fight against that opponent, so the battle-start
// update must leave it alone - claiming it made concurrent arena fights contend
// on one shared row and deadlock. The returned length doubles as the expected
// rowsAffected for the compare-and-swap guard, so an AI slipping back in would
// also start failing battles with a spurious rollback.
describe("getBattleClaimIds", () => {
  const human = { userId: "human-1", isAi: false };
  const ai = { userId: "arena-ai", isAi: true };

  it("claims the player but not the AI opponent in an arena fight", () => {
    const ids = getBattleClaimIds({
      battleType: "ARENA",
      userIds: ["human-1"],
      targetIds: ["arena-ai"],
      participants: [human, ai],
    });
    expect(ids).toEqual(["human-1"]);
  });

  it("claims both sides of a player-versus-player fight", () => {
    const other = { userId: "human-2", isAi: false };
    const ids = getBattleClaimIds({
      battleType: "COMBAT",
      userIds: ["human-1"],
      targetIds: ["human-2"],
      participants: [human, other],
    });
    expect(ids.sort()).toEqual(["human-1", "human-2"]);
  });

  it("claims only the attackers for auto battles", () => {
    const ids = getBattleClaimIds({
      battleType: "KAGE_AI",
      userIds: ["human-1"],
      targetIds: ["arena-ai"],
      participants: [human, ai],
    });
    expect(ids).toEqual(["human-1"]);
  });

  it("claims only the attacker in a clan challenge against a human leader", () => {
    const leader = { userId: "human-2", isAi: false };
    const ids = getBattleClaimIds({
      battleType: "CLAN_CHALLENGE",
      userIds: ["human-1"],
      targetIds: ["human-2"],
      participants: [human, leader],
    });
    expect(ids).toEqual(["human-1"]);
  });

  it("counts an id with no fetched participant row so the CAS guard fails safe", () => {
    // The database update's own predicates are the authority on what actually
    // gets claimed; counting an unknown id here keeps the expected row count
    // high, so the rowsAffected check rolls the battle back instead of starting
    // it with a missing participant.
    const ids = getBattleClaimIds({
      battleType: "COMBAT",
      userIds: ["human-1"],
      targetIds: ["ghost-id"],
      participants: [human],
    });
    expect(ids.sort()).toEqual(["ghost-id", "human-1"]);
  });

  it("skips an AI attacker as well as an AI defender", () => {
    const ids = getBattleClaimIds({
      battleType: "COMBAT",
      userIds: ["arena-ai"],
      targetIds: ["human-1"],
      participants: [ai, human],
    });
    expect(ids).toEqual(["human-1"]);
  });

  it("returns nothing when every participant is an AI", () => {
    const otherAi = { userId: "arena-ai-2", isAi: true };
    const ids = getBattleClaimIds({
      battleType: "COMBAT",
      userIds: ["arena-ai"],
      targetIds: ["arena-ai-2"],
      participants: [ai, otherAi],
    });
    expect(ids).toEqual([]);
  });

  it("deduplicates a player listed on both sides", () => {
    const ids = getBattleClaimIds({
      battleType: "COMBAT",
      userIds: ["human-1"],
      targetIds: ["human-1"],
      participants: [human],
    });
    expect(ids).toEqual(["human-1"]);
  });
});
