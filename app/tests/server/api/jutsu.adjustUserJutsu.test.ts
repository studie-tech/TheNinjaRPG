// @vitest-environment node

import { eq, inArray } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { actionLog, jutsu, userData, userJutsu } from "@/drizzle/schema";
import { jutsuRouter } from "@/routers/jutsu";
import { insertUsers } from "../../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

const OWNER = "adjust-jutsu-owner";
const TARGET = "adjust-jutsu-target";
const AI_TARGET = "adjust-jutsu-ai";

const callerForUser = async (userId: string) =>
  jutsuRouter.createCaller({ drizzle: await getTestDatabase(), userId } as never);

const request = (
  requestId: string,
  overrides: Partial<{
    userId: string;
    expectedUsername: string;
    userJutsuId: string;
    jutsuId: string;
    expectedJutsuName: string;
    expectedLevel: number;
    level: number;
    expectedReskinId: string | null;
    expectedReskinName: string | null;
    reskinId: string | null;
    reskinName: string | null;
  }> = {},
) => ({
  userId: TARGET,
  expectedUsername: "Gap88 Target",
  userJutsuId: "gap88-owned-primary",
  jutsuId: "gap88-jutsu-primary",
  expectedJutsuName: "Gap88 Wind Needle",
  expectedLevel: 5,
  level: 8,
  expectedReskinId: null,
  expectedReskinName: null,
  reskinId: null,
  reskinName: null,
  requestId,
  ...overrides,
});

describeWithDatabase("jutsu.adjustUserJutsu", () => {
  beforeEach(async () => {
    const database = await getTestDatabase();
    await resetTables(actionLog, userJutsu, jutsu, userData);
    await insertUsers([
      {
        userId: OWNER,
        username: "Gap88 Owner",
        role: "OWNER",
      },
      {
        userId: TARGET,
        username: "Gap88 Target",
      },
      {
        userId: AI_TARGET,
        username: "Gap88 AI Target",
        isAi: true,
      },
      {
        userId: "adjust-jutsu-banned",
        username: "Gap88 Banned",
        role: "OWNER",
        isBanned: true,
      },
      {
        userId: "adjust-jutsu-content",
        username: "Gap88 Content",
        role: "CONTENT",
      },
      {
        userId: "adjust-jutsu-user",
        username: "Gap88 User",
        role: "USER",
      },
    ]);
    await database.insert(jutsu).values([
      {
        id: "gap88-jutsu-primary",
        name: "Gap88 Wind Needle",
        description: "Primary adjustment fixture",
        effects: [],
        target: "OPPONENT",
        range: 1,
        requiredRank: "STUDENT",
        jutsuType: "NORMAL",
        image: "/gap88-primary.png",
        battleDescription: "uses a wind needle",
      },
      {
        id: "gap88-jutsu-sibling",
        name: "Gap88 Stone Guard",
        description: "Sibling adjustment fixture",
        effects: [],
        target: "SELF",
        range: 0,
        requiredRank: "STUDENT",
        jutsuType: "NORMAL",
        image: "/gap88-sibling.png",
        battleDescription: "uses stone guard",
      },
    ]);
    await database.insert(userJutsu).values([
      {
        id: "gap88-owned-primary",
        userId: TARGET,
        jutsuId: "gap88-jutsu-primary",
        level: 5,
        equipped: true,
        experience: 123,
      },
      {
        id: "gap88-owned-sibling",
        userId: TARGET,
        jutsuId: "gap88-jutsu-sibling",
        level: 4,
      },
      {
        id: "gap88-owned-ai",
        userId: AI_TARGET,
        jutsuId: "gap88-jutsu-primary",
        level: 3,
      },
    ]);
  });

  it("sets the exact owned row atomically, replays once, and leaves its sibling untouched", async () => {
    const database = await getTestDatabase();
    const caller = await callerForUser(OWNER);
    const firstInput = request("88000000-0000-4000-8000-000000000001");

    const first = await caller.adjustUserJutsu(firstInput);
    const replay = await caller.adjustUserJutsu(firstInput);
    const rows = await database
      .select()
      .from(userJutsu)
      .where(
        inArray(userJutsu.id, ["gap88-owned-primary", "gap88-owned-sibling"]),
      );
    const receipts = await database
      .select()
      .from(actionLog)
      .where(eq(actionLog.id, `adjust-jutsu:${firstInput.requestId}`));

    expect(first).toMatchObject({
      success: true,
      requestId: firstInput.requestId,
      adjustment: {
        userId: TARGET,
        userJutsuId: "gap88-owned-primary",
        previousLevel: 5,
        newLevel: 8,
      },
    });
    expect(replay).toMatchObject({ success: true, requestId: firstInput.requestId });
    expect(rows.find((row) => row.id === "gap88-owned-primary")).toMatchObject({
      level: 8,
      experience: 123,
      equipped: true,
    });
    expect(rows.find((row) => row.id === "gap88-owned-sibling")).toMatchObject({
      level: 4,
    });
    expect(receipts).toHaveLength(1);
  });

  it("allows fresh intentional changes and a late replay never reverts them", async () => {
    const database = await getTestDatabase();
    const caller = await callerForUser(OWNER);
    const firstInput = request("88000000-0000-4000-8000-000000000002", {
      level: 7,
    });
    const secondInput = request("88000000-0000-4000-8000-000000000003", {
      expectedLevel: 7,
      level: 10,
    });

    expect((await caller.adjustUserJutsu(firstInput)).success).toBe(true);
    expect((await caller.adjustUserJutsu(secondInput)).success).toBe(true);
    expect((await caller.adjustUserJutsu(firstInput)).success).toBe(true);

    const owned = await database.query.userJutsu.findFirst({
      where: eq(userJutsu.id, "gap88-owned-primary"),
    });
    const receipts = await database
      .select()
      .from(actionLog)
      .where(inArray(actionLog.id, [
        `adjust-jutsu:${firstInput.requestId}`,
        `adjust-jutsu:${secondInput.requestId}`,
      ]));
    expect(owned?.level).toBe(10);
    expect(receipts).toHaveLength(2);
  });

  it("serializes competing snapshots so one stale absolute write is rejected", async () => {
    const database = await getTestDatabase();
    const caller = await callerForUser(OWNER);
    const [first, second] = await Promise.all([
      caller.adjustUserJutsu(
        request("88000000-0000-4000-8000-000000000004", { level: 6 }),
      ),
      caller.adjustUserJutsu(
        request("88000000-0000-4000-8000-000000000005", { level: 9 }),
      ),
    ]);
    const owned = await database.query.userJutsu.findFirst({
      where: eq(userJutsu.id, "gap88-owned-primary"),
    });
    const receipts = await database
      .select()
      .from(actionLog)
      .where(eq(actionLog.relatedId, TARGET));

    expect([first.success, second.success].filter(Boolean)).toHaveLength(1);
    expect([6, 9]).toContain(owned?.level);
    expect(receipts).toHaveLength(1);
  });

  it("rejects stale identities/state, no-ops, reused IDs, and invalid bounds", async () => {
    const database = await getTestDatabase();
    const caller = await callerForUser(OWNER);

    expect(
      await caller.adjustUserJutsu(
        request("88000000-0000-4000-8000-000000000006", {
          expectedUsername: "Old Target Name",
        }),
      ),
    ).toMatchObject({ success: false });
    expect(
      await caller.adjustUserJutsu(
        request("88000000-0000-4000-8000-000000000007", { expectedLevel: 4 }),
      ),
    ).toMatchObject({ success: false });
    expect(
      await caller.adjustUserJutsu(
        request("88000000-0000-4000-8000-000000000008", { level: 5 }),
      ),
    ).toMatchObject({ success: false, message: "No jutsu changes to apply" });

    const committed = request("88000000-0000-4000-8000-000000000009", {
      level: 6,
    });
    expect((await caller.adjustUserJutsu(committed)).success).toBe(true);
    expect(
      await caller.adjustUserJutsu({ ...committed, level: 7 }),
    ).toMatchObject({
      success: false,
      message: "Invalid jutsu adjustment request ID",
    });
    await expect(
      caller.adjustUserJutsu(
        request("88000000-0000-4000-8000-000000000010", { level: 26 }),
      ),
    ).rejects.toThrow();

    const owned = await database.query.userJutsu.findFirst({
      where: eq(userJutsu.id, "gap88-owned-primary"),
    });
    expect(owned?.level).toBe(6);
  });

  it("enforces actor permissions and self-only scope while supporting AI targets", async () => {
    const banned = await callerForUser("adjust-jutsu-banned");
    const content = await callerForUser("adjust-jutsu-content");
    const user = await callerForUser("adjust-jutsu-user");
    const owner = await callerForUser(OWNER);

    expect(
      await banned.adjustUserJutsu(
        request("88000000-0000-4000-8000-000000000011"),
      ),
    ).toMatchObject({ success: false, message: expect.stringContaining("banned") });
    expect(
      await content.adjustUserJutsu(
        request("88000000-0000-4000-8000-000000000012"),
      ),
    ).toMatchObject({ success: false, message: expect.stringContaining("own") });
    expect(
      await user.adjustUserJutsu(
        request("88000000-0000-4000-8000-000000000013"),
      ),
    ).toMatchObject({ success: false, message: expect.stringContaining("allowed") });
    expect(
      await owner.adjustUserJutsu(
        request("88000000-0000-4000-8000-000000000014", {
          userId: AI_TARGET,
          expectedUsername: "Gap88 AI Target",
          userJutsuId: "gap88-owned-ai",
          expectedLevel: 3,
          level: 4,
        }),
      ),
    ).toMatchObject({ success: true });
  });
});
