// @vitest-environment node

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { actionLog, rankedSeason, userData } from "@/drizzle/schema";
import { pvpRankRouter } from "@/routers/pvprank";
import type { DrizzleClient } from "@/server/db";
import { createRankedSeasonSchema, rewardSchema } from "@/validators/pvpRank";
import { insertUsers } from "../../setup/factories";
import { failStatements } from "../../setup/statements";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

const STAFF = "gap95-staff";
const OTHER_STAFF = "gap95-other-staff";
const ACTIVE_SEASON_START = new Date(Date.now() - 24 * 60 * 60 * 1000);
const ACTIVE_SEASON_END = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

const seasonInput = (
  requestId: string,
  overrides: Partial<{
    name: string;
    description: string;
    startDate: Date;
    endDate: Date;
    paused: boolean;
  }> = {},
) => ({
  name: "Gap95 Autumn Circuit",
  description: "Gap95 focused ranked season",
  startDate: ACTIVE_SEASON_START,
  endDate: ACTIVE_SEASON_END,
  paused: false,
  rewards: [
    {
      division: "Unranked" as const,
      rewards: rewardSchema.parse({ reward_money: 125, reward_reputation: 7 }),
    },
  ],
  requestId,
  ...overrides,
});

const callerFor = async (userId = STAFF, database?: DrizzleClient) =>
  pvpRankRouter.createCaller({
    drizzle: database ?? (await getTestDatabase()),
    userId,
  } as never);

describe("ranked season validation", () => {
  it("rejects invalid date ranges, duplicate divisions and unsafe rewards", async () => {
    const base = seasonInput("95000000-0000-4000-8000-000000000001");
    expect(
      await createRankedSeasonSchema.safeParseAsync({
        ...base,
        endDate: base.startDate,
      }),
    ).toMatchObject({ success: false });
    expect(
      await createRankedSeasonSchema.safeParseAsync({
        ...base,
        rewards: [...base.rewards, base.rewards[0]!],
      }),
    ).toMatchObject({ success: false });
    expect(
      await createRankedSeasonSchema.safeParseAsync({
        ...base,
        rewards: [
          {
            division: "Wood",
            rewards: rewardSchema.parse({ reward_money: -1 }),
          },
        ],
      }),
    ).toMatchObject({ success: false });
  });
});

describeWithDatabase("pvpRank.createSeason", () => {
  beforeEach(async () => {
    await resetTables(actionLog, rankedSeason, userData);
    await insertUsers([
      { userId: STAFF, username: "Gap95 Staff", role: "OWNER" },
      {
        userId: OTHER_STAFF,
        username: "Gap95 Other Staff",
        role: "CONTENT",
      },
      { userId: "gap95-user", username: "Gap95 User", role: "USER" },
      {
        userId: "gap95-banned",
        username: "Gap95 Banned",
        role: "CONTENT",
        isBanned: true,
      },
    ]);
  });

  it("atomically creates one season with an exact audit receipt", async () => {
    const database = await getTestDatabase();
    const input = seasonInput("95000000-0000-4000-8000-000000000002");
    const result = await (await callerFor()).createSeason(input);

    expect(result).toMatchObject({
      success: true,
      requestId: input.requestId,
      submittedSeason: {
        name: input.name,
        description: input.description,
        startDate: input.startDate,
        endDate: input.endDate,
        rewards: input.rewards,
        paused: input.paused,
      },
      createdSeason: {
        name: input.name,
        description: input.description,
      },
    });
    expect(result.createdSeason?.id).toBeTruthy();
    const stored = await database.query.rankedSeason.findFirst({
      where: eq(rankedSeason.id, result.createdSeason?.id ?? ""),
    });
    const receipt = await database.query.actionLog.findFirst({
      where: eq(actionLog.id, `create-ranked-season:${input.requestId}`),
    });
    expect(stored).toMatchObject({
      id: result.createdSeason?.id,
      name: input.name,
      rewards: input.rewards,
    });
    expect(receipt).toMatchObject({
      userId: STAFF,
      tableName: "RankedSeason",
      relatedId: result.createdSeason?.id,
    });
  });

  it("replays a lost response exactly and rejects a changed request UUID payload", async () => {
    const database = await getTestDatabase();
    const caller = await callerFor();
    const input = seasonInput("95000000-0000-4000-8000-000000000003");
    const first = await caller.createSeason(input);
    const replay = await caller.createSeason(input);
    const changed = await caller.createSeason({ ...input, name: "Gap95 Changed" });

    expect(replay).toMatchObject({
      success: true,
      message: "Season was already created",
      requestId: input.requestId,
      createdSeason: { id: first.createdSeason?.id },
    });
    expect(changed).toEqual({
      success: false,
      message: "Invalid ranked season creation request ID",
    });
    expect(await database.query.rankedSeason.findMany()).toHaveLength(1);
    expect(await database.query.actionLog.findMany()).toHaveLength(1);
  });

  it("makes concurrent duplicate requests one write with identical identities", async () => {
    const database = await getTestDatabase();
    const caller = await callerFor();
    const input = seasonInput("95000000-0000-4000-8000-000000000004");
    const results = await Promise.all([
      caller.createSeason(input),
      caller.createSeason(input),
    ]);

    expect(results.every((result) => result.success)).toBe(true);
    expect(results[0]?.createdSeason?.id).toBe(results[1]?.createdSeason?.id);
    expect(await database.query.rankedSeason.findMany()).toHaveLength(1);
    expect(await database.query.actionLog.findMany()).toHaveLength(1);
  });

  it("serializes distinct simultaneous active-season creates to one winner", async () => {
    const database = await getTestDatabase();
    const [first, second] = await Promise.all([
      (await callerFor(STAFF)).createSeason(
        seasonInput("95000000-0000-4000-8000-000000000005", {
          name: "Gap95 Concurrent A",
        }),
      ),
      (await callerFor(OTHER_STAFF)).createSeason(
        seasonInput("95000000-0000-4000-8000-000000000006", {
          name: "Gap95 Concurrent B",
        }),
      ),
    ]);

    expect([first.success, second.success].sort()).toEqual([false, true]);
    expect(await database.query.rankedSeason.findMany()).toHaveLength(1);
    expect(await database.query.actionLog.findMany()).toHaveLength(1);
  });

  it("rejects ordinary and banned actors using fresh database authorization", async () => {
    const ordinary = await (await callerFor("gap95-user")).createSeason(
      seasonInput("95000000-0000-4000-8000-000000000007"),
    );
    const banned = await (await callerFor("gap95-banned")).createSeason(
      seasonInput("95000000-0000-4000-8000-000000000008"),
    );

    expect(ordinary.message).toMatch(/permission/i);
    expect(banned.message).toMatch(/banned/i);
  });

  it("rolls back the season if its audit receipt cannot be inserted", async () => {
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
    const caller = await callerFor(STAFF, failingDatabase);

    await expect(
      caller.createSeason(seasonInput("95000000-0000-4000-8000-000000000009")),
    ).rejects.toThrow("Statement failed on purpose");
    expect(await database.query.rankedSeason.findMany()).toHaveLength(0);
    expect(await database.query.actionLog.findMany()).toHaveLength(0);
  });

  it("preserves future-season behavior while stripping unauthorized reputation", async () => {
    const database = await getTestDatabase();
    await database
      .update(userData)
      .set({ role: "CODER" })
      .where(eq(userData.userId, STAFF));
    const caller = await callerFor();
    const first = await caller.createSeason(
      seasonInput("95000000-0000-4000-8000-000000000010", {
        startDate: new Date("2030-01-01T00:00:00.000Z"),
        endDate: new Date("2030-02-01T00:00:00.000Z"),
      }),
    );
    const second = await caller.createSeason(
      seasonInput("95000000-0000-4000-8000-000000000011", {
        name: "Gap95 Future Two",
        startDate: new Date("2030-03-01T00:00:00.000Z"),
        endDate: new Date("2030-04-01T00:00:00.000Z"),
      }),
    );

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(first.createdSeason?.rewards[0]?.rewards.reward_reputation).toBe(0);
    expect(await database.query.rankedSeason.findMany()).toHaveLength(2);
  });
});
