import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { count } from "drizzle-orm";
import { bloodlineRolls } from "@/drizzle/schema";
import { bloodlineRouter } from "@/server/api/routers/bloodline";
import { shrineRouter } from "@/server/api/routers/shrine";
import { supportRouter } from "@/server/api/routers/support";
import type { DrizzleClient } from "@/server/db";
import { planetScaleFixture } from "../../../setup/planetscale";
import { resetServerModuleStubs, stubProfile } from "../../../setup/serverModules";
import { callerForDatabase } from "../../../setup/testDatabase";

const int64Count = { name: "count", type: "INT64" };
const userId = "count-staff";

describe("PlanetScale aggregate counts", () => {
  beforeEach(() => {
    stubProfile("fetchUser", async () => ({ userId, role: "ADMIN" }));
    stubProfile("fetchUpdatedUser", async () => ({
      user: { userId, status: "QUEUED" },
    }));
  });

  afterEach(resetServerModuleStubs);

  it("returns numeric support totals and grouped summaries from INT64 strings", async () => {
    const { database } = planetScaleFixture((query) => {
      if (query.includes("group by")) {
        const groups = [
          {
            column: "category",
            values: [
              ["BUG_REPORT", "3"],
              ["OTHER", "1"],
            ],
          },
          {
            column: "priority",
            values: [
              ["HIGH", "2"],
              ["LOW", "2"],
            ],
          },
          {
            column: "status",
            values: [
              ["OPEN", "3"],
              ["RESOLVED", "1"],
            ],
          },
          {
            column: "assignedToUserId",
            values: [
              [userId, "1"],
              [null, "3"],
            ],
          },
        ];
        const group = groups.find(({ column }) => query.endsWith(`\`${column}\``));
        if (!group) throw new Error(`Unexpected grouped query: ${query}`);
        return {
          fields: [{ name: group.column, type: "VARCHAR" }, int64Count],
          rows: group.values,
        };
      }
      // The middleware isolation lookup and the independent support metrics read are empty.
      if (query.includes("QuestHistory") || query.includes("SupportTicket")) return {};
      throw new Error(`Unexpected query: ${query}`);
    });
    const caller = callerForDatabase(supportRouter, userId, database);
    const result = await caller.getStatistics({});
    expect(result).toMatchObject({
      totalTickets: 4,
      openTickets: 3,
      resolvedTickets: 1,
      assignedToCurrentUser: 1,
      ticketsByCategory: { BUG_REPORT: 3, OTHER: 1 },
      ticketsByPriority: { HIGH: 2, LOW: 2 },
      ticketsByStatus: { OPEN: 3, RESOLVED: 1 },
      ticketsByAssignee: { [userId]: 1, "N/A": 3 },
    });
  });

  for (const remaining of ["0", "2"]) {
    it(`cleans the shrine queue only when its INT64 remaining count is zero (${remaining})`, async () => {
      const { database, statements } = planetScaleFixture((query) => {
        if (query.startsWith("select count(*)")) {
          return { fields: [int64Count], rows: [[remaining]] };
        }
        if (query.startsWith("select")) return {};
        if (query.startsWith("delete") || query.startsWith("update")) {
          return { rowsAffected: 1 };
        }
        throw new Error(`Unexpected query: ${query}`);
      });
      const result = await callerForDatabase(
        shrineRouter,
        userId,
        database,
      ).leaveShrineBattle({ shrineBattleId: "count-shrine" });
      expect(result.success).toBe(true);
      const queueDeletes = statements.filter((query) =>
        query.startsWith("delete from `MpvpBattleQueue`"),
      );
      expect(queueDeletes).toHaveLength(remaining === "0" ? 1 : 0);
      if (remaining === "0") {
        expect(queueDeletes[0]).toContain("`battleId` is null");
        expect(queueDeletes[0]).toContain("'count-shrine'");
      }
    });
  }

  it("returns numeric natural bloodline roll counts and the no-bloodline total", async () => {
    const { database } = planetScaleFixture((query) => {
      if (query.includes("group by")) {
        return {
          fields: [{ name: "rank", type: "VARCHAR" }, int64Count],
          rows: [
            ["S", "2"],
            [null, "3"],
          ],
        };
      }
      if (query.startsWith("select count(")) {
        return { fields: [int64Count], rows: [["3"]] };
      }
      if (query.includes("QuestHistory")) return {};
      throw new Error(`Unexpected query: ${query}`);
    });
    // Public-query middleware uses external Redis; this fixture exercises the resolver's counts.
    const { resolver } = bloodlineRouter._def.procedures.getNaturalRollStatistics
      ._def as unknown as {
      resolver: (args: {
        ctx: { drizzle: DrizzleClient; userId: string };
        input: undefined;
      }) => Promise<Record<string, number>>;
    };
    expect(
      await resolver({ ctx: { drizzle: database, userId }, input: undefined }),
    ).toEqual({ D: 0, C: 0, B: 0, A: 0, S: 2, H: 0, none: 3 });
  });

  it("retains COUNT(column) SQL semantics and decodes counts up to the safe integer limit", async () => {
    const { database, statements } = planetScaleFixture(() => ({
      fields: [int64Count, int64Count],
      rows: [[String(Number.MAX_SAFE_INTEGER), "2"]],
    }));
    const [result] = await database
      .select({
        total: count(),
        withBloodline: count(bloodlineRolls.bloodlineId),
      })
      .from(bloodlineRolls);
    expect(result).toEqual({ total: Number.MAX_SAFE_INTEGER, withBloodline: 2 });
    expect(statements[0]).toContain("count(*), count(`bloodlineId`)");
  });
});
