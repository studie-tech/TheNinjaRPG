import { describe, expect, it } from "bun:test";
import { getElderNomineeSkipReason, resolveElderRotation } from "@/libs/elder";

const clan = {
  id: "clan",
  name: "Clan",
  villageId: "village",
  leaderId: "leader",
  elderNomineeId: "nominee" as string | null,
};
const nominee = {
  userId: "nominee",
  username: "Nominee",
  clanId: "clan",
  villageId: "village",
  isBanned: false,
  rank: "JONIN",
  anbuId: null as string | null,
};

describe("getElderNomineeSkipReason", () => {
  it("accepts a JONIN of the clan and its village", () => {
    expect(getElderNomineeSkipReason(nominee, clan)).toBeUndefined();
  });

  it.each([
    [undefined, "Character no longer exists"],
    [{ ...nominee, isBanned: true }, "Banned"],
    [{ ...nominee, villageId: "other" }, "Left the village"],
    [{ ...nominee, clanId: null }, "Left the clan"],
    [{ ...nominee, clanId: "other" }, "Left the clan"],
    [{ ...nominee, anbuId: "squad" }, "In ANBU"],
    [{ ...nominee, rank: "CHUNIN" }, "Rank is CHUNIN, not JONIN"],
  ])("names why a nominee is skipped", (candidate, reason) => {
    expect(getElderNomineeSkipReason(candidate, clan)).toBe(reason);
  });
});

describe("resolveElderRotation", () => {
  it("logs every demotion, promotion and skipped nominee against the village", () => {
    const { toPromote, logs } = resolveElderRotation(
      [{ userId: "old", username: "Old", villageId: "village" }],
      [clan, { ...clan, id: "clan-2", name: "Clan 2", elderNomineeId: null }],
      [nominee, { ...nominee, userId: "leader", username: "Leader", rank: "GENIN" }],
    );
    expect(toPromote).toEqual(["nominee"]);
    expect(logs.map((log) => [log.userId, log.villageId, log.message])).toEqual([
      ["old", "village", "Old demoted from elder"],
      ["nominee", "village", "Nominee promoted to elder"],
      ["leader", "village", "Leader skipped as elder nominee"],
    ]);
    expect(logs[2]?.changes).toEqual([
      "Skipped elder nominee: Leader (leader)",
      "Clan: Clan 2 (clan-2)",
      "Selected by: Clan leader",
      "Reason: Left the clan",
    ]);
  });
});
