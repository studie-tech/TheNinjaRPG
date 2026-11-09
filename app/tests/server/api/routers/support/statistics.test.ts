import { afterEach, describe, expect, it } from "bun:test";
import { drizzle } from "drizzle-orm/mysql-proxy";
import * as schema from "@/drizzle/schema";
import { supportRouter } from "@/routers/support";
import type { DrizzleClient } from "@/server/db";
import { resetServerModuleStubs, stubProfile } from "../../../../setup/serverModules";
import { callerForDatabase } from "../../../../setup/testDatabase";

const userId = "support-staff";
const dateRange = {
  dateFrom: "2026-01-01T00:00:00.000Z",
  dateTo: "2026-02-01T00:00:00.000Z",
};

describe("support.getStatistics grouped summaries", () => {
  afterEach(resetServerModuleStubs);

  it("derives numeric summaries from grouped counts, including unassigned tickets", async () => {
    const { caller, queries } = statisticsCaller({
      category: [["BUG_REPORT", "6"]],
      priority: [["MEDIUM", "6"]],
      status: [
        ["OPEN", "2"],
        ["RESOLVED", "1"],
        ["IN_PROGRESS", "1"],
        ["CLOSED", "2"],
      ],
      assignedToUserId: [
        [userId, "3"],
        ["other-staff", "2"],
        [null, "1"],
      ],
    });

    expect(await caller.getStatistics(dateRange)).toEqual({
      totalTickets: 6,
      openTickets: 2,
      resolvedTickets: 1,
      assignedToCurrentUser: 3,
      ticketsByCategory: { BUG_REPORT: 6 },
      ticketsByPriority: { MEDIUM: 6 },
      ticketsByStatus: { OPEN: 2, RESOLVED: 1, IN_PROGRESS: 1, CLOSED: 2 },
      ticketsByAssignee: { [userId]: 3, "other-staff": 2, "N/A": 1 },
      averageResponseTime: 0,
      averageResolutionTime: 0,
      firstResponseRate: 0,
      resolutionRate: 0,
    });
    expect(queries).toHaveLength(5);
    expect(queries.filter(({ sql }) => sql.includes("group by"))).toHaveLength(4);
  });

  it("returns zero summaries for an empty cohort", async () => {
    const { caller, queries } = statisticsCaller();

    expect(await caller.getStatistics(dateRange)).toMatchObject({
      totalTickets: 0,
      openTickets: 0,
      resolvedTickets: 0,
      assignedToCurrentUser: 0,
      ticketsByCategory: {},
      ticketsByPriority: {},
      ticketsByStatus: {},
      ticketsByAssignee: {},
    });
    expect(queries).toHaveLength(5);
  });

  it("defaults absent status and current-assignee groups to zero", async () => {
    const { caller } = statisticsCaller({
      category: [["OTHER", 4]],
      priority: [["LOW", 4]],
      status: [
        ["IN_PROGRESS", 3],
        ["CLOSED", 1],
      ],
      assignedToUserId: [
        ["other-staff", 2],
        [null, 2],
      ],
    });

    expect(await caller.getStatistics(dateRange)).toMatchObject({
      totalTickets: 4,
      openTickets: 0,
      resolvedTickets: 0,
      assignedToCurrentUser: 0,
      ticketsByAssignee: { "other-staff": 2, "N/A": 2 },
    });
  });

  it("keeps the summary cohort when filtering to another assignee and category", async () => {
    const { caller, queries } = statisticsCaller({
      category: [["BUG_REPORT", 5]],
      priority: [["HIGH", 5]],
      status: [["OPEN", 5]],
      assignedToUserId: [["other-staff", 5]],
    });

    expect(
      await caller.getStatistics({
        ...dateRange,
        assignedToUserId: "other-staff",
        category: "BUG_REPORT",
      }),
    ).toMatchObject({
      totalTickets: 5,
      openTickets: 5,
      resolvedTickets: 0,
      assignedToCurrentUser: 0,
    });
    const aggregates = queries.filter(({ sql }) => sql.includes("group by"));
    expect(aggregates).toHaveLength(4);
    for (const { params } of aggregates) {
      expect(params).toHaveLength(4);
      expect(params.slice(2)).toEqual(["other-staff", "BUG_REPORT"]);
    }
  });

  it("denies non-staff before reading statistics", async () => {
    const { caller, queries } = statisticsCaller();
    stubProfile("fetchUser", async () => ({ userId, role: "USER" }));

    await expect(caller.getStatistics(dateRange)).rejects.toThrow("Access denied");
    expect(queries).toHaveLength(0);
  });
});

const statisticsCaller = (
  groups: Partial<Record<string, (string | number | null)[][]>> = {},
) => {
  stubProfile("fetchUser", async () => ({ userId, role: "ADMIN" }));
  const queries: { sql: string; params: unknown[] }[] = [];
  // Real Drizzle SQL generation and decoding, with driver rows supplied in memory.
  const client = drizzle(
    async (sql, params) => {
      queries.push({ sql, params });
      const group = /group by `SupportTicket`\.`(\w+)`/.exec(sql)?.[1];
      if (group) return { rows: groups[group] ?? [] };
      // The metrics relation read has no tickets in these summary fixtures.
      expect(sql).toContain("`SupportTicket` `supportTicket`");
      return { rows: [] };
    },
    { schema },
  ) as unknown as DrizzleClient;
  return { caller: callerForDatabase(supportRouter, userId, client), queries };
};
