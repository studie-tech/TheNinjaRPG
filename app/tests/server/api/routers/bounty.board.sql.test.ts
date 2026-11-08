import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { BOUNTY_MIN_AMOUNT } from "@/drizzle/constants";
import { bounty, bountyContribution, bountySignup, userData } from "@/drizzle/schema";
import { bountyRouter } from "@/server/api/routers/bounty";
import { insertUsers } from "../../../setup/factories";
import { callerFor, describeWithDatabase, getTestDatabase, resetTables } from "../../../setup/testDatabase";

const moneyOf = async (userId: string) =>
  (await (await getTestDatabase()).query.userData.findFirst({ where: eq(userData.userId, userId) }))?.money;

/** Placing and tracking bounties: each guard answers before anything is written. */
describeWithDatabase("bounty board", () => {
  beforeEach(async () => {
    await resetTables(bounty, bountyContribution, bountySignup, userData);
    await insertUsers([
      { userId: "creator", username: "Creator", rank: "JONIN", money: 2 * BOUNTY_MIN_AMOUNT, villageId: "home" },
      { userId: "target", username: "Target", rank: "JONIN", villageId: "elsewhere" },
      { userId: "other", username: "Other", rank: "JONIN", villageId: "elsewhere" },
      { userId: "hunter", username: "Hunter", rank: "JONIN", villageId: "home" },
      { userId: "genin", username: "Genin", rank: "GENIN", villageId: "home" },
      { userId: "neighbour", username: "Neighbour", rank: "JONIN", villageId: "elsewhere" },
    ]);
  });

  const placeBounty = async () =>
    (await callerFor(bountyRouter, "creator")).create({ targetUserId: "target", amountRyo: BOUNTY_MIN_AMOUNT });

  it("places a bounty once and refuses a second open bounty on the same target", async () => {
    expect(await placeBounty()).toEqual({ success: true, message: "Bounty created" });
    expect(await placeBounty()).toEqual({
      success: false,
      message: "Target already has an active bounty. You can add money to it instead.",
    });
    expect(await moneyOf("creator")).toBe(BOUNTY_MIN_AMOUNT);
    expect(await (await getTestDatabase()).query.bounty.findMany()).toHaveLength(1);
  });

  it("tracks a bounty once and checks the target, rank and village", async () => {
    await placeBounty();
    const bountyId = (await (await getTestDatabase()).query.bounty.findFirst())!.id;
    const signup = async (userId: string, targetUserId = "target") =>
      (await callerFor(bountyRouter, userId)).signup({ bountyId, targetUserId });

    expect(await signup("creator")).toEqual({ success: false, message: "Cannot track your own bounty" });
    expect(await signup("hunter", "other")).toEqual({ success: false, message: "Target user does not match bounty" });
    expect(await signup("genin")).toEqual({ success: false, message: "Your rank cannot engage in PvP" });
    expect(await signup("neighbour")).toEqual({
      success: false,
      message: "Cannot take bounties on players in the same village",
    });
    expect(await (await getTestDatabase()).query.bountySignup.findMany()).toHaveLength(0);
    expect(await signup("hunter")).toEqual({ success: true, message: "Tracking this bounty" });
    expect(await signup("hunter")).toEqual({ success: false, message: "Already sign up" });
  });
});
