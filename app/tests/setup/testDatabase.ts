/**
 * Shared throwaway MySQL for suites that need to execute real SQL.
 *
 * The schema is pushed straight from `drizzle/schema.ts`, so tests run against the same tables,
 * types, indexes and constraints as production instead of a hand-rolled subset that drifts.
 * Setup and teardown happen once per `bun test` run; suites only reset the tables they touch.
 *
 * Point TEST_MYSQL_URL at a database you are happy to lose — setup drops every table in it:
 *   TEST_MYSQL_URL='mysql://root:placeholder@127.0.0.1:3307/tnr_test' bun test
 * Without it, `describeWithDatabase` skips and nothing here connects.
 */
import { execFileSync } from "node:child_process";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { describe } from "vitest";
import type { DrizzleClient } from "@/server/db";
import * as schema from "@/drizzle/schema";

const url = process.env.TEST_MYSQL_URL;
const databaseName = url ? new URL(url).pathname.replace(/^\//, "") : "";

/**
 * Setup drops every table, so refuse anything whose name does not read as disposable. A typo
 * pointing this at a real database would otherwise be unrecoverable.
 */
export const hasTestDatabase = !!url && /test/i.test(databaseName);

/** `describe` that skips wholesale when no test database is configured. */
export const describeWithDatabase = hasTestDatabase ? describe : describe.skip;

let connection: mysql.Connection | undefined;
let client: DrizzleClient | undefined;

/**
 * mysql2 reports writes as `[ResultSetHeader]`; the PlanetScale driver the app is built on
 * reports `{ rowsAffected }`, and server code branches on it. Normalise writes so the code under
 * test behaves as it does in production. Reads pass through untouched.
 */
const normalize = (result: unknown) => {
  const header = Array.isArray(result) ? result[0] : result;
  if (header && typeof header === "object" && "affectedRows" in header) {
    const typed = header as { affectedRows: number; insertId?: number };
    return { rowsAffected: typed.affectedRows, insertId: String(typed.insertId ?? 0) };
  }
  return result;
};

const wrapWriteBuilder = <T extends object>(builder: T): T =>
  new Proxy(builder, {
    get(target, property, receiver) {
      if (property === "then") {
        return (onFulfilled?: (value: unknown) => unknown, onRejected?: () => unknown) =>
          Promise.resolve(target as PromiseLike<unknown>).then(
            (value) => onFulfilled?.(normalize(value)),
            onRejected,
          );
      }
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const next = (value as (...a: unknown[]) => unknown).apply(target, args);
        return next && typeof next === "object" ? wrapWriteBuilder(next as object) : next;
      };
    },
  });

/**
 * Bring the database in line with `drizzle/schema.ts`. `push` diffs against what is already
 * there, so a database left over from a previous run costs a diff rather than 130 CREATE TABLEs,
 * and a schema change since that run is applied (including dropped columns).
 */
export const prepareTestDatabase = async () => {
  if (!hasTestDatabase) return;
  execFileSync(
    "bunx",
    [
      "drizzle-kit",
      "push",
      "--dialect=mysql",
      "--schema=./drizzle/schema.ts",
      `--url=${url}`,
      "--force",
    ],
    { stdio: "pipe" },
  );
  // Rows a previous run left behind would leak into any suite that does not reset that table.
  await truncateEveryTable();
};

const truncateEveryTable = async () => {
  const active = await mysql.createConnection({ uri: url, multipleStatements: true });
  try {
    const [tables] = await active.query<mysql.RowDataPacket[]>(
      "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()",
    );
    if (tables.length === 0) return;
    const truncations = tables.map((row) => `TRUNCATE TABLE \`${row.name}\`;`).join(" ");
    await active.query(
      `SET FOREIGN_KEY_CHECKS = 0; ${truncations} SET FOREIGN_KEY_CHECKS = 1;`,
    );
  } finally {
    await active.end();
  }
};

/**
 * Drizzle client against the shared test database, shaped like the app's `DrizzleClient` so
 * server functions can be called directly. The schema is pushed on first use.
 */
export const getTestDatabase = async (): Promise<DrizzleClient> => {
  if (!client) {
    connection = await mysql.createConnection({ uri: url, multipleStatements: true });
    const database = drizzle(connection, { schema, mode: "default" });
    client = new Proxy(database, {
      get(target, property, receiver) {
        if (property === "insert" || property === "update" || property === "delete") {
          const method = Reflect.get(target, property, receiver) as (
            ...args: unknown[]
          ) => object;
          return (...args: unknown[]) => wrapWriteBuilder(method.apply(target, args));
        }
        return Reflect.get(target, property, receiver);
      },
    }) as unknown as DrizzleClient;
  }
  return client;
};

/** Empty the given tables. Call in `beforeEach` for the tables a suite writes. */
export const resetTables = async (...tables: { _: { name: string } }[]) => {
  const database = await getTestDatabase();
  await Promise.all(tables.map((table) => database.delete(table as never)));
};

/** Run one raw statement, for the few cases that need DDL (applying a migration, for example). */
export const runRawSql = async (statement: string) => {
  await getTestDatabase();
  await connection?.query(statement);
};

/** Current index columns for a table, so a suite can assert on constraints. */
export const indexColumns = async (table: string, keyName: string) => {
  await getTestDatabase();
  const [rows] = (await connection?.query(
    "SELECT COLUMN_NAME AS col, NON_UNIQUE AS nonUnique FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? ORDER BY SEQ_IN_INDEX",
    [table, keyName],
  )) as [{ col: string; nonUnique: number }[], unknown];
  return { columns: rows.map((row) => row.col), unique: rows.every((row) => !row.nonUnique) };
};

/** Release the shared connection. Registered once by the test preload. */
export const closeTestDatabase = async () => {
  await connection?.end();
  connection = undefined;
  client = undefined;
};
