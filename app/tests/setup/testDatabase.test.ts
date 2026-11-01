import { expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { describeWithDatabase, getTestDatabase, recordQueries, runRawSql } from "./testDatabase";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

describeWithDatabase("SQL query recorder", () => {
  it("counts parallel requests once even when the local pool queues them", async () => {
    const database = await getTestDatabase();
    const acquired = deferred();
    const release = deferred();
    let started = 0;
    // Occupy nine of the ten connections so independent requests share one connection.
    const transactions = Array.from({ length: 9 }, () => database.transaction(async () => {
      if (++started === 9) acquired.resolve();
      await release.promise;
    }));
    await acquired.promise;
    try {
      const trace = await recordQueries(() => Promise.all([runRawSql("SELECT 1"), runRawSql("SELECT 2")]));
      expect(trace.statements).toEqual(["SELECT 1", "SELECT 2"]);
      expect(trace.roundTrips).toBe(1);
    } finally {
      release.resolve();
      await Promise.all(transactions);
    }
  });

  it("counts an additional application await as another round trip", async () => {
    const trace = await recordQueries(async () => {
      await runRawSql("SELECT 1");
      await runRawSql("SELECT 2");
    });
    expect(trace.statements).toEqual(["SELECT 1", "SELECT 2"]);
    expect(trace.roundTrips).toBe(2);
  });

  it("keeps bound values and limits in recorded text queries", async () => {
    const database = await getTestDatabase();
    const trace = await recordQueries(() => database.execute(sql`SELECT ${"bound"} LIMIT ${1}`));
    expect(trace.statements).toEqual(["SELECT 'bound' LIMIT 1"]);
    expect(trace.roundTrips).toBe(1);
  });

  it("includes transaction boundaries and each sequential statement exactly once", async () => {
    const database = await getTestDatabase();
    const trace = await recordQueries(() => database.transaction(async (transaction) => {
      await transaction.execute(sql`SELECT 1`);
      await transaction.execute(sql`SELECT 2`);
    }));
    expect(trace.statements).toEqual(["begin", "SELECT 1", "SELECT 2", "commit"]);
    expect(trace.roundTrips).toBe(4);
  });

  it("finishes recording a failed request before the next statement", async () => {
    const trace = await recordQueries(async () => {
      await expect(runRawSql("SELECT missing_column")).rejects.toThrow();
      await runRawSql("SELECT 1");
    });
    expect(trace.statements).toEqual(["SELECT missing_column", "SELECT 1"]);
    expect(trace.roundTrips).toBe(2);
  });

  it("records rollback and the next query after a transaction fails", async () => {
    const database = await getTestDatabase();
    const trace = await recordQueries(async () => {
      await expect(database.transaction(async (transaction) => {
        await transaction.execute(sql`SELECT missing_column`);
      })).rejects.toThrow();
      await runRawSql("SELECT 1");
    });
    expect(trace.statements).toEqual(["begin", "SELECT missing_column", "rollback", "SELECT 1"]);
    expect(trace.roundTrips).toBe(4);
  });
});
