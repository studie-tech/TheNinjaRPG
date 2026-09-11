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
  resetTables,
} from "../../setup/testDatabase";

const OWNER = "badge-removal-owner";
const TARGET = "badge-removal-target";
const FIRST_BADGE = "badge-removal-first";
const SECOND_BADGE = "badge-removal-second";
const ASSIGNED_AT = new Date("2026-09-11T10:00:00.123Z");
const SECOND_ASSIGNED_AT = new Date("2026-09-11T10:00:01.456Z");

const request = (
  requestId: string,
  overrides: Partial<{
    userId: string;
    expectedUsername: string;
    badgeId: string;
    expectedBadgeName: string;
    expectedAssignmentCreatedAt: Date;
  }> = {},
) => ({
  requestId,
  userId: TARGET,
  expectedUsername: "Badge Removal Target",
  badgeId: FIRST_BADGE,
  expectedBadgeName: "Gap 91 First Badge",
  expectedAssignmentCreatedAt: ASSIGNED_AT,
  ...overrides,
});

describeWithDatabase("staff.removeUserBadge", () => {
  beforeEach(async () => {
    const database = await getTestDatabase();
    await resetTables(actionLog, userBadge, badge, userData);
    await insertUsers([
      { userId: OWNER, username: "Badge Removal Owner", role: "OWNER" },
      { userId: TARGET, username: "Badge Removal Target", role: "USER" },
      {
        userId: "badge-removal-banned",
        username: "Badge Removal Banned",
        role: "OWNER",
        isBanned: true,
      },
      {
        userId: "badge-removal-ordinary",
        username: "Badge Removal Ordinary",
        role: "USER",
      },
      {
        userId: "badge-removal-content",
        username: "Badge Removal Content",
        role: "CONTENT",
      },
    ]);
    await database.insert(badge).values([
      {
        id: FIRST_BADGE,
        name: "Gap 91 First Badge",
        image: "/badges/gap-91-first.png",
        description: "First badge fixture",
      },
      {
        id: SECOND_BADGE,
        name: "Gap 91 Second Badge",
        image: "/badges/gap-91-second.png",
        description: "Second badge fixture",
      },
    ]);
    await database.insert(userBadge).values([
      { userId: TARGET, badgeId: FIRST_BADGE, createdAt: ASSIGNED_AT },
      { userId: TARGET, badgeId: SECOND_BADGE, createdAt: SECOND_ASSIGNED_AT },
      {
        userId: "badge-removal-content",
        badgeId: FIRST_BADGE,
        createdAt: ASSIGNED_AT,
      },
    ]);
  });

  it("atomically removes the exact assignment and replays one receipt idempotently", async () => {
    const database = await getTestDatabase();
    const caller = await callerFor(staffRouter, OWNER);
    const input = request("91000000-0000-4000-8000-000000000001");

    const first = await caller.removeUserBadge(input);
    const replay = await caller.removeUserBadge(input);
    const removed = await database.query.userBadge.findFirst({
      where: and(
        eq(userBadge.userId, TARGET),
        eq(userBadge.badgeId, FIRST_BADGE),
      ),
    });
    const sibling = await database.query.userBadge.findFirst({
      where: and(
        eq(userBadge.userId, TARGET),
        eq(userBadge.badgeId, SECOND_BADGE),
      ),
    });
    const receipts = await database.query.actionLog.findMany({
      where: eq(actionLog.id, `remove-user-badge:${input.requestId}`),
    });

    expect(first).toMatchObject({
      success: true,
      userId: TARGET,
      badgeId: FIRST_BADGE,
      requestId: input.requestId,
    });
    expect(replay).toEqual(first);
    expect(removed).toBeUndefined();
    expect(sibling).toBeDefined();
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      userId: OWNER,
      relatedId: TARGET,
      relatedMsg: "Remove badge: Gap 91 First Badge",
    });
  });

  it("does not treat an unrelated pre-removed badge as this request's success", async () => {
    const database = await getTestDatabase();
    await database
      .delete(userBadge)
      .where(
        and(eq(userBadge.userId, TARGET), eq(userBadge.badgeId, FIRST_BADGE)),
      );
    const input = request("91000000-0000-4000-8000-000000000002");

    const result = await (
      await callerFor(staffRouter, OWNER)
    ).removeUserBadge(input);
    const receipt = await database.query.actionLog.findFirst({
      where: eq(actionLog.id, `remove-user-badge:${input.requestId}`),
    });

    expect(result).toEqual({
      success: false,
      message: "Gap 91 First Badge is no longer assigned to this user",
    });
    expect(receipt).toBeUndefined();
  });

  it("rolls the deletion back if the audit cannot be written", async () => {
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
    const input = request("91000000-0000-4000-8000-000000000003");

    await expect(
      callerForDatabase(staffRouter, OWNER, failingDatabase).removeUserBadge(input),
    ).rejects.toThrow("Statement failed on purpose");

    const assignment = await database.query.userBadge.findFirst({
      where: and(
        eq(userBadge.userId, TARGET),
        eq(userBadge.badgeId, FIRST_BADGE),
      ),
    });
    const receipt = await database.query.actionLog.findFirst({
      where: eq(actionLog.id, `remove-user-badge:${input.requestId}`),
    });
    expect(assignment).toBeDefined();
    expect(receipt).toBeUndefined();
  });

  it("makes concurrent same-badge claims single-winner while same-request replay succeeds", async () => {
    const database = await getTestDatabase();
    const caller = await callerFor(staffRouter, OWNER);
    const sameInput = request("91000000-0000-4000-8000-000000000004");
    const sameRequest = await Promise.all([
      caller.removeUserBadge(sameInput),
      caller.removeUserBadge(sameInput),
    ]);
    expect(sameRequest.every((result) => result.success)).toBe(true);

    await database.insert(userBadge).values({
      userId: TARGET,
      badgeId: FIRST_BADGE,
      createdAt: ASSIGNED_AT,
    });
    const competing = await Promise.all([
      caller.removeUserBadge(request("91000000-0000-4000-8000-000000000005")),
      caller.removeUserBadge(request("91000000-0000-4000-8000-000000000006")),
    ]);
    const receipts = await database.query.actionLog.findMany({
      where: eq(actionLog.relatedId, TARGET),
    });

    expect(competing.map((result) => result.success).sort()).toEqual([false, true]);
    expect(receipts).toHaveLength(2);
  });

  it("removes distinct badge assignments independently", async () => {
    const database = await getTestDatabase();
    const caller = await callerFor(staffRouter, OWNER);

    const results = await Promise.all([
      caller.removeUserBadge(request("91000000-0000-4000-8000-000000000007")),
      caller.removeUserBadge(
        request("91000000-0000-4000-8000-000000000008", {
          badgeId: SECOND_BADGE,
          expectedBadgeName: "Gap 91 Second Badge",
          expectedAssignmentCreatedAt: SECOND_ASSIGNED_AT,
        }),
      ),
    ]);
    const assignments = await database.query.userBadge.findMany({
      where: eq(userBadge.userId, TARGET),
    });

    expect(results.every((result) => result.success)).toBe(true);
    expect(assignments).toHaveLength(0);
  });

  it("rejects stale assignment, target, badge, authorization, and changed replays", async () => {
    const database = await getTestDatabase();
    const owner = await callerFor(staffRouter, OWNER);
    const banned = await callerFor(staffRouter, "badge-removal-banned");
    const ordinary = await callerFor(staffRouter, "badge-removal-ordinary");
    const selfOnly = await callerFor(staffRouter, "badge-removal-content");

    const staleAssignment = await owner.removeUserBadge(
      request("91000000-0000-4000-8000-000000000009", {
        expectedAssignmentCreatedAt: new Date("2026-09-11T09:59:59.000Z"),
      }),
    );
    const staleTarget = await owner.removeUserBadge(
      request("91000000-0000-4000-8000-000000000010", {
        expectedUsername: "Old Target Name",
      }),
    );
    const staleBadge = await owner.removeUserBadge(
      request("91000000-0000-4000-8000-000000000011", {
        expectedBadgeName: "Old Badge Name",
      }),
    );
    const bannedResult = await banned.removeUserBadge(
      request("91000000-0000-4000-8000-000000000012"),
    );
    const ordinaryResult = await ordinary.removeUserBadge(
      request("91000000-0000-4000-8000-000000000013"),
    );
    const selfOnlyOther = await selfOnly.removeUserBadge(
      request("91000000-0000-4000-8000-000000000014"),
    );
    const selfOnlyOwn = await selfOnly.removeUserBadge(
      request("91000000-0000-4000-8000-000000000015", {
        userId: "badge-removal-content",
        expectedUsername: "Badge Removal Content",
      }),
    );
    const firstInput = request("91000000-0000-4000-8000-000000000016");
    await owner.removeUserBadge(firstInput);
    const changedReplay = await owner.removeUserBadge({
      ...firstInput,
      badgeId: SECOND_BADGE,
      expectedBadgeName: "Gap 91 Second Badge",
      expectedAssignmentCreatedAt: SECOND_ASSIGNED_AT,
    });
    const remaining = await database.query.userBadge.findMany({
      where: eq(userBadge.userId, TARGET),
    });

    expect(staleAssignment.message).toMatch(/assignment changed/i);
    expect(staleTarget.message).toMatch(/target user changed/i);
    expect(staleBadge.message).toMatch(/selected badge changed/i);
    expect(bannedResult.message).toMatch(/banned/i);
    expect(ordinaryResult).toEqual({ success: false, message: "Not allowed for you" });
    expect(selfOnlyOther.message).toMatch(/only remove badges from your own user/i);
    expect(selfOnlyOwn.success).toBe(true);
    expect(changedReplay).toEqual({
      success: false,
      message: "Invalid badge removal request ID",
    });
    expect(remaining.map((entry) => entry.badgeId)).toEqual([SECOND_BADGE]);
  });
});
