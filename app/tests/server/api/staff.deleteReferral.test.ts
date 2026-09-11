// @vitest-environment node

import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { actionLog, userData } from "@/drizzle/schema";
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

const OWNER = "referral-removal-owner";
const RECRUITER = "referral-removal-recruiter";
const TARGET = "referral-removal-target";
const SIBLING = "referral-removal-sibling";

const request = (
  requestId: string,
  overrides: Partial<{
    userId: string;
    expectedUsername: string;
    expectedRecruiterId: string;
    expectedRecruiterUsername: string;
    expectedRecruiterCount: number;
  }> = {},
) => ({
  requestId,
  userId: TARGET,
  expectedUsername: "Gap 92 Target",
  expectedRecruiterId: RECRUITER,
  expectedRecruiterUsername: "Gap 92 Recruiter",
  expectedRecruiterCount: 2,
  ...overrides,
});

describeWithDatabase("staff.deleteReferral", () => {
  beforeEach(async () => {
    const database = await getTestDatabase();
    await resetTables(actionLog, userData);
    await insertUsers([
      { userId: OWNER, username: "Gap 92 Owner", role: "OWNER" },
      {
        userId: RECRUITER,
        username: "Gap 92 Recruiter",
        nRecruited: 2,
      },
      {
        userId: TARGET,
        username: "Gap 92 Target",
        recruiterId: RECRUITER,
      },
      {
        userId: SIBLING,
        username: "Gap 92 Sibling",
        recruiterId: RECRUITER,
      },
      {
        userId: "referral-removal-banned",
        username: "Gap 92 Banned",
        role: "OWNER",
        isBanned: true,
      },
      {
        userId: "referral-removal-user",
        username: "Gap 92 User",
        role: "USER",
      },
    ]);
  });

  it("atomically unlinks one target, decrements once, audits once, and replays", async () => {
    const database = await getTestDatabase();
    const caller = await callerFor(staffRouter, OWNER);
    const input = request("92000000-0000-4000-8000-000000000001");

    const first = await caller.deleteReferral(input);
    const replay = await caller.deleteReferral(input);
    const target = await database.query.userData.findFirst({
      where: eq(userData.userId, TARGET),
    });
    const sibling = await database.query.userData.findFirst({
      where: eq(userData.userId, SIBLING),
    });
    const recruiter = await database.query.userData.findFirst({
      where: eq(userData.userId, RECRUITER),
    });
    const receipts = await database.query.actionLog.findMany({
      where: eq(actionLog.id, `delete-referral:${input.requestId}`),
    });

    expect(first).toMatchObject({
      success: true,
      userId: TARGET,
      recruiterId: RECRUITER,
      recruiterCount: 1,
      requestId: input.requestId,
    });
    expect(replay).toEqual(first);
    expect(target?.recruiterId).toBeNull();
    expect(sibling?.recruiterId).toBe(RECRUITER);
    expect(recruiter?.nRecruited).toBe(1);
    expect(receipts).toHaveLength(1);
  });

  it("rolls back unlink and counter when its audit fails", async () => {
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

    await expect(
      callerForDatabase(staffRouter, OWNER, failingDatabase).deleteReferral(
        request("92000000-0000-4000-8000-000000000002"),
      ),
    ).rejects.toThrow("Statement failed on purpose");

    const target = await database.query.userData.findFirst({
      where: eq(userData.userId, TARGET),
    });
    const recruiter = await database.query.userData.findFirst({
      where: eq(userData.userId, RECRUITER),
    });
    expect(target?.recruiterId).toBe(RECRUITER);
    expect(recruiter?.nRecruited).toBe(2);
  });

  it("makes same-target competitors single-winner while same-request callers replay", async () => {
    const database = await getTestDatabase();
    const caller = await callerFor(staffRouter, OWNER);
    const sameInput = request("92000000-0000-4000-8000-000000000003");
    const sameRequest = await Promise.all([
      caller.deleteReferral(sameInput),
      caller.deleteReferral(sameInput),
    ]);
    expect(sameRequest.every((result) => result.success)).toBe(true);

    await database
      .update(userData)
      .set({ recruiterId: RECRUITER })
      .where(eq(userData.userId, TARGET));
    await database
      .update(userData)
      .set({ nRecruited: 2 })
      .where(eq(userData.userId, RECRUITER));
    const competing = await Promise.all([
      caller.deleteReferral(request("92000000-0000-4000-8000-000000000004")),
      caller.deleteReferral(request("92000000-0000-4000-8000-000000000005")),
    ]);
    const recruiter = await database.query.userData.findFirst({
      where: eq(userData.userId, RECRUITER),
    });
    const receipts = await database.query.actionLog.findMany({
      where: eq(actionLog.relatedId, TARGET),
    });

    expect(competing.map((result) => result.success).sort()).toEqual([false, true]);
    expect(recruiter?.nRecruited).toBe(1);
    expect(receipts).toHaveLength(2);
  });

  it("removes distinct siblings independently without taking the counter negative", async () => {
    const database = await getTestDatabase();
    const caller = await callerFor(staffRouter, OWNER);
    const results = await Promise.all([
      caller.deleteReferral(request("92000000-0000-4000-8000-000000000006")),
      caller.deleteReferral(
        request("92000000-0000-4000-8000-000000000007", {
          userId: SIBLING,
          expectedUsername: "Gap 92 Sibling",
        }),
      ),
    ]);
    const recruiter = await database.query.userData.findFirst({
      where: eq(userData.userId, RECRUITER),
    });

    expect(results.every((result) => result.success)).toBe(true);
    expect(recruiter?.nRecruited).toBe(0);
  });

  it("rejects stale identities, changed relationships, bans, permission, and changed replays", async () => {
    const database = await getTestDatabase();
    const owner = await callerFor(staffRouter, OWNER);
    const staleTarget = await owner.deleteReferral(
      request("92000000-0000-4000-8000-000000000008", {
        expectedUsername: "Old target",
      }),
    );
    const staleRecruiter = await owner.deleteReferral(
      request("92000000-0000-4000-8000-000000000009", {
        expectedRecruiterUsername: "Old recruiter",
      }),
    );
    await database
      .update(userData)
      .set({ recruiterId: OWNER })
      .where(eq(userData.userId, TARGET));
    const changedRelationship = await owner.deleteReferral(
      request("92000000-0000-4000-8000-000000000010"),
    );
    await database
      .update(userData)
      .set({ recruiterId: RECRUITER })
      .where(eq(userData.userId, TARGET));
    const banned = await (
      await callerFor(staffRouter, "referral-removal-banned")
    ).deleteReferral(request("92000000-0000-4000-8000-000000000011"));
    const ordinary = await (
      await callerFor(staffRouter, "referral-removal-user")
    ).deleteReferral(request("92000000-0000-4000-8000-000000000012"));
    const firstInput = request("92000000-0000-4000-8000-000000000013");
    await owner.deleteReferral(firstInput);
    const changedReplay = await owner.deleteReferral({
      ...firstInput,
      expectedRecruiterCount: 999,
    });

    expect(staleTarget.message).toMatch(/recruited user changed/i);
    expect(staleRecruiter.message).toMatch(/recruiter changed/i);
    expect(changedRelationship.message).toMatch(/relationship changed/i);
    expect(banned.message).toMatch(/banned/i);
    expect(ordinary.message).toMatch(/permission/i);
    expect(changedReplay).toEqual({
      success: false,
      message: "Invalid referral removal request ID",
    });
  });
});
