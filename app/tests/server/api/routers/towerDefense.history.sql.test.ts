import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { towerDefenseRun, userData } from "@/drizzle/schema";
import { towerDefenseRouter } from "@/server/api/routers/towerDefense";
import { insertUsers } from "../../../setup/factories";
import { stubRateLimitTransport } from "../../../setup/rateLimit";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  recordQueries,
  resetTables,
} from "../../../setup/testDatabase";

describeWithDatabase("tower defense run history", () => {
  beforeEach(async () => {
    await resetTables(towerDefenseRun, userData);
    await insertUsers([
      { userId: "runner", username: "Runner" },
      { userId: "other-runner", username: "Other" },
    ]);
    stubRateLimitTransport();
    const db = await getTestDatabase();
    await db.insert(towerDefenseRun).values(
      [
        {
          id: "a-newest",
          userId: "runner",
          startedAt: new Date("2026-01-03T00:00:00Z"),
        },
        { id: "z-tie", userId: "runner", startedAt: new Date("2026-01-02T00:00:00Z") },
        { id: "b-tie", userId: "runner", startedAt: new Date("2026-01-02T00:00:00Z") },
        {
          id: "z-oldest",
          userId: "runner",
          startedAt: new Date("2026-01-01T00:00:00Z"),
        },
        {
          id: "foreign",
          userId: "other-runner",
          startedAt: new Date("2026-01-04T00:00:00Z"),
        },
      ].map((run) => ({
        ...run,
        seed: run.id,
        state: {} as typeof towerDefenseRun.$inferInsert.state,
      })),
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it("paginates random IDs by timestamp and stable ID ties without skipping runs", async () => {
    const caller = await callerFor(towerDefenseRouter, "runner");
    const first = await caller.getRunHistory({ limit: 2 });
    const second = await caller.getRunHistory({ limit: 2, cursor: first.nextCursor });
    expect(first.items.map((run) => run.id)).toEqual(["a-newest", "z-tie"]);
    expect(first.nextCursor).toBe("z-tie");
    expect(second.items.map((run) => run.id)).toEqual(["b-tie", "z-oldest"]);
    expect(second.nextCursor).toBeUndefined();
    const trace = await recordQueries(() =>
      caller.getRunHistory({ limit: 1, cursor: "a-newest" }),
    );
    expect(trace.result.items[0]?.id).toBe("z-tie");
    expect(
      trace.statements.filter((statement) => /from `TowerDefenseRun`/i.test(statement)),
    ).toHaveLength(1);
  });

  it("does not accept missing or other-account cursor rows", async () => {
    const caller = await callerFor(towerDefenseRouter, "runner");
    for (const cursor of ["foreign", "missing"])
      expect((await caller.getRunHistory({ limit: 10, cursor })).items).toEqual([]);
  });
});
