import { expect, it, vi } from "bun:test";
import { sql } from "drizzle-orm";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { deferred } from "./deferred";
import {
  describeWithDatabase,
  dropEveryTrigger,
  getTestDatabase,
  recordQueries,
  runRawSql,
  triggerNames,
} from "./testDatabase";

describeWithDatabase("SQL query recorder", () => {
  it.each(["query", "execute"] as const)(
    "retries an autocommit deadlock beneath one recorded %s submission",
    async (method) => {
      const driver = ((await getTestDatabase()) as unknown as { $client: Pool })
        .$client;
      const fail = () => {
        throw new Error("Deadlock found when trying to get lock");
      };
      const transport = vi
        .spyOn(driver.pool, method)
        .mockImplementationOnce(fail)
        .mockImplementationOnce(fail);
      try {
        const trace = await recordQueries(() =>
          method === "query"
            ? driver.query<RowDataPacket[]>("SELECT 1 AS recovered")
            : driver.execute<RowDataPacket[]>("SELECT 1 AS recovered"),
        );
        expect(trace.result[0][0]?.recovered).toBe(1);
        expect(transport).toHaveBeenCalledTimes(3);
        expect(trace.statements).toEqual(["SELECT 1 AS recovered"]);
        expect(trace.roundTrips).toBe(1);
      } finally {
        transport.mockRestore();
      }
    },
  );

  it("propagates an autocommit deadlock after three attempts", async () => {
    const driver = ((await getTestDatabase()) as unknown as { $client: Pool }).$client;
    const failure = new Error("Deadlock found when trying to get lock");
    const transport = vi.spyOn(driver.pool, "query").mockImplementation(() => {
      throw failure;
    });
    try {
      await expect(driver.query("SELECT 1")).rejects.toBe(failure);
      expect(transport).toHaveBeenCalledTimes(3);
    } finally {
      transport.mockRestore();
    }
  });

  it.each([
    ["query", false],
    ["query", true],
    ["execute", false],
    ["execute", true],
  ] as const)(
    "does not replay a deadlocked %s batch (options: %s)",
    async (method, asOptions) => {
      const driver = ((await getTestDatabase()) as unknown as { $client: Pool })
        .$client;
      const failure = new Error("Deadlock found when trying to get lock");
      const transport = vi.spyOn(driver.pool, method).mockImplementation(() => {
        throw failure;
      });
      const statement =
        "UPDATE fixture SET counter = counter + 1; UPDATE fixture SET counter = counter + 1";
      try {
        await expect(
          method === "query"
            ? asOptions
              ? driver.query({ sql: statement })
              : driver.query(statement)
            : asOptions
              ? driver.execute({ sql: statement })
              : driver.execute(statement),
        ).rejects.toBe(failure);
        expect(transport).toHaveBeenCalledTimes(1);
      } finally {
        transport.mockRestore();
      }
    },
  );

  it("does not retry an ambiguous autocommit transport failure", async () => {
    const driver = ((await getTestDatabase()) as unknown as { $client: Pool }).$client;
    const failure = new Error("Connection lost");
    const transport = vi.spyOn(driver.pool, "query").mockImplementation(() => {
      throw failure;
    });
    try {
      await expect(driver.query("SELECT 1")).rejects.toBe(failure);
      expect(transport).toHaveBeenCalledTimes(1);
    } finally {
      transport.mockRestore();
    }
  });

  it.each(["query", "execute"] as const)(
    "does not replay a transaction's deadlocked %s statement",
    async (method) => {
      const driver = ((await getTestDatabase()) as unknown as { $client: Pool })
        .$client;
      const connection = await driver.getConnection();
      const failure = new Error("Deadlock found when trying to get lock");
      await connection.beginTransaction();
      const transport = vi
        .spyOn(connection.connection, method)
        .mockImplementationOnce(() => {
          throw failure;
        });
      try {
        await expect(
          method === "query"
            ? connection.query("SELECT 1")
            : connection.execute("SELECT 1"),
        ).rejects.toBe(failure);
        expect(transport).toHaveBeenCalledTimes(1);
      } finally {
        transport.mockRestore();
        await connection.rollback();
        connection.release();
      }
    },
  );

  it("counts parallel requests once even when the local pool queues them", async () => {
    const database = await getTestDatabase();
    const acquired = deferred<void>();
    const release = deferred<void>();
    let started = 0;
    // Occupy nine of the ten connections so independent requests share one connection.
    const transactions = Array.from({ length: 9 }, () =>
      database.transaction(async () => {
        if (++started === 9) acquired.resolve();
        await release.promise;
      }),
    );
    await acquired.promise;
    try {
      const trace = await recordQueries(() =>
        Promise.all([runRawSql("SELECT 1"), runRawSql("SELECT 2")]),
      );
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
    const trace = await recordQueries(() =>
      database.execute(sql`SELECT ${"bound"} LIMIT ${1}`),
    );
    expect(trace.statements).toEqual(["SELECT 'bound' LIMIT 1"]);
    expect(trace.roundTrips).toBe(1);
  });

  it.each(["query", "execute"] as const)(
    "records bind values from %s options",
    async (method) => {
      const driver = ((await getTestDatabase()) as unknown as { $client: Pool })
        .$client;
      const options = {
        sql: "SELECT ? AS recorded LIMIT ?",
        values: ["bound", 1],
      };
      const trace = await recordQueries(() =>
        method === "query"
          ? driver.query<RowDataPacket[]>(options)
          : driver.execute<RowDataPacket[]>(options),
      );
      expect(trace.result[0].map((row) => row.recorded)).toEqual(["bound"]);
      expect(trace.statements).toEqual(["SELECT 'bound' AS recorded LIMIT 1"]);
      expect(trace.roundTrips).toBe(1);
    },
  );

  it.each([
    ["query", "bound", 1],
    ["execute", "ignored", 2],
  ] as const)(
    "records effective bind values for %s",
    async (method, recorded, limit) => {
      const driver = ((await getTestDatabase()) as unknown as { $client: Pool })
        .$client;
      const options = {
        sql: "SELECT ? AS recorded LIMIT ?",
        values: ["ignored", 2],
      };
      const trace = await recordQueries(() =>
        method === "query"
          ? driver.query<RowDataPacket[]>(options, ["bound", 1])
          : driver.execute<RowDataPacket[]>(options, ["bound", 1]),
      );
      expect(trace.result[0].map((row) => row.recorded)).toEqual([recorded]);
      expect(trace.statements).toEqual([
        `SELECT '${recorded}' AS recorded LIMIT ${limit}`,
      ]);
      expect(trace.roundTrips).toBe(1);
    },
  );

  it("records separate bind values for prepared execution", async () => {
    const driver = ((await getTestDatabase()) as unknown as { $client: Pool }).$client;
    const trace = await recordQueries(() =>
      driver.execute<RowDataPacket[]>("SELECT ? AS recorded LIMIT ?", ["bound", 1]),
    );
    expect(trace.result[0].map((row) => row.recorded)).toEqual(["bound"]);
    expect(trace.statements).toEqual(["SELECT 'bound' AS recorded LIMIT 1"]);
    expect(trace.roundTrips).toBe(1);
  });

  it("includes transaction boundaries and each sequential statement exactly once", async () => {
    const database = await getTestDatabase();
    const trace = await recordQueries(() =>
      database.transaction(async (transaction) => {
        await transaction.execute(sql`SELECT 1`);
        await transaction.execute(sql`SELECT 2`);
      }),
    );
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
      await expect(
        database.transaction(async (transaction) => {
          await transaction.execute(sql`SELECT missing_column`);
        }),
      ).rejects.toThrow();
      await runRawSql("SELECT 1");
    });
    expect(trace.statements).toEqual([
      "begin",
      "SELECT missing_column",
      "rollback",
      "SELECT 1",
    ]);
    expect(trace.roundTrips).toBe(4);
  });
});

describeWithDatabase("leftover triggers", () => {
  it("drops every trigger a killed run left behind", async () => {
    await runRawSql(
      "CREATE TRIGGER left_on_update BEFORE UPDATE ON UserData FOR EACH ROW SET NEW.money = 0",
    );
    await runRawSql(
      "CREATE TRIGGER left_on_delete BEFORE DELETE ON Battle FOR EACH ROW SET @left_behind = 1",
    );
    expect(await triggerNames()).toEqual(["left_on_delete", "left_on_update"]);

    await dropEveryTrigger();

    expect(await triggerNames()).toEqual([]);
  });

  it("leaves a database without triggers alone", async () => {
    await dropEveryTrigger();
    expect(await triggerNames()).toEqual([]);
  });
});
