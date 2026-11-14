import { describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { userData } from "@/drizzle/schema";
import { gateStatements, runBehindStatementGate } from "@/server/statementGate";
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
});
