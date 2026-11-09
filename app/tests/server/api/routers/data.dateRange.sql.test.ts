import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import {
  dataBattleAction,
  historicalIp,
  item,
  paypalTransaction,
  quest,
  questHistory,
  referralSource,
  userData,
  visitorLog,
} from "@/drizzle/schema";
import { dataRouter } from "@/server/api/routers/data";
import { insertItems, insertUsers } from "../../../setup/factories";
import { stubRateLimitTransport } from "../../../setup/rateLimit";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

/** A row on the range's first day, one at the last instant of its last day, and one just after it. */
const ON_FIRST_DAY = new Date("2026-03-08T00:00:00.000Z");
const ON_LAST_DAY = new Date("2026-03-10T23:59:59.999Z");
const AFTER_LAST_DAY = new Date("2026-03-11T00:00:00.000Z");
const RANGE = { startDate: "2026-03-08", endDate: "2026-03-10" };
const SINGLE_DAY = { startDate: "2026-03-10", endDate: "2026-03-10" };

const analyst = () => callerFor(dataRouter, "analyst");

/** Every statistics query with a user-selected range includes its whole end day. */
describeWithDatabase("statistics date ranges", () => {
  afterEach(() => vi.restoreAllMocks());

  beforeEach(async () => {
    stubRateLimitTransport();
    await resetTables(
      dataBattleAction,
      item,
      paypalTransaction,
      questHistory,
      quest,
      referralSource,
      historicalIp,
      visitorLog,
      userData,
    );
    await insertUsers([
      { userId: "analyst", username: "Analyst", role: "CODING-ADMIN", isAi: true },
    ]);
  });

  it("counts battle usage through the end day", async () => {
    await insertItems([{ id: "kunai", name: "Kunai" }]);
    await (await getTestDatabase()).insert(dataBattleAction).values(
      // Usage rows are unique per battle type
      (
        [
          ["ARENA", ON_FIRST_DAY],
          ["COMBAT", ON_LAST_DAY],
          ["SPARRING", AFTER_LAST_DAY],
        ] as const
      ).map(([battleType, createdAt]) => ({
        type: "item" as const,
        contentId: "kunai",
        battleType,
        battleWon: 1,
        count: 1,
        createdAt,
      })),
    );
    const usage = async (range: { startDate: string; endDate: string }) =>
      (
        await (await analyst()).getStatistics({ id: "kunai", type: "item", ...range })
      ).usage.reduce((sum, row) => sum + row.count, 0);
    expect(await usage(RANGE)).toBe(2);
    expect(await usage(SINGLE_DAY)).toBe(1);
  });

  it("counts recruitment signups through the end day", async () => {
    await insertUsers([
      { userId: "first", username: "First", createdAt: ON_FIRST_DAY },
      { userId: "last", username: "Last", createdAt: ON_LAST_DAY },
      { userId: "after", username: "After", createdAt: AFTER_LAST_DAY },
    ]);
    const signups = async (range: { startDate: string; endDate: string }) => {
      const api = await analyst();
      const [daily, stats, levels] = await Promise.all([
        api.getRecruitmentDailyCountsBySource({ sources: ["Dynamic"], ...range }),
        api.getRecruitmentDailyLevelStats({ sources: ["Dynamic"], ...range }),
        api.getRecruitmentLevelDistribution({ sources: ["Dynamic"], ...range }),
      ]);
      return {
        daily: daily
          .flatMap((row) => row.series)
          .reduce((sum, entry) => sum + entry.count, 0),
        stats: stats.reduce((sum, row) => sum + row.count, 0),
        levels: levels
          .flatMap((row) => row.levelDistribution)
          .reduce((sum, entry) => sum + entry.count, 0),
      };
    };
    expect(await signups(RANGE)).toEqual({ daily: 2, stats: 2, levels: 2 });
    expect(await signups(SINGLE_DAY)).toEqual({ daily: 1, stats: 1, levels: 1 });
  });

  it("counts first visits through the end day", async () => {
    await (await getTestDatabase()).insert(visitorLog).values(
      [ON_FIRST_DAY, ON_LAST_DAY, AFTER_LAST_DAY].map((createdAt, index) => ({
        id: `visit-${index}`,
        ipHash: `visitor-${index}`,
        utmSource: "discord",
        createdAt,
      })),
    );
    const visitors = async (range: { startDate: string; endDate: string }) =>
      (
        await (
          await analyst()
        ).getRecruitmentMainMetrics({ utmSource: "discord", ...range })
      ).visitors;
    expect(await visitors(RANGE)).toBe(2);
    expect(await visitors(SINGLE_DAY)).toBe(1);
  });

  it("totals referral revenue through the end day", async () => {
    const db = await getTestDatabase();
    await insertUsers([
      {
        userId: "payer",
        username: "Payer",
        createdAt: new Date("2026-01-02T00:00:00Z"),
      },
    ]);
    await db.insert(visitorLog).values({
      id: "visit",
      ipHash: "payer",
      utmSource: "discord",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    await db
      .insert(historicalIp)
      .values({ userId: "payer", ip: "ip-payer", ipHash: "payer" });
    await db.insert(paypalTransaction).values(
      [ON_FIRST_DAY, ON_LAST_DAY, AFTER_LAST_DAY].map((createdAt, index) => ({
        id: `payment-${index}`,
        createdById: "payer",
        transactionId: `transaction-${index}`,
        transactionUpdatedDate: createdAt.toISOString(),
        amount: 10 ** index,
        status: "COMPLETED",
        rawData: {},
        createdAt,
      })),
    );
    const revenue = async (range: { startDate: string; endDate: string }) =>
      await (await analyst()).getRevenueByReferralSource(range);
    expect(await revenue(RANGE)).toEqual([{ source: "discord", totalUsd: 11 }]);
    expect(await revenue(SINGLE_DAY)).toEqual([{ source: "discord", totalUsd: 10 }]);
  });
});
