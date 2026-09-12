// @vitest-environment node

import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  actionLog,
  rankedSeason,
  rankedUserRewards,
  userData,
} from "@/drizzle/schema";
import { pvpRankRouter } from "@/routers/pvprank";
import type { DrizzleClient } from "@/server/db";
import { deleteRankedSeasonSchema, rewardSchema } from "@/validators/pvpRank";
import { insertUsers } from "../../setup/factories";
import { failStatements } from "../../setup/statements";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

const STAFF = "gap97-staff";
const OTHER_STAFF = "gap97-other-staff";
const SEASON_ID = "gap97-season";
const REVISION = new Date("2026-09-01T10:00:00.000Z");
const CREATED_AT = new Date("2026-07-01T10:00:00.000Z");

const rewards = [
  {
    division: "Unranked" as const,
    rewards: rewardSchema.parse({ reward_money: 100 }),
  },
];

type SeasonFixture = {
  id: string;
  name: string;
  description: string;
  startDate: Date;
  endDate: Date;
  rewards: typeof rewards;
  paused: boolean;
  ended: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const callerFor = async (userId = STAFF, database?: DrizzleClient) =>
  pvpRankRouter.createCaller({
    drizzle: database ?? (await getTestDatabase()),
    userId,
  } as never);

const seasonRow = (
  overrides: Partial<SeasonFixture> = {},
): SeasonFixture => ({
  id: SEASON_ID,
  name: "Gap97 Completed Circuit",
  description: "Gap97 exact destructive fixture",
  startDate: new Date("2026-08-01T00:00:00.000Z"),
  endDate: new Date("2026-08-31T00:00:00.000Z"),
  rewards,
  paused: false,
  ended: true,
  createdAt: CREATED_AT,
  updatedAt: REVISION,
  ...overrides,
});

const insertSeason = async (
  database: DrizzleClient,
  overrides: Partial<SeasonFixture> = {},
) => database.insert(rankedSeason).values(seasonRow(overrides));

const deleteInput = (
  requestId: string,
  overrides: Partial<ReturnType<typeof deleteInputBase>> = {},
) => ({ ...deleteInputBase(requestId), ...overrides });

const deleteInputBase = (requestId: string) => {
  const season = seasonRow();
  return {
    id: season.id,
    requestId,
    expectedUpdatedAt: season.updatedAt,
    expectedSeason: {
      id: season.id,
      name: season.name,
      description: season.description,
      startDate: season.startDate,
      endDate: season.endDate,
      rewards: season.rewards,
      paused: season.paused ?? false,
      ended: season.ended ?? false,
      createdAt: season.createdAt,
      updatedAt: season.updatedAt,
    },
  };
};

describe("ranked season deletion validation", () => {
  it("requires a UUID whose target and revision match the immutable snapshot", async () => {
    expect(
      await deleteRankedSeasonSchema.safeParseAsync(deleteInput("not-a-uuid")),
    ).toMatchObject({ success: false });
    expect(
      await deleteRankedSeasonSchema.safeParseAsync({
        ...deleteInput("97000000-0000-4000-8000-000000000001"),
        id: "another-season",
      }),
    ).toMatchObject({ success: false });
  });
});

describeWithDatabase("pvpRank.deleteSeason", () => {
  beforeEach(async () => {
    await resetTables(actionLog, rankedUserRewards, rankedSeason, userData);
    await insertUsers([
      { userId: STAFF, username: "Gap97 Staff", role: "OWNER" },
      {
        userId: OTHER_STAFF,
        username: "Gap97 Other Staff",
        role: "CONTENT",
      },
      { userId: "gap97-user", username: "Gap97 User", role: "USER" },
      {
        userId: "gap97-banned",
        username: "Gap97 Banned",
        role: "CONTENT",
        isBanned: true,
      },
    ]);
    await insertSeason(await getTestDatabase());
  });

  it("atomically deletes the exact season and unclaimed rewards while preserving claimed history", async () => {
    const database = await getTestDatabase();
    await database.insert(rankedUserRewards).values([
      {
        id: "gap97-unclaimed",
        userId: "gap97-user",
        seasonId: SEASON_ID,
        division: "Unranked",
        claimed: false,
      },
      {
        id: "gap97-claimed",
        userId: "gap97-user",
        seasonId: SEASON_ID,
        division: "Unranked",
        claimed: true,
        claimedAt: new Date("2026-09-01T11:00:00.000Z"),
      },
    ]);
    const input = deleteInput("97000000-0000-4000-8000-000000000002");
    const result = await (await callerFor()).deleteSeason(input);

    expect(result).toMatchObject({
      success: true,
      requestId: input.requestId,
      seasonId: SEASON_ID,
      expectedUpdatedAt: REVISION,
      expectedSeason: input.expectedSeason,
      deletedSeason: input.expectedSeason,
      deletedUnclaimedRewardIds: ["gap97-unclaimed"],
      deletedUnclaimedRewardCount: 1,
      deleted: true,
    });
    expect(
      await database.query.rankedSeason.findFirst({
        where: eq(rankedSeason.id, SEASON_ID),
      }),
    ).toBeUndefined();
    expect(await database.query.rankedUserRewards.findMany()).toMatchObject([
      { id: "gap97-claimed", claimed: true, seasonId: SEASON_ID },
    ]);
    expect(
      await database.query.actionLog.findFirst({
        where: eq(actionLog.id, `delete-ranked-season:${input.requestId}`),
      }),
    ).toMatchObject({
      userId: STAFF,
      tableName: "RankedSeason",
      relatedId: SEASON_ID,
      relatedMsg: "Deleted ranked season",
    });
  });

  it("replays an identical lost response and rejects changed reuse of its UUID", async () => {
    const database = await getTestDatabase();
    const caller = await callerFor();
    const input = deleteInput("97000000-0000-4000-8000-000000000003");
    const first = await caller.deleteSeason(input);
    const replay = await caller.deleteSeason(input);
    const changed = await caller.deleteSeason({
      ...input,
      expectedSeason: { ...input.expectedSeason, name: "Changed replay" },
    });

    expect(first.success).toBe(true);
    expect(replay).toMatchObject({
      success: true,
      message: "Season was already deleted",
      requestId: input.requestId,
      seasonId: SEASON_ID,
      deleted: true,
    });
    expect(changed).toEqual({
      success: false,
      message: "Invalid ranked season deletion request ID",
    });
    expect(await database.query.actionLog.findMany()).toHaveLength(1);
  });

  it("rejects stale revisions and same-revision snapshot drift without cleanup", async () => {
    const database = await getTestDatabase();
    await database.insert(rankedUserRewards).values({
      id: "gap97-stale-reward",
      userId: "gap97-user",
      seasonId: SEASON_ID,
      division: "Unranked",
    });
    const staleRevision = await (await callerFor()).deleteSeason(
      deleteInput("97000000-0000-4000-8000-000000000004", {
        expectedUpdatedAt: new Date("2026-09-01T09:00:00.000Z"),
        expectedSeason: {
          ...deleteInputBase("unused").expectedSeason,
          updatedAt: new Date("2026-09-01T09:00:00.000Z"),
        },
      }),
    );
    const staleSnapshot = await (await callerFor()).deleteSeason(
      deleteInput("97000000-0000-4000-8000-000000000005", {
        expectedSeason: {
          ...deleteInputBase("unused").expectedSeason,
          description: "Stale same-revision description",
        },
      }),
    );

    expect(staleRevision.message).toMatch(/changed/i);
    expect(staleSnapshot.message).toMatch(/changed/i);
    expect(await database.query.rankedSeason.findMany()).toHaveLength(1);
    expect(await database.query.rankedUserRewards.findMany()).toHaveLength(1);
    expect(await database.query.actionLog.findMany()).toHaveLength(0);
  });

  it("preserves deletion for active, future, and completed season snapshots", async () => {
    const database = await getTestDatabase();
    const cases = [
      {
        label: "active",
        startDate: new Date("2026-09-01T00:00:00.000Z"),
        endDate: new Date("2030-10-01T00:00:00.000Z"),
        ended: false,
      },
      {
        label: "future",
        startDate: new Date("2031-01-01T00:00:00.000Z"),
        endDate: new Date("2031-02-01T00:00:00.000Z"),
        ended: false,
      },
      {
        label: "completed",
        startDate: new Date("2026-01-01T00:00:00.000Z"),
        endDate: new Date("2026-02-01T00:00:00.000Z"),
        ended: true,
      },
    ];

    for (const [index, entry] of cases.entries()) {
      const id = `gap97-${entry.label}`;
      const revision = new Date(REVISION.getTime() + index + 1);
      const row = seasonRow({
        id,
        name: `Gap97 ${entry.label}`,
        startDate: entry.startDate,
        endDate: entry.endDate,
        ended: entry.ended,
        updatedAt: revision,
      });
      await database.insert(rankedSeason).values(row);
      const input = {
        id,
        requestId: `97000000-0000-4000-8000-00000000001${index}`,
        expectedUpdatedAt: revision,
        expectedSeason: {
          id,
          name: row.name,
          description: row.description,
          startDate: row.startDate,
          endDate: row.endDate,
          rewards: row.rewards,
          paused: row.paused ?? false,
          ended: row.ended ?? false,
          createdAt: row.createdAt,
          updatedAt: revision,
        },
      };
      expect((await (await callerFor()).deleteSeason(input)).success).toBe(true);
    }
  });

  it("allows only one competing delete and serializes a delete against a stale update", async () => {
    const database = await getTestDatabase();
    const firstInput = deleteInput("97000000-0000-4000-8000-000000000020");
    const [first, second] = await Promise.all([
      (await callerFor(STAFF)).deleteSeason(firstInput),
      (await callerFor(OTHER_STAFF)).deleteSeason(
        deleteInput("97000000-0000-4000-8000-000000000021"),
      ),
    ]);
    expect([first.success, second.success].sort()).toEqual([false, true]);
    expect(await database.query.actionLog.findMany()).toHaveLength(1);

    await resetTables(actionLog, rankedUserRewards, rankedSeason);
    await insertSeason(database);
    const deleteRequest = deleteInput("97000000-0000-4000-8000-000000000022");
    const updateRequest = {
      id: SEASON_ID,
      name: "Gap97 concurrently updated",
      description: seasonRow().description,
      startDate: seasonRow().startDate,
      endDate: seasonRow().endDate,
      rewards,
      paused: false,
      expectedUpdatedAt: REVISION,
      requestId: "97000000-0000-4000-8000-000000000023",
    };
    const [deleted, updated] = await Promise.all([
      (await callerFor(STAFF)).deleteSeason(deleteRequest),
      (await callerFor(OTHER_STAFF)).updateSeason(updateRequest),
    ]);
    expect([deleted.success, updated.success].sort()).toEqual([false, true]);
    const remainingSeason = await database.query.rankedSeason.findFirst({
      where: eq(rankedSeason.id, SEASON_ID),
    });
    if (deleted.success) {
      expect(remainingSeason).toBeUndefined();
    } else {
      expect(updated.success).toBe(true);
      expect(remainingSeason?.name).toBe(updateRequest.name);
    }
    expect(await database.query.actionLog.findMany()).toHaveLength(1);
  });

  it("uses fresh authorization for ordinary, banned, and demoted staff users", async () => {
    const database = await getTestDatabase();
    const ordinary = await (await callerFor("gap97-user")).deleteSeason(
      deleteInput("97000000-0000-4000-8000-000000000030"),
    );
    const banned = await (await callerFor("gap97-banned")).deleteSeason(
      deleteInput("97000000-0000-4000-8000-000000000031"),
    );
    await database
      .update(userData)
      .set({ role: "USER" })
      .where(eq(userData.userId, STAFF));
    const demoted = await (await callerFor()).deleteSeason(
      deleteInput("97000000-0000-4000-8000-000000000032"),
    );

    expect(ordinary.message).toMatch(/permission/i);
    expect(banned.message).toMatch(/banned/i);
    expect(demoted.message).toMatch(/permission/i);
    expect(await database.query.rankedSeason.findMany()).toHaveLength(1);
    expect(await database.query.actionLog.findMany()).toHaveLength(0);
  });

  it("rolls back reward and season deletion when the audit receipt insert fails", async () => {
    const database = await getTestDatabase();
    await database.insert(rankedUserRewards).values({
      id: "gap97-rollback-reward",
      userId: "gap97-user",
      seasonId: SEASON_ID,
      division: "Unranked",
    });
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
      (await callerFor(STAFF, failingDatabase)).deleteSeason(
        deleteInput("97000000-0000-4000-8000-000000000040"),
      ),
    ).rejects.toThrow("Statement failed on purpose");
    expect(await database.query.rankedSeason.findMany()).toHaveLength(1);
    expect(
      await database.query.rankedUserRewards.findFirst({
        where: and(
          eq(rankedUserRewards.id, "gap97-rollback-reward"),
          eq(rankedUserRewards.claimed, false),
        ),
      }),
    ).toBeDefined();
    expect(await database.query.actionLog.findMany()).toHaveLength(0);
  });
});
