// @vitest-environment node

import { and, eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { actionLog, badge, userBadge, userData } from "@/drizzle/schema";
import { staffRouter } from "@/server/api/routers/staff";
import type { DrizzleClient } from "@/server/db";
import { insertUsers } from "../../setup/factories";
import { failStatements } from "../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  indexColumns,
  resetTables,
} from "../../setup/testDatabase";

const OWNER = "badge-assignment-owner";
const TARGET = "badge-assignment-target";
const SIBLING = "badge-assignment-sibling";
const FIRST_BADGE = "badge-assignment-first";
const SECOND_BADGE = "badge-assignment-second";

const request = (
  requestId: string,
  overrides: Partial<{
    userId: string;
    expectedUsername: string;
    badgeId: string;
    expectedBadgeName: string;
  }> = {},
) => ({
  requestId,
  userId: TARGET,
  expectedUsername: "Badge Assignment Target",
  badgeId: FIRST_BADGE,
  expectedBadgeName: "Gap 90 First Badge",
  ...overrides,
});

describeWithDatabase("staff.insertUserBadge", () => {
  beforeEach(async () => {
    const database = await getTestDatabase();
    await resetTables(actionLog, userBadge, badge, userData);
    await insertUsers([
      { userId: OWNER, username: "Badge Assignment Owner", role: "OWNER" },
      { userId: TARGET, username: "Badge Assignment Target", role: "USER" },
      { userId: SIBLING, username: "Badge Assignment Sibling", role: "USER" },
      {
        userId: "badge-assignment-banned",
        username: "Badge Assignment Banned",
        role: "OWNER",
        isBanned: true,
      },
      {
        userId: "badge-assignment-ordinary",
        username: "Badge Assignment Ordinary",
        role: "USER",
      },
      {
        userId: "badge-assignment-content",
        username: "Badge Assignment Content",
        role: "CONTENT",
      },
    ]);
    await database.insert(badge).values([
      {
        id: FIRST_BADGE,
        name: "Gap 90 First Badge",
        image: "/badges/gap-90-first.png",
        description: "First badge fixture",
      },
      {
        id: SECOND_BADGE,
        name: "Gap 90 Second Badge",
        image: "/badges/gap-90-second.png",
        description: "Second badge fixture",
      },
    ]);
  });

  it("commits one membership and one audit, then replays the same request idempotently", async () => {
    const database = await getTestDatabase();
    const caller = await callerFor(staffRouter, OWNER);
    const input = request("90000000-0000-4000-8000-000000000001");

    const first = await caller.insertUserBadge(input);
    const replay = await caller.insertUserBadge(input);
    const memberships = await database.query.userBadge.findMany({
      where: and(
        eq(userBadge.userId, TARGET),
        eq(userBadge.badgeId, FIRST_BADGE),
      ),
    });
    const receipts = await database.query.actionLog.findMany({
      where: eq(actionLog.id, `insert-user-badge:${input.requestId}`),
    });

    expect(first).toMatchObject({
      success: true,
      userId: TARGET,
      badgeId: FIRST_BADGE,
      requestId: input.requestId,
    });
    expect(replay).toEqual(first);
    expect(memberships).toHaveLength(1);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      userId: OWNER,
      relatedId: TARGET,
      relatedMsg: "Insert badge: Gap 90 First Badge",
    });
  });

  it("distinguishes a pre-existing badge from a replay", async () => {
    const database = await getTestDatabase();
    await database.insert(userBadge).values({ userId: TARGET, badgeId: FIRST_BADGE });
    const caller = await callerFor(staffRouter, OWNER);
    const input = request("90000000-0000-4000-8000-000000000002");

    const result = await caller.insertUserBadge(input);
    const receipt = await database.query.actionLog.findFirst({
      where: eq(actionLog.id, `insert-user-badge:${input.requestId}`),
    });

    expect(result).toEqual({
      success: false,
      message: "Gap 90 First Badge is already assigned to this user",
    });
    expect(receipt).toBeUndefined();
  });

  it("rolls the membership back when its audit cannot be written", async () => {
    const database = await getTestDatabase();
    const failingDatabase = new Proxy(database, {
      get(target, property, receiver) {
        if (property === "transaction") {
          return <T>(callback: (tx: DrizzleClient) => Promise<T>) =>
            target.transaction((tx) =>
              callback(failStatements(tx as unknown as DrizzleClient, actionLog)),
            );
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as DrizzleClient;
    const input = request("90000000-0000-4000-8000-000000000020");

    await expect(
      callerForDatabase(staffRouter, OWNER, failingDatabase).insertUserBadge(input),
    ).rejects.toThrow("Statement failed on purpose");

    const membership = await database.query.userBadge.findFirst({
      where: and(
        eq(userBadge.userId, TARGET),
        eq(userBadge.badgeId, FIRST_BADGE),
      ),
    });
    const receipt = await database.query.actionLog.findFirst({
      where: eq(actionLog.id, `insert-user-badge:${input.requestId}`),
    });
    expect(membership).toBeUndefined();
    expect(receipt).toBeUndefined();
  });

  it("allows one of two concurrent same-badge requests and preserves sibling state", async () => {
    const database = await getTestDatabase();
    const caller = await callerFor(staffRouter, OWNER);
    const [first, second] = await Promise.all([
      caller.insertUserBadge(request("90000000-0000-4000-8000-000000000003")),
      caller.insertUserBadge(request("90000000-0000-4000-8000-000000000004")),
    ]);
    const targetMemberships = await database.query.userBadge.findMany({
      where: eq(userBadge.userId, TARGET),
    });
    const siblingMemberships = await database.query.userBadge.findMany({
      where: eq(userBadge.userId, SIBLING),
    });
    const receipts = await database.query.actionLog.findMany({
      where: eq(actionLog.relatedId, TARGET),
    });

    expect([first.success, second.success].sort()).toEqual([false, true]);
    expect(targetMemberships).toHaveLength(1);
    expect(siblingMemberships).toHaveLength(0);
    expect(receipts).toHaveLength(1);
  });

  it("keeps distinct badge assignments independent", async () => {
    const database = await getTestDatabase();
    const caller = await callerFor(staffRouter, OWNER);
    const results = await Promise.all([
      caller.insertUserBadge(request("90000000-0000-4000-8000-000000000005")),
      caller.insertUserBadge(
        request("90000000-0000-4000-8000-000000000006", {
          badgeId: SECOND_BADGE,
          expectedBadgeName: "Gap 90 Second Badge",
        }),
      ),
    ]);
    const memberships = await database.query.userBadge.findMany({
      where: eq(userBadge.userId, TARGET),
    });

    expect(results.every((result) => result.success)).toBe(true);
    expect(memberships.map((entry) => entry.badgeId).sort()).toEqual(
      [FIRST_BADGE, SECOND_BADGE].sort(),
    );
  });

  it("rejects stale, missing, banned, unauthorized, and changed-replay requests", async () => {
    const database = await getTestDatabase();
    const owner = await callerFor(staffRouter, OWNER);
    const banned = await callerFor(staffRouter, "badge-assignment-banned");
    const ordinary = await callerFor(staffRouter, "badge-assignment-ordinary");
    const selfOnly = await callerFor(staffRouter, "badge-assignment-content");

    const staleTarget = await owner.insertUserBadge(
      request("90000000-0000-4000-8000-000000000007", {
        expectedUsername: "Old Target Name",
      }),
    );
    const staleBadge = await owner.insertUserBadge(
      request("90000000-0000-4000-8000-000000000008", {
        expectedBadgeName: "Old Badge Name",
      }),
    );
    const missingTarget = await owner.insertUserBadge(
      request("90000000-0000-4000-8000-000000000009", {
        userId: "missing-target",
        expectedUsername: "Missing Target",
      }),
    );
    const missingBadge = await owner.insertUserBadge(
      request("90000000-0000-4000-8000-000000000010", {
        badgeId: "missing-badge",
        expectedBadgeName: "Missing Badge",
      }),
    );
    const bannedResult = await banned.insertUserBadge(
      request("90000000-0000-4000-8000-000000000011"),
    );
    const ordinaryResult = await ordinary.insertUserBadge(
      request("90000000-0000-4000-8000-000000000012"),
    );
    const selfOnlyOtherResult = await selfOnly.insertUserBadge(
      request("90000000-0000-4000-8000-000000000014"),
    );
    const selfOnlyOwnResult = await selfOnly.insertUserBadge(
      request("90000000-0000-4000-8000-000000000015", {
        userId: "badge-assignment-content",
        expectedUsername: "Badge Assignment Content",
      }),
    );
    const firstInput = request("90000000-0000-4000-8000-000000000013");
    await owner.insertUserBadge(firstInput);
    const changedReplay = await owner.insertUserBadge({
      ...firstInput,
      badgeId: SECOND_BADGE,
      expectedBadgeName: "Gap 90 Second Badge",
    });
    const changedBadgeOnlyReplay = await owner.insertUserBadge({
      ...firstInput,
      badgeId: SECOND_BADGE,
    });
    const changedTargetNameReplay = await owner.insertUserBadge({
      ...firstInput,
      expectedUsername: "Different Target Name",
    });
    const memberships = await database.query.userBadge.findMany({
      where: eq(userBadge.userId, TARGET),
    });

    expect(staleTarget.success).toBe(false);
    expect(staleTarget.message).toMatch(/target user changed/i);
    expect(staleBadge.success).toBe(false);
    expect(staleBadge.message).toMatch(/selected badge changed/i);
    expect(missingTarget).toEqual({ success: false, message: "Target user not found" });
    expect(missingBadge).toEqual({ success: false, message: "Badge not found" });
    expect(bannedResult.success).toBe(false);
    expect(bannedResult.message).toMatch(/banned/i);
    expect(ordinaryResult).toEqual({ success: false, message: "Not allowed for you" });
    expect(selfOnlyOtherResult).toEqual({
      success: false,
      message: "Your role can only assign badges to your own user",
    });
    expect(selfOnlyOwnResult).toMatchObject({
      success: true,
      userId: "badge-assignment-content",
      badgeId: FIRST_BADGE,
    });
    expect(changedReplay).toEqual({
      success: false,
      message: "Invalid badge assignment request ID",
    });
    expect(changedBadgeOnlyReplay).toEqual(changedReplay);
    expect(changedTargetNameReplay).toEqual(changedReplay);
    expect(memberships).toHaveLength(1);
  });

  it("declares the database-level membership invariant", async () => {
    await expect(
      indexColumns("UserBadge", "UserBadge_userId_badgeId_key"),
    ).resolves.toEqual({ columns: ["userId", "badgeId"], unique: true });
  });
});
