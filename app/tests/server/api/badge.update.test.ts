// @vitest-environment node

import { and, eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { actionLog, badge, userBadge, userData } from "@/drizzle/schema";
import { badgeRouter } from "@/routers/badge";
import type { DrizzleClient } from "@/server/db";
import type { BadgeSnapshot, ZodBadgeType } from "@/validators/badge";
import { insertUsers } from "../../setup/factories";
import { failStatements } from "../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

const OWNER = "gap103-owner";
const OTHER_EDITOR = "gap103-other-editor";
const BADGE_ID = "gap103-badge";
const OTHER_BADGE_ID = "gap103-other-badge";
const ASSIGNEE = "gap103-assignee";
const CREATED_AT = new Date("2026-09-01T10:00:00.000Z");
const REVISION = new Date("2026-09-01T11:00:00.000Z");
const ASSIGNED_AT = new Date("2026-09-01T12:00:00.000Z");

const originalBadge = (): BadgeSnapshot => ({
  id: BADGE_ID,
  name: "Gap103 Original Badge",
  image: "https://example.com/gap103-original.png",
  // badge.create intentionally makes an editable draft with an empty description.
  description: "",
  createdAt: CREATED_AT,
  updatedAt: REVISION,
});

const request = (
  requestId: string,
  overrides: Partial<{
    id: string;
    expectedUpdatedAt: Date;
    expectedBadge: BadgeSnapshot;
    data: Partial<ZodBadgeType>;
  }> = {},
) => {
  const defaultData: ZodBadgeType = {
    name: "Gap103 Updated Badge",
    image: "https://example.com/gap103-updated.png",
    description: "Gap103 updated badge description",
  };
  return {
    id: overrides.id ?? BADGE_ID,
    expectedUpdatedAt: overrides.expectedUpdatedAt ?? REVISION,
    expectedBadge: overrides.expectedBadge ?? originalBadge(),
    data: { ...defaultData, ...overrides.data },
    requestId,
  };
};

describeWithDatabase("badge.update", () => {
  beforeEach(async () => {
    const database = await getTestDatabase();
    await resetTables(actionLog, userBadge, badge, userData);
    await insertUsers([
      { userId: OWNER, username: "Gap103 Owner", role: "OWNER" },
      {
        userId: OTHER_EDITOR,
        username: "Gap103 Other Editor",
        role: "CONTENT",
      },
      { userId: ASSIGNEE, username: "Gap103 Assignee", role: "USER" },
      { userId: "gap103-user", username: "Gap103 User", role: "USER" },
      {
        userId: "gap103-banned",
        username: "Gap103 Banned",
        role: "CONTENT",
        isBanned: true,
      },
    ]);
    await database.insert(badge).values([
      originalBadge(),
      {
        id: OTHER_BADGE_ID,
        name: "Gap103 Existing Name",
        image: "https://example.com/gap103-other.png",
        description: "Gap103 other badge",
        createdAt: CREATED_AT,
        updatedAt: REVISION,
      },
    ]);
    await database.insert(userBadge).values({
      userId: ASSIGNEE,
      badgeId: BADGE_ID,
      createdAt: ASSIGNED_AT,
    });
  });

  it("atomically updates the exact revision and preserves badge assignments", async () => {
    const database = await getTestDatabase();
    const input = request("10300000-0000-4000-8000-000000000001");
    const result = await (await callerFor(badgeRouter, OWNER)).update(input);

    expect(result).toMatchObject({
      success: true,
      requestId: input.requestId,
      actorUserId: OWNER,
      badgeId: BADGE_ID,
      expectedUpdatedAt: REVISION,
      submittedBadge: input.data,
      previousBadge: originalBadge(),
      committedBadge: { id: BADGE_ID, ...input.data, createdAt: CREATED_AT },
    });
    expect(result.committedBadge?.updatedAt.getTime()).toBeGreaterThan(
      REVISION.getTime(),
    );
    expect(await database.query.badge.findFirst({
      where: eq(badge.id, BADGE_ID),
    })).toMatchObject(result.committedBadge ?? {});
    expect(await database.query.userBadge.findFirst({
      where: and(
        eq(userBadge.userId, ASSIGNEE),
        eq(userBadge.badgeId, BADGE_ID),
      ),
    })).toEqual({ userId: ASSIGNEE, badgeId: BADGE_ID, createdAt: ASSIGNED_AT });
    expect(await database.query.actionLog.findMany()).toHaveLength(2);
  });

  it("replays an identical lost response but rejects changed payloads and changed current state", async () => {
    const database = await getTestDatabase();
    const caller = await callerFor(badgeRouter, OWNER);
    const input = request("10300000-0000-4000-8000-000000000002");
    const first = await caller.update(input);
    const replay = await caller.update(input);
    const changedPayload = await caller.update({
      ...input,
      data: { ...input.data, description: "Gap103 changed retry" },
    });

    expect(first.success).toBe(true);
    expect(replay).toMatchObject({
      success: true,
      message: "Badge update was already saved",
      requestId: input.requestId,
    });
    expect(changedPayload).toEqual({
      success: false,
      message: "Invalid badge update request ID",
    });

    await database
      .update(badge)
      .set({ description: "Gap103 later legitimate edit" })
      .where(eq(badge.id, BADGE_ID));
    expect(await caller.update(input)).toEqual({
      success: false,
      message: "Invalid badge update request ID",
    });
    expect(await database.query.actionLog.findMany()).toHaveLength(2);
  });

  it("allows only one of two concurrent stale full-document edits to win", async () => {
    const database = await getTestDatabase();
    const [first, second] = await Promise.all([
      (await callerFor(badgeRouter, OWNER)).update(
        request("10300000-0000-4000-8000-000000000003", {
          data: { name: "Gap103 Concurrent A" },
        }),
      ),
      (await callerFor(badgeRouter, OTHER_EDITOR)).update(
        request("10300000-0000-4000-8000-000000000004", {
          data: { name: "Gap103 Concurrent B" },
        }),
      ),
    ]);

    expect([first.success, second.success].sort()).toEqual([false, true]);
    expect(["Gap103 Concurrent A", "Gap103 Concurrent B"]).toContain(
      (await database.query.badge.findFirst({ where: eq(badge.id, BADGE_ID) }))
        ?.name,
    );
    expect(await database.query.actionLog.findMany()).toHaveLength(2);
  });

  it("rejects stale snapshots, missing badges, duplicate names, unauthorized and banned editors", async () => {
    const owner = await callerFor(badgeRouter, OWNER);
    const stale = await owner.update(
      request("10300000-0000-4000-8000-000000000005", {
        expectedBadge: { ...originalBadge(), description: "Gap103 stale copy" },
      }),
    );
    const missingSnapshot = { ...originalBadge(), id: "gap103-missing" };
    const missing = await owner.update(
      request("10300000-0000-4000-8000-000000000006", {
        id: "gap103-missing",
        expectedBadge: missingSnapshot,
      }),
    );
    const duplicate = await owner.update(
      request("10300000-0000-4000-8000-000000000007", {
        data: { name: "Gap103 Existing Name" },
      }),
    );
    const unauthorized = await (
      await callerFor(badgeRouter, "gap103-user")
    ).update(request("10300000-0000-4000-8000-000000000008"));
    const banned = await (
      await callerFor(badgeRouter, "gap103-banned")
    ).update(request("10300000-0000-4000-8000-000000000009"));

    expect(stale.message).toMatch(/changed/i);
    expect(missing.message).toMatch(/not found/i);
    expect(duplicate.message).toMatch(/already exists/i);
    expect(unauthorized.message).toMatch(/not allowed/i);
    expect(banned.message).toMatch(/banned/i);
  });

  it("rolls back the badge write when its audit insert fails", async () => {
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
      callerForDatabase(badgeRouter, OWNER, failingDatabase).update(
        request("10300000-0000-4000-8000-000000000010"),
      ),
    ).rejects.toThrow("Statement failed on purpose");
    expect(await database.query.badge.findFirst({
      where: eq(badge.id, BADGE_ID),
    })).toMatchObject(originalBadge());
    expect(await database.query.actionLog.findMany()).toHaveLength(0);
    expect(await database.query.userBadge.findMany()).toHaveLength(1);
  });
});
