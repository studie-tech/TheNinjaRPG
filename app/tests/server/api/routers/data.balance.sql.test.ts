import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { bloodline, dataBattleAction, item, jutsu } from "@/drizzle/schema";
import { insertDataBattleActionForSaveUsage } from "@/queries/combat";
import { selectDataBattleActionForUsageStats } from "@/queries/contentReview";
import {
  deleteDataBattleActionForDeleteAllDataBattleAction,
  deleteDataBattleActionForDeleteSingleDataBattleAction,
} from "@/queries/data";
import { dataRouter } from "@/server/api/routers/data";
import { getBalancePeriodEnd, getBalancePeriodStart } from "@/utils/time";
import { insertItems, insertJutsus, jutsuRow } from "../../../setup/factories";
import { stubRateLimitTransport } from "../../../setup/rateLimit";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

it("rotates reporting periods on a fixed fortnightly UTC boundary", () => {
  const first = getBalancePeriodStart(new Date("2026-11-16T00:00:00Z"));
  expect(getBalancePeriodStart(new Date("2026-11-29T23:59:59.999Z"))).toBe(first);
  expect(getBalancePeriodStart(new Date("2026-11-30T00:00:00Z"))).toBe(
    getBalancePeriodEnd(first),
  );
  expect(getBalancePeriodEnd(first) - first).toBe(14 * 86400);
});

describeWithDatabase("fortnightly balance reports", () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(async () => {
    stubRateLimitTransport();
    await resetTables(dataBattleAction, bloodline, item, jutsu);
    await insertJutsus([jutsuRow("fire", { name: "Fire" })]);
  });

  it("keeps archive and demographic counters distinct during atomic increments", async () => {
    const db = await getTestDatabase();
    const entry = {
      type: "jutsu" as const,
      contentId: "fire",
      battleType: "COMBAT" as const,
      battleWon: 1,
      userLevel: 50,
      userRank: "JONIN" as const,
      turnOrder: 1,
    };
    const period = getBalancePeriodStart();
    await insertDataBattleActionForSaveUsage(db, [entry], period - 14 * 86400);
    await Promise.all(
      Array.from({ length: 5 }, () =>
        insertDataBattleActionForSaveUsage(db, [entry], period),
      ),
    );
    await insertDataBattleActionForSaveUsage(
      db,
      [{ ...entry, userLevel: 20, userRank: "CHUNIN", turnOrder: 2, battleWon: 0 }],
      period,
    );
    const caller = await callerFor(dataRouter, "viewer");
    const report = await caller.getBalanceOverview({
      battleTypes: ["COMBAT"],
      userRanks: ["JONIN"],
      minLevel: 50,
      maxLevel: 50,
    });
    expect(report.content).toEqual([
      { type: "jutsu", contentId: "fire", name: "Fire", battleWon: 1, count: 5 },
    ]);
    expect(
      (
        await caller.getJutsuBalanceStatistics({
          minCount: 1,
          minLevel: 50,
          maxLevel: 50,
        })
      )[0]?.count,
    ).toBe(5);
    expect(
      (await selectDataBattleActionForUsageStats(db)).reduce(
        (total, row) => total + row.n,
        0,
      ),
    ).toBe(6);
    expect((await caller.getBalanceArchives()).map((row) => row.periodStart)).toEqual([
      period - 14 * 86400,
    ]);
  });

  it("applies active-period cohorts and fractional levels consistently to overview and usage reports", async () => {
    const db = await getTestDatabase();
    await insertItems([{ id: "kunai", name: "Kunai" }]);
    await db.insert(bloodline).values({
      id: "fire",
      name: "Fire",
      rank: "D",
      image: "",
      description: "Fire",
      effects: [],
    });
    await db.insert(dataBattleAction).values(
      (["jutsu", "item", "bloodline", "participant"] as const)
        .flatMap((type) =>
          [19, 20, 21].map((userLevel) => ({
            type,
            contentId:
              type === "participant" ? "player" : type === "item" ? "kunai" : "fire",
            periodStart: getBalancePeriodStart(),
            battleType: "COMBAT" as const,
            userLevel,
            userRank: "CHUNIN" as const,
            battleWon: 1,
            turnOrder: 1,
            count: userLevel === 20 ? 3 : 100,
          })),
        )
        .flatMap((row) => [
          row,
          { ...row, periodStart: row.periodStart - 14 * 86400, count: 100 },
          { ...row, battleType: "ARENA" as const, count: 100 },
          { ...row, userRank: "JONIN" as const, count: 100 },
        ]),
    );
    const caller = await callerFor(dataRouter, "viewer");
    const filter = {
      battleTypes: ["COMBAT" as const],
      userRanks: ["CHUNIN" as const],
      minLevel: 19.5,
      maxLevel: 20.5,
    };
    const [overview, jutsus, items, bloodlines] = await Promise.all([
      caller.getBalanceOverview(filter),
      caller.getJutsuBalanceStatistics(filter),
      caller.getItemBalanceStatistics(filter),
      caller.getBloodlineBalanceStatistics(filter),
    ]);
    expect(overview.content).toHaveLength(3);
    expect(overview.content.map((row) => row.count)).toEqual([3, 3, 3]);
    expect(overview.participants).toHaveLength(1);
    expect(overview.participants[0]).toMatchObject({ userLevel: 20, count: 3 });
    expect(jutsus).toHaveLength(1);
    expect(jutsus[0]).toMatchObject({ jutsuId: "fire", count: 3 });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ itemId: "kunai", count: 3 });
    expect(bloodlines).toHaveLength(1);
    expect(bloodlines[0]).toMatchObject({ bloodlineId: "fire", totalUsage: 3 });
  });

  it("retains completed and legacy periods when staff clear live data", async () => {
    const db = await getTestDatabase();
    const period = getBalancePeriodStart();
    await db.insert(dataBattleAction).values(
      [0, period - 14 * 86400, period].map((periodStart) => ({
        periodStart,
        type: "jutsu" as const,
        contentId: "fire",
        battleType: "COMBAT" as const,
        battleWon: 1,
      })),
    );
    await deleteDataBattleActionForDeleteSingleDataBattleAction(db, {
      type: "jutsu",
      contentId: "fire",
    });
    await deleteDataBattleActionForDeleteAllDataBattleAction(db, { type: "jutsu" });
    expect(
      (await db.query.dataBattleAction.findMany()).map((r) => r.periodStart).sort(),
    ).toEqual([0, period - 14 * 86400]);
  });

  it("counts player outcomes independently from content usage and separates first and second", async () => {
    const db = await getTestDatabase();
    await db.insert(dataBattleAction).values(
      [
        {
          type: "participant",
          contentId: "player",
          turnOrder: 1,
          battleWon: 1,
          count: 3,
        },
        {
          type: "participant",
          contentId: "player",
          turnOrder: 2,
          battleWon: 0,
          count: 3,
        },
        {
          type: "participant",
          contentId: "player",
          turnOrder: 0,
          battleWon: 1,
          count: 100,
        },
        { type: "jutsu", contentId: "fire", turnOrder: 1, battleWon: 1, count: 100 },
      ].map((r) => ({
        ...r,
        type: r.type as "participant" | "jutsu",
        periodStart: getBalancePeriodStart(),
        battleType: "COMBAT" as const,
        userLevel: 50,
        userRank: "JONIN" as const,
      })),
    );
    const report = await (await callerFor(dataRouter, "viewer")).getBalanceOverview({});
    expect(
      report.participants
        .map((r) => ({ order: r.turnOrder, count: r.count }))
        .sort((a, b) => a.order - b.order),
    ).toEqual([
      { order: 1, count: 3 },
      { order: 2, count: 3 },
    ]);
    expect(report.content[0]?.count).toBe(100);
  });

  it("downloads every archive row across bounded keyset pages and rejects live exports", async () => {
    const db = await getTestDatabase();
    const periodStart = getBalancePeriodStart() - 14 * 86400;
    await db.insert(dataBattleAction).values(
      Array.from({ length: 1001 }, (_, i) => ({
        periodStart,
        type: "jutsu" as const,
        contentId: `content-${i}`,
        battleType: "COMBAT" as const,
        battleWon: 1,
      })),
    );
    const caller = await callerFor(dataRouter, "viewer");
    expect(await caller.getBalanceArchives()).toEqual([{ periodStart }]);
    const first = await caller.getBalanceArchivePage({ periodStart });
    expect(first.rows).toHaveLength(1000);
    const second = await caller.getBalanceArchivePage({
      periodStart,
      cursor: first.nextCursor,
    });
    expect(second.rows).toHaveLength(1);
    expect(second.nextCursor).toBeUndefined();
    expect(new Set([...first.rows, ...second.rows].map((r) => r.id)).size).toBe(1001);
    await expect(
      caller.getBalanceArchivePage({ periodStart: getBalancePeriodStart() }),
    ).rejects.toThrow("Only completed balance periods");
  });
});
