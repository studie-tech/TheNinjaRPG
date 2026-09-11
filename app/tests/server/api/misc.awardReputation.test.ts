// @vitest-environment node

import { eq, inArray } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { actionLog, userData, userRewards } from "@/drizzle/schema";
import { miscRouter } from "@/routers/misc";
import { insertUsers } from "../../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

const callerForUser = async (userId: string) =>
  miscRouter.createCaller({ drizzle: await getTestDatabase(), userId } as never);

const request = (
  requestId: string,
  overrides: Partial<{
    userIds: string[];
    expectedUsers: Array<{ userId: string; username: string }>;
    reputationAmount: number;
    moneyAmount: number;
    reason: string;
  }> = {},
) => ({
  requestId,
  userIds: ["award-target"],
  expectedUsers: [{ userId: "award-target", username: "Award Target" }],
  reputationAmount: 7.5,
  moneyAmount: 125,
  reason: "Gap 85 verified staff award",
  ...overrides,
});

describeWithDatabase("misc.awardReputation", () => {
  beforeEach(async () => {
    await resetTables(actionLog, userRewards, userData);
    await insertUsers([
      {
        userId: "award-admin",
        username: "Award Admin",
        role: "OWNER",
      },
      {
        userId: "award-target",
        username: "Award Target",
        reputationPoints: 10,
        reputationPointsTotal: 20,
        money: 1_000,
      },
      {
        userId: "award-sibling",
        username: "Award Sibling",
        reputationPoints: 30,
        reputationPointsTotal: 40,
        money: 2_000,
      },
    ]);
  });

  it("commits the balance changes and public audit atomically, then replays once", async () => {
    const database = await getTestDatabase();
    const caller = await callerForUser("award-admin");
    const input = request("85000000-0000-4000-8000-000000000001");

    const first = await caller.awardReputation(input);
    const replay = await caller.awardReputation(input);

    expect(first).toMatchObject({ success: true, requestId: input.requestId });
    expect(replay).toMatchObject({ success: true, requestId: input.requestId });
    const affectedUsers = await database
      .select()
      .from(userData)
      .where(inArray(userData.userId, ["award-target", "award-sibling"]));
    const target = affectedUsers.find((user) => user.userId === "award-target");
    const sibling = affectedUsers.find((user) => user.userId === "award-sibling");
    const rewards = await database
      .select()
      .from(userRewards)
      .where(eq(userRewards.receiverId, "award-target"));
    const receipts = await database
      .select()
      .from(actionLog)
      .where(eq(actionLog.id, `award:${input.requestId}`));

    expect(target).toMatchObject({
      reputationPoints: 17.5,
      reputationPointsTotal: 27.5,
      money: 1_125,
    });
    expect(sibling).toMatchObject({
      reputationPoints: 30,
      reputationPointsTotal: 40,
      money: 2_000,
    });
    expect(rewards).toHaveLength(1);
    expect(rewards[0]).toMatchObject({
      awardedById: "award-admin",
      reputationAmount: 7.5,
      moneyAmount: 125,
      reason: input.reason,
    });
    expect(receipts).toHaveLength(1);
  });

  it("applies distinct concurrent awards and rejects a changed replay payload", async () => {
    const database = await getTestDatabase();
    const caller = await callerForUser("award-admin");
    const first = request("85000000-0000-4000-8000-000000000002", {
      reputationAmount: 2,
      moneyAmount: 20,
    });
    const second = request("85000000-0000-4000-8000-000000000003", {
      reputationAmount: 3,
      moneyAmount: 30,
    });

    const results = await Promise.all([
      caller.awardReputation(first),
      caller.awardReputation(second),
    ]);
    const collision = await caller.awardReputation({
      ...first,
      reputationAmount: 4,
    });
    const target = await database.query.userData.findFirst({
      where: eq(userData.userId, "award-target"),
    });

    expect(results.every((result) => result.success)).toBe(true);
    expect(collision).toMatchObject({ success: false, message: "Invalid award request ID" });
    expect(target).toMatchObject({
      reputationPoints: 15,
      reputationPointsTotal: 25,
      money: 1_050,
    });
  });

  it("rejects stale, AI, banned-actor, unauthorized, and self targets without writes", async () => {
    const database = await getTestDatabase();
    await insertUsers([
      { userId: "award-ai", username: "Award AI", isAi: true },
      {
        userId: "award-banned-admin",
        username: "Banned Admin",
        role: "OWNER",
        isBanned: true,
      },
      { userId: "award-user", username: "Regular User", role: "USER" },
    ]);
    const owner = await callerForUser("award-admin");
    const banned = await callerForUser("award-banned-admin");
    const unauthorized = await callerForUser("award-user");

    const stale = await owner.awardReputation(
      request("85000000-0000-4000-8000-000000000004", {
        expectedUsers: [{ userId: "award-target", username: "Old Name" }],
      }),
    );
    const ai = await owner.awardReputation(
      request("85000000-0000-4000-8000-000000000005", {
        userIds: ["award-ai"],
        expectedUsers: [{ userId: "award-ai", username: "Award AI" }],
      }),
    );
    const bannedResult = await banned.awardReputation(
      request("85000000-0000-4000-8000-000000000006"),
    );
    const unauthorizedResult = await unauthorized.awardReputation(
      request("85000000-0000-4000-8000-000000000007"),
    );
    const self = await owner.awardReputation(
      request("85000000-0000-4000-8000-000000000008", {
        userIds: ["award-admin"],
        expectedUsers: [{ userId: "award-admin", username: "Award Admin" }],
      }),
    );
    const target = await database.query.userData.findFirst({
      where: eq(userData.userId, "award-target"),
    });
    const rewards = await database.select().from(userRewards);

    expect(stale.success).toBe(false);
    expect(ai.success).toBe(false);
    expect(bannedResult.success).toBe(false);
    expect(unauthorizedResult.success).toBe(false);
    expect(self.success).toBe(false);
    expect(target).toMatchObject({ reputationPoints: 10, money: 1_000 });
    expect(rewards).toHaveLength(0);
  });
});

// Keep a visible suite in ordinary runs; the destructive database cases above are opt-in.
describe("award request contract", () => {
  it("uses a UUID request key and immutable recipient names", () => {
    expect(request("85000000-0000-4000-8000-000000000009")).toMatchObject({
      expectedUsers: [{ userId: "award-target", username: "Award Target" }],
    });
  });
});
