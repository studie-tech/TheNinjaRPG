import { describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { userData } from "@/drizzle/schema";
import { scopedRead, withRequestScope } from "@/server/requestScope";
import {
  gateStatements,
  runBehindStatementGate,
  runSharedReadBehindStatementGate,
} from "@/server/statementGate";
import { fetchPvpExperienceAverage } from "@/server/utils/pvpExperience";
import { deferred } from "../setup/deferred";
import { planetScaleFixture } from "../setup/planetscale";

const gatedFixture = () => {
  const fixture = planetScaleFixture((query) =>
    query.startsWith("select")
      ? { fields: [{ name: "userId", type: "VARCHAR" }], rows: [["hero"]] }
      : { rowsAffected: 1 },
  );
  return { ...fixture, database: gateStatements(fixture.database) };
};

/** Let every pending fetch and continuation run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("statement gate", () => {
  for (const shared of [false, true]) {
    const kind = shared ? "shared read" : "read";

    it(`withholds a failed ${kind} and gives a rejected gate precedence`, async () => {
      const failure = new Error("read failed");
      const fixture = planetScaleFixture(() => {
        throw failure;
      });
      const database = gateStatements(fixture.database);
      const gate = deferred();
      const closed = new Error("isolated player");
      const load = () =>
        database.select({ userId: userData.userId }).from(userData).execute();
      let recovered = false;
      const read = withRequestScope(() =>
        runBehindStatementGate(gate.promise, () =>
          (shared ? scopedRead("failed-players", load) : load()).catch((error) => {
            recovered = true;
            return error;
          }),
        ),
      );
      await settle();
      const recoveredBeforeClearance = recovered;
      gate.reject(closed);
      expect(await read).toBe(closed);
      expect(recoveredBeforeClearance).toBe(false);
      expect(fixture.statements).toHaveLength(1);
    });

    it(`forwards a failed ${kind}'s database error only after clearance`, async () => {
      const failure = new Error("read failed");
      const fixture = planetScaleFixture(() => {
        throw failure;
      });
      const database = gateStatements(fixture.database);
      const gate = deferred();
      const load = () =>
        database.select({ userId: userData.userId }).from(userData).execute();
      let recovered = false;
      const read = withRequestScope(() =>
        runBehindStatementGate(gate.promise, () =>
          (shared ? scopedRead("failed-players", load) : load()).catch((error) => {
            recovered = true;
            return error;
          }),
        ),
      );
      await settle();
      const recoveredBeforeClearance = recovered;
      gate.resolve();
      expect(await read).toMatchObject({ cause: failure });
      expect(recoveredBeforeClearance).toBe(false);
      expect(fixture.statements).toHaveLength(1);
    });
  }

  it("rejects a denied shared read without waiting for its loader", async () => {
    const pending = deferred();
    const gate = deferred();
    const closed = new Error("isolated player");
    let rejected = false;
    const read = runBehindStatementGate(gate.promise, () =>
      runSharedReadBehindStatementGate(() => pending.promise).catch((error) => {
        rejected = true;
        return error;
      }),
    );
    gate.reject(closed);
    await settle();
    const rejectedBeforeRead = rejected;
    pending.resolve();
    expect(await read).toBe(closed);
    expect(rejectedBeforeRead).toBe(true);
  });

  it("sends reads at once and withholds their results until the gate clears", async () => {
    const { database, statements } = gatedFixture();
    const gate = deferred();
    let delivered = false;
    const read = runBehindStatementGate(gate.promise, () =>
      database
        .select({ userId: userData.userId })
        .from(userData)
        .then((rows) => {
          delivered = true;
          return rows;
        }),
    );
    await settle();
    expect(statements).toHaveLength(1);
    expect(statements[0]).toStartWith("select");
    expect(delivered).toBe(false);
    gate.resolve();
    expect(await read).toEqual([{ userId: "hero" }]);
  });

  it("sends neither writes nor transactions before the gate clears", async () => {
    const { database, statements } = gatedFixture();
    const gate = deferred();
    const work = runBehindStatementGate(gate.promise, () =>
      Promise.all([
        database
          .update(userData)
          .set({ curHealth: 1 })
          .where(eq(userData.userId, "hero"))
          .execute(),
        database.transaction((tx) =>
          tx.update(userData).set({ curChakra: 1 }).where(eq(userData.userId, "hero")),
        ),
      ]),
    );
    await settle();
    expect(statements).toEqual([]);
    gate.resolve();
    await work;
    expect(statements.some((query) => query.startsWith("update"))).toBe(true);
    expect(statements).toContain("BEGIN");
  });

  it("rejects every statement with the gate's error and never sends a write", async () => {
    const { database, statements } = gatedFixture();
    const gate = deferred();
    const closed = new Error("closed");
    const work = runBehindStatementGate(gate.promise, () =>
      Promise.allSettled([
        database.select().from(userData).execute(),
        database.update(userData).set({ curHealth: 1 }).execute(),
        database.query.userData.findFirst({ columns: { userId: true } }).execute(),
      ]),
    );
    gate.reject(closed);
    expect(await work).toEqual([
      { status: "rejected", reason: closed },
      { status: "rejected", reason: closed },
      { status: "rejected", reason: closed },
    ]);
    await settle();
    expect(statements.every((statement) => statement.startsWith("select"))).toBe(true);
  });

  it("leaves statements outside a gate untouched, however often it is installed", async () => {
    const { database, statements } = gatedFixture();
    expect(gateStatements(database)).toBe(database);
    const result = await database.update(userData).set({ curHealth: 1 });
    expect(result.rowsAffected).toBe(1);
    expect(statements).toHaveLength(1);
  });

  it("shares request reads without sharing a caller's rejected gate", async () => {
    const { database, statements } = gatedFixture();
    const gate = deferred();
    const closed = new Error("isolated player");
    const load = () => database.select({ userId: userData.userId }).from(userData);
    await withRequestScope(async () => {
      const restricted = runBehindStatementGate(gate.promise, () =>
        scopedRead("players", load),
      );
      const ordinary = scopedRead("players", load);
      const results = Promise.allSettled([restricted, ordinary]);
      gate.reject(closed);
      expect(await results).toEqual([
        { status: "rejected", reason: closed },
        { status: "fulfilled", value: [{ userId: "hero" }] },
      ]);
      expect(await scopedRead("players", load)).toEqual([{ userId: "hero" }]);
    });
    expect(statements).toHaveLength(1);
  });

  it("withholds a cached request read until its own caller is cleared", async () => {
    const { database, statements } = gatedFixture();
    const gate = deferred();
    const load = () => database.select({ userId: userData.userId }).from(userData);
    await withRequestScope(async () => {
      await scopedRead("players", load);
      let delivered = false;
      const restricted = runBehindStatementGate(gate.promise, () =>
        scopedRead("players", load).then(() => {
          delivered = true;
        }),
      );
      await settle();
      expect(delivered).toBe(false);
      gate.resolve();
      await restricted;
      expect(delivered).toBe(true);
    });
    expect(statements).toHaveLength(1);
  });

  it("keeps a process-wide average available to callers outside a rejected gate", async () => {
    const fixture = planetScaleFixture(() => ({
      fields: [{ name: "average", type: "DECIMAL" }],
      rows: [["1500"]],
    }));
    const database = gateStatements(fixture.database);
    const gate = deferred();
    const closed = new Error("isolated player");
    const restricted = runBehindStatementGate(gate.promise, () =>
      fetchPvpExperienceAverage(database),
    );
    const ordinary = fetchPvpExperienceAverage(database);
    const results = Promise.allSettled([restricted, ordinary]);
    gate.reject(closed);
    expect(await results).toMatchObject([
      { status: "rejected", reason: closed },
      { status: "fulfilled", value: { value: 1500 } },
    ]);
    expect((await fetchPvpExperienceAverage(database)).value).toBe(1500);
    expect(fixture.statements).toHaveLength(1);
  });

  it("keeps writes and transactions gated inside a shared-read loader", async () => {
    const { database, statements } = gatedFixture();
    const gate = deferred();
    const closed = new Error("isolated player");
    const pending = runBehindStatementGate(gate.promise, () =>
      scopedRead("invalid-loader", () =>
        Promise.all([
          database.update(userData).set({ curHealth: 1 }).execute(),
          database.transaction(async () => {}),
        ]),
      ),
    );
    const result = Promise.allSettled([pending]);
    await settle();
    expect(statements).toEqual([]);
    gate.reject(closed);
    expect(await result).toEqual([{ status: "rejected", reason: closed }]);
    expect(statements).toEqual([]);
  });
});
