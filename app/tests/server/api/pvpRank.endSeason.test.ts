// @vitest-environment node

import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  actionLog,
  rankedPvpQueue,
  rankedSeason,
  rankedUserRewards,
  userData,
} from "@/drizzle/schema";
import { getRankedRank } from "@/libs/ranked_pvp";
import { pvpRankRouter } from "@/routers/pvprank";
import type { DrizzleClient } from "@/server/db";
import { rewardSchema } from "@/validators/pvpRank";
import { insertUsers } from "../../setup/factories";
import { beforeStatements, failStatements } from "../../setup/statements";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

const STAFF = "gap98-staff";
const OTHER_STAFF = "gap98-other-staff";
const PLAYER_A = "gap98-player-a";
const PLAYER_B = "gap98-player-b";
const SEASON_ID = "gap98-season";
const REVISION = new Date("2026-09-01T10:00:00.000Z");
const CREATED_AT = new Date("2026-08-01T10:00:00.000Z");

const rewards = [
  {
    division: "Unranked" as const,
    rewards: rewardSchema.parse({ reward_money: 100 }),
  },
];

const callerFor = async (userId = STAFF, database?: DrizzleClient) =>
  pvpRankRouter.createCaller({
    drizzle: database ?? (await getTestDatabase()),
    userId,
  } as never);

const seasonRow = (
  overrides: Partial<typeof rankedSeason.$inferInsert> = {},
): typeof rankedSeason.$inferInsert => ({
  id: SEASON_ID,
  name: "Gap98 Active Circuit",
  description: "Gap98 exact ending fixture",
  startDate: new Date("2026-01-01T00:00:00.000Z"),
  endDate: new Date("2030-01-01T00:00:00.000Z"),
  rewards,
  paused: false,
  ended: false,
  createdAt: CREATED_AT,
  updatedAt: REVISION,
  ...overrides,
});

const insertSeason = async (
  database: DrizzleClient,
  overrides: Partial<typeof rankedSeason.$inferInsert> = {},
) => database.insert(rankedSeason).values(seasonRow(overrides));

const endInput = (
  requestId: string,
  overrides: Partial<ReturnType<typeof endInputBase>> = {},
) => ({ ...endInputBase(requestId), ...overrides });

const endInputBase = (requestId: string) => {
  const season = seasonRow();
  return {
    id: SEASON_ID,
    requestId,
    expectedUpdatedAt: REVISION,
    expectedSeason: {
      id: SEASON_ID,
      name: season.name,
      description: season.description,
      startDate: season.startDate,
      endDate: season.endDate,
      rewards,
      paused: false,
      ended: false,
      createdAt: CREATED_AT,
      updatedAt: REVISION,
    },
  };
};

const deleteInput = (requestId: string) => ({
  ...endInputBase(requestId),
  requestId,
});

const transactionalProxy = (
  database: DrizzleClient,
  wrap: (tx: DrizzleClient) => DrizzleClient,
) =>
  new Proxy(database, {
    get(target, property, receiver) {
      if (property === "transaction") {
        return <T>(callback: (tx: DrizzleClient) => Promise<T>) =>
          target.transaction((tx) => callback(wrap(tx as unknown as DrizzleClient)));
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as DrizzleClient;

describe("ranked season ending validation", () => {
  it("requires a UUID whose target and revision match the immutable snapshot", async () => {
    await expect(
      pvpRankRouter.createCaller({} as never).endSeason(endInput("not-a-uuid")),
    ).rejects.toThrow();
    await expect(
      pvpRankRouter.createCaller({} as never).endSeason({
        ...endInput("98000000-0000-4000-8000-000000000001"),
        id: "another-season",
      }),
    ).rejects.toThrow();
  });
});

describeWithDatabase("pvpRank.endSeason", () => {
  beforeEach(async () => {
    await resetTables(
      actionLog,
      rankedPvpQueue,
      rankedUserRewards,
      rankedSeason,
      userData,
    );
    await insertUsers([
      { userId: STAFF, username: "Gap98 Staff", role: "OWNER" },
      {
        userId: OTHER_STAFF,
        username: "Gap98 Other Staff",
        role: "CONTENT",
      },
      {
        userId: PLAYER_A,
        username: "Gap98 Player A",
        rankedLp: 450,
        rankedStreak: 3,
        status: "QUEUED",
      },
      {
        userId: PLAYER_B,
        username: "Gap98 Player B",
        rankedLp: 950,
        rankedStreak: 8,
      },
      { userId: "gap98-zero", username: "Gap98 Zero", rankedLp: 0 },
      {
        userId: "gap98-banned",
        username: "Gap98 Banned",
        role: "CONTENT",
        isBanned: true,
      },
    ]);
    const database = await getTestDatabase();
    await insertSeason(database);
    await database.insert(rankedPvpQueue).values({
      id: "gap98-queue",
      userId: PLAYER_A,
      rankedLp: 450,
      queueStartTime: new Date("2026-09-11T10:00:00.000Z"),
      createdAt: new Date("2026-09-11T10:00:00.000Z"),
    });
  });

  it("atomically rewards the exact cohort, resets LP/streak, drains queue, ends the season, and audits", async () => {
    const database = await getTestDatabase();
    const input = endInput("98000000-0000-4000-8000-000000000002");
    const result = await (await callerFor()).endSeason(input);

    expect(result).toMatchObject({
      success: true,
      requestId: input.requestId,
      seasonId: SEASON_ID,
      expectedUpdatedAt: REVISION,
      expectedSeason: input.expectedSeason,
      previousSeason: input.expectedSeason,
      rewardCount: 2,
      resetUserIds: [PLAYER_A, PLAYER_B],
      resetUserCount: 2,
      clearedQueueUserIds: [PLAYER_A],
      clearedQueueCount: 1,
      ended: true,
    });
    expect(result.committedSeason?.ended).toBe(true);
    expect(result.committedSeason?.updatedAt.getTime()).toBeGreaterThan(
      REVISION.getTime(),
    );
    expect(result.committedSeason?.endDate.getTime()).toBeLessThan(
      input.expectedSeason.endDate.getTime(),
    );
    expect(result.rewards).toEqual([
      expect.objectContaining({
        userId: PLAYER_A,
        division: getRankedRank(450, [950]),
      }),
      expect.objectContaining({
        userId: PLAYER_B,
        division: getRankedRank(950, [950]),
      }),
    ]);

    expect(await database.query.rankedUserRewards.findMany()).toHaveLength(2);
    expect(
      await database.query.userData.findMany({
        where: and(
          eq(userData.rankedLp, 0),
          eq(userData.rankedStreak, 0),
        ),
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: PLAYER_A, status: "AWAKE" }),
        expect.objectContaining({ userId: PLAYER_B }),
      ]),
    );
    expect(await database.query.rankedPvpQueue.findMany()).toHaveLength(0);
    expect(
      await database.query.actionLog.findFirst({
        where: eq(actionLog.id, `end-ranked-season:${input.requestId}`),
      }),
    ).toMatchObject({
      userId: STAFF,
      tableName: "RankedSeason",
      relatedId: SEASON_ID,
      relatedMsg: "Ended ranked season",
    });
  });

  it("replays an exact lost response without duplicate rewards and rejects changed UUID reuse", async () => {
    const database = await getTestDatabase();
    const caller = await callerFor();
    const input = endInput("98000000-0000-4000-8000-000000000003");
    const first = await caller.endSeason(input);
    const replay = await caller.endSeason(input);
    const changed = await caller.endSeason({
      ...input,
      expectedSeason: { ...input.expectedSeason, name: "Changed replay" },
    });

    expect(first.success).toBe(true);
    expect(replay).toMatchObject({
      success: true,
      message: "Season was already ended",
      requestId: input.requestId,
      seasonId: SEASON_ID,
      rewardCount: 2,
    });
    expect(changed).toEqual({
      success: false,
      message: "Invalid ranked season ending request ID",
    });
    expect(await database.query.rankedUserRewards.findMany()).toHaveLength(2);
    expect(await database.query.actionLog.findMany()).toHaveLength(1);
  });

  it("rejects stale snapshots, inactive seasons, ordinary users, banned staff, and freshly demoted staff", async () => {
    const database = await getTestDatabase();
    const stale = await (await callerFor()).endSeason(
      endInput("98000000-0000-4000-8000-000000000004", {
        expectedUpdatedAt: new Date("2026-09-01T09:00:00.000Z"),
        expectedSeason: {
          ...endInputBase("unused").expectedSeason,
          updatedAt: new Date("2026-09-01T09:00:00.000Z"),
        },
      }),
    );
    const ordinary = await (await callerFor(PLAYER_A)).endSeason(
      endInput("98000000-0000-4000-8000-000000000005"),
    );
    const banned = await (await callerFor("gap98-banned")).endSeason(
      endInput("98000000-0000-4000-8000-000000000006"),
    );
    await database
      .update(userData)
      .set({ role: "USER" })
      .where(eq(userData.userId, STAFF));
    const demoted = await (await callerFor()).endSeason(
      endInput("98000000-0000-4000-8000-000000000007"),
    );

    expect(stale.message).toMatch(/changed/i);
    expect(ordinary.message).toMatch(/permission/i);
    expect(banned.message).toMatch(/banned/i);
    expect(demoted.message).toMatch(/permission/i);

    await database
      .update(userData)
      .set({ role: "OWNER" })
      .where(eq(userData.userId, STAFF));
    await database
      .update(rankedSeason)
      .set({ startDate: new Date("2031-01-01T00:00:00.000Z") })
      .where(eq(rankedSeason.id, SEASON_ID));
    const futureRow = await database.query.rankedSeason.findFirst({
      where: eq(rankedSeason.id, SEASON_ID),
    });
    expect(futureRow).toBeDefined();
    const inactive = await (await callerFor()).endSeason({
      id: SEASON_ID,
      requestId: "98000000-0000-4000-8000-000000000008",
      expectedUpdatedAt: futureRow!.updatedAt,
      expectedSeason: futureRow!,
    });
    expect(inactive.message).toMatch(/currently active/i);
    expect(await database.query.rankedUserRewards.findMany()).toHaveLength(0);
  });

  it("serializes duplicate and distinct ending calls so exactly one end writes rewards", async () => {
    const database = await getTestDatabase();
    const duplicate = endInput("98000000-0000-4000-8000-000000000010");
    const duplicateResults = await Promise.all([
      (await callerFor(STAFF)).endSeason(duplicate),
      (await callerFor(STAFF)).endSeason(duplicate),
    ]);
    expect(duplicateResults.every((result) => result.success)).toBe(true);
    expect(await database.query.rankedUserRewards.findMany()).toHaveLength(2);
    expect(await database.query.actionLog.findMany()).toHaveLength(1);

    await resetTables(actionLog, rankedPvpQueue, rankedUserRewards, rankedSeason);
    await insertSeason(database);
    await database
      .update(userData)
      .set({ rankedLp: 450, rankedStreak: 3 })
      .where(eq(userData.userId, PLAYER_A));
    await database
      .update(userData)
      .set({ rankedLp: 950, rankedStreak: 8 })
      .where(eq(userData.userId, PLAYER_B));
    const [first, second] = await Promise.all([
      (await callerFor(STAFF)).endSeason(
        endInput("98000000-0000-4000-8000-000000000011"),
      ),
      (await callerFor(OTHER_STAFF)).endSeason(
        endInput("98000000-0000-4000-8000-000000000012"),
      ),
    ]);
    expect([first.success, second.success].sort()).toEqual([false, true]);
    expect(await database.query.rankedUserRewards.findMany()).toHaveLength(2);
    expect(await database.query.actionLog.findMany()).toHaveLength(1);
  });

  it("serializes end against update so only one full-season revision commits", async () => {
    const database = await getTestDatabase();
    const [ended, updated] = await Promise.all([
      (await callerFor(STAFF)).endSeason(
        endInput("98000000-0000-4000-8000-000000000020"),
      ),
      (await callerFor(OTHER_STAFF)).updateSeason({
        id: SEASON_ID,
        name: "Gap98 Concurrent Update",
        description: seasonRow().description,
        startDate: seasonRow().startDate,
        endDate: seasonRow().endDate,
        rewards,
        paused: false,
        expectedUpdatedAt: REVISION,
        requestId: "98000000-0000-4000-8000-000000000021",
      }),
    ]);
    expect([ended.success, updated.success].sort()).toEqual([false, true]);
    expect(await database.query.actionLog.findMany()).toHaveLength(1);
  });

  it("prevents orphan rewards when end wins the season lock before delete", async () => {
    const database = await getTestDatabase();
    let deletePromise: ReturnType<Awaited<ReturnType<typeof callerFor>>["deleteSeason"]>;
    const endFirstDatabase = transactionalProxy(database, (tx) =>
      beforeStatements(tx, actionLog, [async () => {
        deletePromise = (await callerFor(OTHER_STAFF)).deleteSeason(
          deleteInput("98000000-0000-4000-8000-000000000031"),
        );
      }]),
    );
    const ended = await (await callerFor(STAFF, endFirstDatabase)).endSeason(
      endInput("98000000-0000-4000-8000-000000000030"),
    );
    const deleted = await deletePromise!;

    expect(ended.success).toBe(true);
    expect(deleted.success).toBe(false);
    expect(await database.query.rankedSeason.findMany()).toHaveLength(1);
    expect(await database.query.rankedUserRewards.findMany()).toHaveLength(2);
  });

  it("prevents orphan rewards and LP resets when delete wins the season lock before end", async () => {
    const database = await getTestDatabase();
    let endPromise: ReturnType<Awaited<ReturnType<typeof callerFor>>["endSeason"]>;
    const deleteFirstDatabase = transactionalProxy(database, (tx) =>
      beforeStatements(tx, actionLog, [async () => {
        endPromise = (await callerFor(OTHER_STAFF)).endSeason(
          endInput("98000000-0000-4000-8000-000000000041"),
        );
      }]),
    );
    const deleted = await (await callerFor(STAFF, deleteFirstDatabase)).deleteSeason(
      deleteInput("98000000-0000-4000-8000-000000000040"),
    );
    const ended = await endPromise!;

    expect(deleted.success).toBe(true);
    expect(ended.success).toBe(false);
    expect(await database.query.rankedSeason.findMany()).toHaveLength(0);
    expect(await database.query.rankedUserRewards.findMany()).toHaveLength(0);
    expect(
      await database.query.userData.findFirst({
        where: eq(userData.userId, PLAYER_A),
      }),
    ).toMatchObject({ rankedLp: 450, rankedStreak: 3 });
  });

  it("rolls back when reward, reset, season, or audit writes fail", async () => {
    const database = await getTestDatabase();
    const cases = [
      {
        label: "reward",
        table: rankedUserRewards,
        wrap: (tx: DrizzleClient) =>
          beforeStatements(tx, rankedUserRewards, [async () => {}, async () => {
            throw new Error("reward failed on purpose");
          }]),
      },
      {
        label: "reset",
        table: userData,
        wrap: (tx: DrizzleClient) =>
          beforeStatements(tx, userData, [async () => {}, async () => {}, async () => {
            throw new Error("reset failed on purpose");
          }]),
      },
      {
        label: "season",
        table: rankedSeason,
        wrap: (tx: DrizzleClient) =>
          beforeStatements(tx, rankedSeason, [async () => {}, async () => {
            throw new Error("season failed on purpose");
          }]),
      },
      {
        label: "audit",
        table: actionLog,
        wrap: (tx: DrizzleClient) => failStatements(tx, actionLog),
      },
    ];

    for (const [index, entry] of cases.entries()) {
      if (index > 0) {
        await resetTables(actionLog, rankedPvpQueue, rankedUserRewards, rankedSeason);
        await insertSeason(database);
        await database.insert(rankedPvpQueue).values({
          id: `gap98-rollback-queue-${entry.label}`,
          userId: PLAYER_A,
          rankedLp: 450,
        });
        await database
          .update(userData)
          .set({ rankedLp: 450, rankedStreak: 3, status: "QUEUED" })
          .where(eq(userData.userId, PLAYER_A));
        await database
          .update(userData)
          .set({ rankedLp: 950, rankedStreak: 8 })
          .where(eq(userData.userId, PLAYER_B));
      }
      const failingDatabase = transactionalProxy(database, entry.wrap);
      await expect(
        (await callerFor(STAFF, failingDatabase)).endSeason(
          endInput(`98000000-0000-4000-8000-00000000005${index}`),
        ),
      ).rejects.toThrow(/failed on purpose|Statement failed on purpose/);
      expect(await database.query.rankedUserRewards.findMany()).toHaveLength(0);
      expect(await database.query.rankedSeason.findFirst()).toMatchObject({
        id: SEASON_ID,
        ended: false,
        updatedAt: REVISION,
      });
      expect(await database.query.actionLog.findMany()).toHaveLength(0);
      expect(
        await database.query.userData.findFirst({
          where: eq(userData.userId, PLAYER_A),
        }),
      ).toMatchObject({ rankedLp: 450, rankedStreak: 3, status: "QUEUED" });
      expect(await database.query.rankedPvpQueue.findMany()).toHaveLength(1);
    }
  });
});
