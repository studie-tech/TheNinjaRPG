import { beforeEach, expect, it } from "bun:test";
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

  it("counts every user without a referral row as Dynamic in the level distribution", async () => {
    const api = await callerFor(dataRouter, "analyst");
    const rows = await api.getRecruitmentLevelDistribution({ sources: ["Dynamic"] });
    expect(rows.map((row) => row.source)).toEqual(["Dynamic"]);
    const counts = rows[0]?.levelDistribution.map((entry) => entry.count);
    expect(counts?.reduce((sum, count) => sum + count, 0)).toBe(2);
  });
});
