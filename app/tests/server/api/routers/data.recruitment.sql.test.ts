import { beforeEach, describe, expect, it } from "bun:test";
import { referralSource, userData } from "@/drizzle/schema";
import { dataRouter } from "@/server/api/routers/data";
import { insertUsers } from "../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const totals = (rows: { source: string; series: { count: number }[] }[]) =>
  Object.fromEntries(
    rows.map((row) => [
      row.source,
      row.series.reduce((sum, entry) => sum + entry.count, 0),
    ]),
  );

describeWithDatabase("recruitment cohorts", () => {
  beforeEach(async () => {
    await resetTables(referralSource, userData);
    await insertUsers([
      { userId: "analyst", role: "CODING-ADMIN", isAi: true },
      { userId: "referred" },
      { userId: "organic" },
      { userId: "recruited", recruiterId: "referred" },
      { userId: "bot", isAi: true },
    ]);
    const db = await getTestDatabase();
    await db.insert(referralSource).values({
      id: "referral",
      userId: "referred",
      source: "discord",
    });
  });

  it("splits non-AI signups into referral, Dynamic and Recruited series", async () => {
    const api = await callerFor(dataRouter, "analyst");
    const all = await api.getRecruitmentDailyCountsBySource({});
    expect(totals(all)).toEqual({ discord: 1, Dynamic: 1, Recruited: 1 });
  });

  it("keeps only the selected series", async () => {
    const api = await callerFor(dataRouter, "analyst");
    const picked = await api.getRecruitmentDailyCountsBySource({
      sources: ["Dynamic"],
    });
    expect(totals(picked)).toEqual({ Dynamic: 1 });
  });

  it("counts only players with neither a referral nor a recruiter as Dynamic in every chart", async () => {
    const api = await callerFor(dataRouter, "analyst");
    const sources = ["Dynamic"];
    const daily = await api.getRecruitmentDailyCountsBySource({ sources });
    const stats = await api.getRecruitmentDailyLevelStats({ sources });
    const levels = await api.getRecruitmentLevelDistribution({ sources });
    const quests = await api.getRecruitmentLevelDistribution({
      sources,
      metric: "completedQuests",
    });
    expect(totals(daily)).toEqual({ Dynamic: 1 });
    expect(stats.reduce((sum, entry) => sum + entry.count, 0)).toBe(1);
    for (const rows of [levels, quests]) {
      expect(rows.map((row) => row.source)).toEqual(["Dynamic"]);
      const counts = rows[0]?.levelDistribution.map((entry) => entry.count);
      expect(counts?.reduce((sum, count) => sum + count, 0)).toBe(1);
    }
  });

  describe("a recruit who also has a referral row", () => {
    const distributionTotals = (
      rows: { source: string; levelDistribution: { count: number }[] }[],
    ) =>
      Object.fromEntries(
        rows.map((row) => [
          row.source,
          row.levelDistribution.reduce((sum, entry) => sum + entry.count, 0),
        ]),
      );

    beforeEach(async () => {
      const db = await getTestDatabase();
      await db.insert(referralSource).values({
        id: "recruit-referral",
        userId: "recruited",
        source: "discord",
      });
    });

    it("counts once, under Recruited, in the daily series", async () => {
      const api = await callerFor(dataRouter, "analyst");
      expect(totals(await api.getRecruitmentDailyCountsBySource({}))).toEqual({
        discord: 1,
        Dynamic: 1,
        Recruited: 1,
      });
    });

    it.each(["level", "completedQuests"] as const)(
      "counts once, under Recruited, in the %s distribution",
      async (metric) => {
        const api = await callerFor(dataRouter, "analyst");
        const rows = await api.getRecruitmentLevelDistribution({ metric });
        expect(distributionTotals(rows)).toEqual({
          discord: 1,
          Dynamic: 1,
          Recruited: 1,
        });
      },
    );

    it("leaves a selected source to its own channel in every chart", async () => {
      const api = await callerFor(dataRouter, "analyst");
      const sources = ["discord"];
      const stats = await api.getRecruitmentDailyLevelStats({ sources });
      expect(totals(await api.getRecruitmentDailyCountsBySource({ sources }))).toEqual({
        discord: 1,
      });
      expect(
        distributionTotals(await api.getRecruitmentLevelDistribution({ sources })),
      ).toEqual({ discord: 1 });
      expect(stats.reduce((sum, entry) => sum + entry.count, 0)).toBe(1);
    });

    it("stays out of the referral stats when no source is selected", async () => {
      const api = await callerFor(dataRouter, "analyst");
      const stats = await api.getRecruitmentDailyLevelStats({});
      expect(stats.reduce((sum, entry) => sum + entry.count, 0)).toBe(1);
    });

    it("still counts under Recruited when that series is selected with its source", async () => {
      const api = await callerFor(dataRouter, "analyst");
      const stats = await api.getRecruitmentDailyLevelStats({
        sources: ["discord", "Recruited"],
      });
      expect(stats.reduce((sum, entry) => sum + entry.count, 0)).toBe(2);
    });
  });
});
