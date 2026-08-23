import { Client } from "@planetscale/database";
import type { SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/planetscale-serverless";
import { describe, expect, it } from "vitest";
import { CONTRIBUTION_MAX_REWARDED_JOBS_PER_DAY } from "@/drizzle/constants";
import {
  buildConsumeRewardSlotSql,
  grantContributionReward,
} from "@/libs/devContribution/rewards";

// Rendering the statement needs a dialect, not a connection: nothing is executed.
// `dialect` is internal to drizzle, hence the cast.
const dialect = (
  drizzle(new Client({ url: "mysql://u:p@localhost/db" })) as unknown as {
    dialect: { sqlToQuery: (query: SQL) => { sql: string; params: unknown[] } };
  }
).dialect;
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

describe("regression: a stale day must not reset the reward cap", () => {
  it("guards the date with < so an older `today` matches no branch", () => {
    // The maintenance cron stamps `today` once per tick and can cross UTC
    // midnight mid-batch, so a payout can arrive carrying yesterday. With `<>`
    // that satisfied the guard and then wrote rewardedJobsDate backwards,
    // resetting rewardedJobsToday to 1 and handing the user a fresh daily cap.
    const query = render("user_1", "2026-08-20");
    expect(query).toContain("rewardedJobsDate < ?");
    expect(query).not.toContain("rewardedJobsDate <> ?");
    // The count branch only applies on the same day, never on a stale one.
    expect(query).toContain("rewardedJobsDate = ? AND rewardedJobsToday < ?");
  });
});

describe("regression: one GitHub artifact pays once", () => {
  it("claims the artifact url alongside rewardGranted", async () => {
    // A single pull request whose body names several issues satisfies the
    // implement verification for each of them. Idempotency keyed on devJob.id
    // does not catch that, because those are genuinely different jobs — the
    // artifact is what must be unique.
    const sets: Record<string, unknown>[] = [];
    const client = {
      select: () => ({
        from: () => ({ where: () => Promise.resolve([{ userId: "u1" }]) }),
      }),
      execute: () => Promise.resolve({ rowsAffected: 1 }),
      update: () => ({
        set: (values: Record<string, unknown>) => {
          sets.push(values);
          return { where: () => Promise.resolve({ rowsAffected: 1 }) };
        },
      }),
      insert: () => ({ values: () => Promise.resolve({ rowsAffected: 1 }) }),
    } as unknown as Parameters<typeof grantContributionReward>[0]["client"];

    await grantContributionReward({
      client,
      userId: "u1",
      jobId: 1,
      jobType: "ISSUE_IMPLEMENT",
      today: "2026-08-22",
      artifactUrl: "https://github.com/o/r/pull/9",
    });

    const claim = sets.find((v) => v.rewardGranted === true);
    expect(claim?.rewardedArtifact).toBe("https://github.com/o/r/pull/9");
  });
});
