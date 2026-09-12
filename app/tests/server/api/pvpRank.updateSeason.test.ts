// @vitest-environment node

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { actionLog, rankedSeason, userData } from "@/drizzle/schema";
import { pvpRankRouter } from "@/routers/pvprank";
import type { DrizzleClient } from "@/server/db";
import { rewardSchema, updateRankedSeasonSchema } from "@/validators/pvpRank";
import { insertUsers } from "../../setup/factories";
import { failStatements } from "../../setup/statements";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

const STAFF = "gap96-staff";
const OTHER_STAFF = "gap96-other-staff";
const SEASON_ID = "gap96-season";
const REVISION = new Date("2026-09-01T10:00:00.000Z");

const baseRewards = [
  {
    division: "Unranked",
    rewards: rewardSchema.parse({ reward_money: 100, reward_reputation: 9 }),
  },
];

const callerFor = async (userId = STAFF, database?: DrizzleClient) =>
  pvpRankRouter.createCaller({
    drizzle: database ?? (await getTestDatabase()),
    userId,
  } as never);

const insertSeason = async (
  database: DrizzleClient,
  overrides: Partial<typeof rankedSeason.$inferInsert> = {},
) => {
  await database.insert(rankedSeason).values({
    id: SEASON_ID,
    name: "Gap96 Original Season",
    description: "Gap96 original description",
    startDate: new Date("2026-08-01T00:00:00.000Z"),
    endDate: new Date("2026-08-31T00:00:00.000Z"),
    rewards: baseRewards,
    paused: false,
    ended: true,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: REVISION,
    ...overrides,
  });
};

const updateInput = (
  requestId: string,
  overrides: Partial<{
    id: string;
    name: string;
    description: string;
    startDate: Date;
    endDate: Date;
    rewards: typeof baseRewards;
    paused: boolean;
    expectedUpdatedAt: Date;
  }> = {},
) => ({
  id: SEASON_ID,
  name: "Gap96 Updated Season",
  description: "Gap96 edited description",
  startDate: new Date("2026-08-01T00:00:00.000Z"),
  endDate: new Date("2026-08-31T00:00:00.000Z"),
  rewards: baseRewards,
  paused: true,
  expectedUpdatedAt: REVISION,
  requestId,
  ...overrides,
});

describe("ranked season update validation", () => {
  it("requires a request UUID and original revision", async () => {
    expect(
      await updateRankedSeasonSchema.safeParseAsync(updateInput("not-a-uuid")),
    ).toMatchObject({ success: false });
  });
});

describeWithDatabase("pvpRank.updateSeason", () => {
  beforeEach(async () => {
    await resetTables(actionLog, rankedSeason, userData);
    await insertUsers([
      { userId: STAFF, username: "Gap96 Staff", role: "OWNER" },
      {
        userId: OTHER_STAFF,
        username: "Gap96 Other Staff",
        role: "CONTENT",
      },
      { userId: "gap96-user", username: "Gap96 User", role: "USER" },
      {
        userId: "gap96-banned",
        username: "Gap96 Banned",
        role: "CONTENT",
        isBanned: true,
      },
    ]);
    await insertSeason(await getTestDatabase());
  });

  it("atomically updates the exact revision and returns a verifiable audit receipt", async () => {
    const database = await getTestDatabase();
    const input = updateInput("96000000-0000-4000-8000-000000000001");
    const result = await (await callerFor()).updateSeason(input);

    expect(result).toMatchObject({
      success: true,
      requestId: input.requestId,
      seasonId: SEASON_ID,
      expectedUpdatedAt: REVISION,
      submittedSeason: {
        name: input.name,
        description: input.description,
        paused: true,
      },
      previousSeason: {
        id: SEASON_ID,
        name: "Gap96 Original Season",
        updatedAt: REVISION,
      },
      committedSeason: {
        id: SEASON_ID,
        name: input.name,
        paused: true,
      },
    });
    expect(result.committedSeason?.updatedAt.getTime()).toBeGreaterThan(
      REVISION.getTime(),
    );

    const stored = await database.query.rankedSeason.findFirst({
      where: eq(rankedSeason.id, SEASON_ID),
    });
    const receipt = await database.query.actionLog.findFirst({
      where: eq(actionLog.id, `update-ranked-season:${input.requestId}`),
    });
    expect(stored).toMatchObject({
      name: input.name,
      description: input.description,
      paused: true,
      ended: true,
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
    });
    expect(receipt).toMatchObject({
      userId: STAFF,
      tableName: "RankedSeason",
      relatedId: SEASON_ID,
      relatedMsg: "Updated ranked season",
    });
  });

  it("replays an identical lost response and rejects a changed payload for its UUID", async () => {
    const database = await getTestDatabase();
    const caller = await callerFor();
    const input = updateInput("96000000-0000-4000-8000-000000000002");
    const first = await caller.updateSeason(input);
    const replay = await caller.updateSeason(input);
    const changed = await caller.updateSeason({ ...input, name: "Gap96 Changed Replay" });

    expect(first.success).toBe(true);
    expect(replay).toMatchObject({
      success: true,
      message: "Season update was already saved",
      requestId: input.requestId,
      seasonId: SEASON_ID,
    });
    expect(changed).toEqual({
      success: false,
      message: "Invalid ranked season update request ID",
    });
    expect(await database.query.actionLog.findMany()).toHaveLength(1);
  });

  it("allows only one of two stale concurrent full-document edits to commit", async () => {
    const database = await getTestDatabase();
    const [first, second] = await Promise.all([
      (await callerFor(STAFF)).updateSeason(
        updateInput("96000000-0000-4000-8000-000000000003", {
          name: "Gap96 Concurrent A",
        }),
      ),
      (await callerFor(OTHER_STAFF)).updateSeason(
        updateInput("96000000-0000-4000-8000-000000000004", {
          name: "Gap96 Concurrent B",
        }),
      ),
    ]);

    expect([first.success, second.success].sort()).toEqual([false, true]);
    const stored = await database.query.rankedSeason.findFirst({
      where: eq(rankedSeason.id, SEASON_ID),
    });
    expect(["Gap96 Concurrent A", "Gap96 Concurrent B"]).toContain(stored?.name);
    expect(await database.query.actionLog.findMany()).toHaveLength(1);
  });

  it("uses fresh permissions and preserves reputation for staff without that grant", async () => {
    const database = await getTestDatabase();
    const ordinary = await (await callerFor("gap96-user")).updateSeason(
      updateInput("96000000-0000-4000-8000-000000000005"),
    );
    const banned = await (await callerFor("gap96-banned")).updateSeason(
      updateInput("96000000-0000-4000-8000-000000000006"),
    );
    expect(ordinary.message).toMatch(/permission/i);
    expect(banned.message).toMatch(/banned/i);

    await database
      .update(userData)
      .set({ role: "CODER" })
      .where(eq(userData.userId, STAFF));
    const restricted = await (await callerFor()).updateSeason(
      updateInput("96000000-0000-4000-8000-000000000007", {
        rewards: [
          {
            division: "Unranked",
            rewards: rewardSchema.parse({
              reward_money: 250,
              reward_reputation: 999,
            }),
          },
        ],
      }),
    );
    expect(restricted.success).toBe(true);
    expect(
      restricted.committedSeason?.rewards[0]?.rewards.reward_reputation,
    ).toBe(9);
  });

  it("rolls back the season update when its audit receipt insert fails", async () => {
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
      (await callerFor(STAFF, failingDatabase)).updateSeason(
        updateInput("96000000-0000-4000-8000-000000000008"),
      ),
    ).rejects.toThrow("Statement failed on purpose");
    const stored = await database.query.rankedSeason.findFirst({
      where: eq(rankedSeason.id, SEASON_ID),
    });
    expect(stored).toMatchObject({
      name: "Gap96 Original Season",
      updatedAt: REVISION,
    });
    expect(await database.query.actionLog.findMany()).toHaveLength(0);
  });

  it("grandfathers untouched legacy fields but rejects newly invalid dates and rewards", async () => {
    const database = await getTestDatabase();
    const legacyRewards = [
      {
        division: "Legacy League",
        rewards: rewardSchema.parse({ reward_money: -10 }),
      },
    ];
    await database
      .update(rankedSeason)
      .set({
        startDate: new Date("2026-08-31T00:00:00.000Z"),
        endDate: new Date("2026-08-01T00:00:00.000Z"),
        rewards: legacyRewards,
      })
      .where(eq(rankedSeason.id, SEASON_ID));

    const legacyEdit = await (await callerFor()).updateSeason(
      updateInput("96000000-0000-4000-8000-000000000009", {
        description: "Gap96 repaired only the description",
        startDate: new Date("2026-08-31T00:00:00.000Z"),
        endDate: new Date("2026-08-01T00:00:00.000Z"),
        rewards: legacyRewards,
      }),
    );
    expect(legacyEdit.success).toBe(true);

    const committedRevision = legacyEdit.committedSeason?.updatedAt;
    expect(committedRevision).toBeDefined();
    if (!committedRevision) throw new Error("Missing committed season revision");
    const invalidDates = await (await callerFor()).updateSeason(
      updateInput("96000000-0000-4000-8000-000000000010", {
        expectedUpdatedAt: committedRevision,
        startDate: new Date("2026-09-10T00:00:00.000Z"),
        endDate: new Date("2026-09-09T00:00:00.000Z"),
        rewards: legacyRewards,
      }),
    );
    expect(invalidDates.message).toMatch(/end date/i);

    const invalidRewards = await (await callerFor()).updateSeason(
      updateInput("96000000-0000-4000-8000-000000000011", {
        expectedUpdatedAt: committedRevision,
        startDate: new Date("2026-08-31T00:00:00.000Z"),
        endDate: new Date("2026-08-01T00:00:00.000Z"),
        rewards: [
          ...legacyRewards,
          {
            division: "Wood",
            rewards: rewardSchema.parse({ reward_money: -1 }),
          },
        ],
      }),
    );
    expect(invalidRewards.success).toBe(false);
  });

  it("preserves the existing active-season exclusion when editing another season", async () => {
    const database = await getTestDatabase();
    const now = Date.now();
    await database.insert(rankedSeason).values({
      id: "gap96-active-season",
      name: "Gap96 Active",
      description: "Current season",
      startDate: new Date(now - 86_400_000),
      endDate: new Date(now + 86_400_000),
      rewards: [],
      paused: false,
      ended: false,
    });
    const result = await (await callerFor()).updateSeason(
      updateInput("96000000-0000-4000-8000-000000000012", {
        endDate: new Date(now + 172_800_000),
      }),
    );
    expect(result.message).toMatch(/another season is active/i);
    expect(await database.query.actionLog.findMany()).toHaveLength(0);
  });
});
