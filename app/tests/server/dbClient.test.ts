import { describe, expect, it } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { mysqlTable, varchar } from "drizzle-orm/mysql-core";
import { planetScaleFixture } from "../setup/planetscale";

const records = mysqlTable("DriverRecord", {
  id: varchar("id", { length: 191 }).primaryKey(),
});

const createDatabase = () =>
  planetScaleFixture(() => ({
    session: { token: "test-session" },
    fields: [{ name: "id", type: "VARCHAR" }],
    rows: [["hello"]],
    rowsAffected: 1,
  }));

describe("PlanetScale driver SQL binding", () => {
  it("escapes bound strings and preserves array result mapping", async () => {
    const { database, statements } = createDatabase();
    const rows = await database
      .select()
      .from(records)
      .where(eq(records.id, "a' OR 1=1 --"));
    expect(statements).toEqual([
      "select `id` from `DriverRecord` where `DriverRecord`.`id` = 'a\\' OR 1=1 --'",
    ]);
    expect(rows).toEqual([{ id: "hello" }]);
  });

  it("binds prepared placeholders, nulls and large integers", async () => {
    const { database, statements } = createDatabase();
    const prepared = database
      .select()
      .from(records)
      .where(eq(records.id, sql.placeholder("id")))
      .prepare();
    await prepared.execute({ id: "bound" });
    const result = await database.execute(sql`select ${null}, ${9007199254740993n}`);
    expect(statements[0]).toEndWith("= 'bound'");
    expect(statements[1]).toBe("select NULL, 9007199254740993");
    expect(result.rows).toEqual([{ id: "hello" }]);
    expect(result.rowsAffected).toBe(1);
  });

  it("preserves double-quoted SQL literals before bound values", async () => {
    const { database, statements } = createDatabase();
    await database.execute(sql`select "?" as literal, ${"bound"} as value`);
    expect(statements).toEqual(["select \"?\" as literal, 'bound' as value"]);
  });

  it("preserves escaped quotes, identifiers and comments around bound values", async () => {
    const { database, statements } = createDatabase();
    const literals = [
      String.raw`'it\'s ?'`,
      "'it''s ?'",
      String.raw`"say \"?\""`,
      '"say ""?"""',
      "`column``?`",
    ].join(", ");
    await database.execute(
      sql`select ${sql.raw(literals)}, /* ? */ ${"first"}, -- ?\n ${"second"}, # ?\r\n ${"third"}`,
    );
    expect(statements).toEqual([
      `select ${literals}, /* ? */ 'first', -- ?\n 'second', # ?\r\n 'third'`,
    ]);
  });

  it("retains UTC dates, stringified objects and binary parameter escaping", async () => {
    const { database, statements } = createDatabase();
    await database.execute(
      sql`select ${new Date("2026-10-22T10:20:30.456Z")}, ${{ literal: "?" }}, ${Buffer.from([0, 39, 63, 255])}`,
    );
    expect(statements).toEqual([
      "select '2026-10-22 10:20:30.456', '[object Object]', X'00273fff'",
    ]);
  });

  it("uses the same binding inside transactions and rolls back failures", async () => {
    const { database, statements, sessions } = createDatabase();
    await expect(
      database.transaction(async (tx) => {
        await tx.delete(records).where(eq(records.id, "owner's row"));
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    expect(statements).toEqual([
      "BEGIN",
      "delete from `DriverRecord` where `DriverRecord`.`id` = 'owner\\'s row'",
      "ROLLBACK",
    ]);
    expect(sessions).toEqual([
      null,
      { token: "test-session" },
      { token: "test-session" },
    ]);
  });

  it("retains the driver's SQL-only calls and result options", async () => {
    const { client, statements } = createDatabase();
    const result = await client.execute("select '?' as id", {
      as: "array",
      cast: (_field, value) => value?.toUpperCase() ?? null,
    });
    expect(statements).toEqual(["select '?' as id"]);
    expect(result.rows).toEqual([["HELLO"]]);
    expect(result.rowsAffected).toBe(1);
  });

  it("commits nested transactions using the same bound connection", async () => {
    const { database, statements } = createDatabase();
    await database.transaction(async (tx) => {
      await tx.transaction(async (nested) => {
        await nested.delete(records).where(eq(records.id, "owner's row"));
      });
    });
    expect(statements).toEqual([
      "BEGIN",
      "savepoint sp1",
      "delete from `DriverRecord` where `DriverRecord`.`id` = 'owner\\'s row'",
      "release savepoint sp1",
      "COMMIT",
    ]);
  });
});
