// @vitest-environment node

import { eq, inArray } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { actionLog, userData } from "@/drizzle/schema";
import { profileRouter } from "@/server/api/routers/profile";
import { insertUsers } from "../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

const caller = (userId: string) => callerFor(profileRouter, userId);

const request = (
  requestId: string,
  overrides: Partial<{
    targetUserId: string;
    expectedUsername: string;
    amount: number;
    reason: string;
  }> = {},
) => ({
  targetUserId: "experience-target",
  expectedUsername: "Experience Target",
  amount: 125,
  reason: "Gap 86 verified staff adjustment",
  requestId,
  ...overrides,
});

describeWithDatabase("profile.awardExperience", () => {
  beforeEach(async () => {
    await resetTables(actionLog, userData);
    await insertUsers([
      {
        userId: "experience-admin",
        username: "Experience Admin",
        role: "OWNER",
      },
      {
        userId: "experience-target",
        username: "Experience Target",
        earnedExperience: 400,
        experience: 12_345,
        level: 42,
        rank: "JONIN",
      },
      {
        userId: "experience-sibling",
        username: "Experience Sibling",
        earnedExperience: 900,
      },
    ]);
  });

  it("atomically awards only unallocated experience, audits it, and replays once", async () => {
    const database = await getTestDatabase();
    const api = await caller("experience-admin");
    const input = request("86000000-0000-4000-8000-000000000001");

    const first = await api.awardExperience(input);
    const replay = await api.awardExperience(input);
    const users = await database
      .select()
      .from(userData)
      .where(
        inArray(userData.userId, ["experience-target", "experience-sibling"]),
      );
    const target = users.find((user) => user.userId === "experience-target");
    const sibling = users.find((user) => user.userId === "experience-sibling");
    const receipts = await database
      .select()
      .from(actionLog)
      .where(eq(actionLog.id, `experience-award:${input.requestId}`));

    expect(first.success, JSON.stringify(first)).toBe(true);
    expect(first).toMatchObject({
      success: true,
      requestId: input.requestId,
      award: {
        targetUserId: "experience-target",
        username: "Experience Target",
        amount: 125,
        earnedExperienceBefore: 400,
        earnedExperienceAfter: 525,
      },
    });
    expect(replay).toMatchObject({
      success: true,
      requestId: input.requestId,
      award: first.award,
    });
    expect(target).toMatchObject({
      earnedExperience: 525,
      experience: 12_345,
      level: 42,
      rank: "JONIN",
    });
    expect(sibling).toMatchObject({ earnedExperience: 900 });
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      userId: "experience-admin",
      relatedId: "experience-target",
      relatedMsg: input.reason,
      relatedValue: 125,
    });
  });

  it("serializes distinct concurrent awards and rejects changed request reuse", async () => {
    const database = await getTestDatabase();
    const api = await caller("experience-admin");
    const first = request("86000000-0000-4000-8000-000000000002", {
      amount: 20,
    });
    const second = request("86000000-0000-4000-8000-000000000003", {
      amount: 30,
    });

    const results = await Promise.all([
      api.awardExperience(first),
      api.awardExperience(second),
    ]);
    const collision = await api.awardExperience({ ...first, amount: 21 });
    const target = await database.query.userData.findFirst({
      where: eq(userData.userId, "experience-target"),
    });

    expect(results.every((result) => result.success), JSON.stringify(results)).toBe(
      true,
    );
    expect(collision).toMatchObject({
      success: false,
      message: "Invalid experience award request ID",
    });
    expect(target?.earnedExperience).toBe(450);
  });

  it("rejects stale identity, banned actors, and unauthorized actors without writes", async () => {
    const database = await getTestDatabase();
    await insertUsers([
      {
        userId: "experience-banned-admin",
        username: "Banned Experience Admin",
        role: "OWNER",
        isBanned: true,
      },
      {
        userId: "experience-regular-user",
        username: "Regular Experience User",
        role: "USER",
      },
    ]);
    const owner = await caller("experience-admin");
    const banned = await caller("experience-banned-admin");
    const unauthorized = await caller("experience-regular-user");

    const stale = await owner.awardExperience(
      request("86000000-0000-4000-8000-000000000004", {
        expectedUsername: "Previous Name",
      }),
    );
    const bannedResult = await banned.awardExperience(
      request("86000000-0000-4000-8000-000000000005"),
    );
    const unauthorizedResult = await unauthorized.awardExperience(
      request("86000000-0000-4000-8000-000000000006"),
    );
    const target = await database.query.userData.findFirst({
      where: eq(userData.userId, "experience-target"),
    });
    const receipts = await database
      .select()
      .from(actionLog)
      .where(eq(actionLog.relatedId, "experience-target"));

    expect(stale.success).toBe(false);
    expect(bannedResult.success).toBe(false);
    expect(unauthorizedResult.success).toBe(false);
    expect(target?.earnedExperience).toBe(400);
    expect(receipts).toHaveLength(0);
  });
});

// Keep the request contract visible in ordinary runs; destructive DB tests are opt-in.
describe("experience award request contract", () => {
  it("captures an immutable recipient, amount, reason, and UUID", () => {
    expect(request("86000000-0000-4000-8000-000000000007")).toMatchObject({
      targetUserId: "experience-target",
      expectedUsername: "Experience Target",
      amount: 125,
      reason: "Gap 86 verified staff adjustment",
    });
  });
});
