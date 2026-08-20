import { Client } from "@planetscale/database";
import { drizzle } from "drizzle-orm/planetscale-serverless";
import { describe, expect, it } from "vitest";
import { CONTRIBUTION_MAX_REWARDED_JOBS_PER_DAY } from "@/drizzle/constants";
import { buildConsumeRewardSlotSql } from "@/libs/devContribution/rewards";

// Rendering the statement needs a dialect, not a connection: nothing is executed.
const dialect = drizzle(new Client({ url: "mysql://u:p@localhost/db" })).dialect;
const render = (userId: string, today: string) =>
  dialect.sqlToQuery(buildConsumeRewardSlotSql(userId, today)).sql.replace(/\s+/g, " ");

describe("consumeRewardSlot statement", () => {
  it("assigns rewardedJobsToday before rewardedJobsDate", () => {
    // MySQL evaluates SET assignments left to right, and later ones see values
    // already assigned. If the date were written first, IF() would compare the
    // new day against itself, so the first payout of a new day would increment
    // yesterday's count instead of resetting to 1 — carrying the cap over.
    //
    // This cannot be expressed with drizzle's .set({...}), which emits columns
    // in table-declaration order regardless of object key order, so the guard
    // is raw SQL and this test pins the ordering.
    const sql = render("user_1", "2026-08-20");
    const counterAt = sql.indexOf("rewardedJobsToday =");
    const dateAt = sql.indexOf("rewardedJobsDate =");
    expect(counterAt).toBeGreaterThan(-1);
    expect(dateAt).toBeGreaterThan(-1);
    expect(counterAt).toBeLessThan(dateAt);
  });

  it("resets to 1 on a different day and increments on the same day", () => {
    expect(render("user_1", "2026-08-20")).toContain(
      "IF(rewardedJobsDate = ?, rewardedJobsToday + 1, 1)",
    );
  });

  it("guards on the daily cap so a concurrent call cannot exceed it", () => {
    const sql = render("user_1", "2026-08-20");
    expect(sql).toContain("rewardedJobsToday <");
    // The cap comes from the constant rather than a literal in the statement.
    const params = dialect.sqlToQuery(
      buildConsumeRewardSlotSql("user_1", "2026-08-20"),
    ).params;
    expect(params).toContain(CONTRIBUTION_MAX_REWARDED_JOBS_PER_DAY);
  });

  it("scopes the update to a single user", () => {
    const query = dialect.sqlToQuery(
      buildConsumeRewardSlotSql("user_42", "2026-08-20"),
    );
    expect(query.sql).toContain("WHERE userId = ?");
    expect(query.params).toContain("user_42");
  });
});
