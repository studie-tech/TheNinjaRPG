import { beforeEach, expect, it, vi } from "bun:test";
import { userData, userReport, userReportComment } from "@/drizzle/schema";
import { reportsRouter } from "@/server/api/routers/reports";
import { insertUsers } from "../../../../setup/factories";
import { aroundStatements } from "../../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

/** Report statistics aggregate whole tables, so only staff may make them run. */
describeWithDatabase("report statistics", () => {
  beforeEach(async () => {
    await resetTables(userReportComment, userReport, userData);
    await insertUsers([
      { userId: "statistics-player", username: "StatisticsPlayer", role: "USER" },
      {
        userId: "statistics-moderator",
        username: "StatisticsModerator",
        role: "MODERATOR",
      },
    ]);
  });

  it("rejects players before running the aggregates", async () => {
    const aggregates = vi.fn();
    const database = aroundStatements(
      await getTestDatabase(),
      userReport,
      (run) => {
        aggregates();
        return run();
      },
      { operations: ["select"] },
    );
    const caller = callerForDatabase(reportsRouter, "statistics-player", database);
    await expect(caller.getReportStatistics()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "You cannot view this page",
    });
    expect(aggregates).not.toHaveBeenCalled();
  });

  it("returns the staff roster and empty tallies to staff", async () => {
    const caller = await callerFor(reportsRouter, "statistics-moderator");
    expect(await caller.getReportStatistics()).toEqual({
      staff: [expect.objectContaining({ userId: "statistics-moderator" })],
      timesReported: [],
      timesReporting: [],
      decisions: [],
    });
  });
});
