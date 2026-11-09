/**
 * Shared throwaway MySQL for suites that need to execute real SQL.
 *
 * The schema is pushed straight from `drizzle/schema.ts`, so tests run against the same tables,
 * types, indexes and constraints as production instead of a hand-rolled subset that drifts.
 * Setup happens once per `bun test` run; suites only reset the tables they touch.
 *
 * Every table in the target database is truncated, so both variables are required:
 *   TEST_MYSQL_ALLOW_DESTRUCTIVE=1 \
 *   TEST_MYSQL_URL='mysql://root:placeholder@127.0.0.1:3307/tnr_test' bun test
 * With neither set, `describeWithDatabase` skips and nothing here connects.
 */
import { execFileSync } from "node:child_process";
import { describe } from "bun:test";
import type {
  AnyProcedure,
  inferProcedureInput,
  inferProcedureOutput,
} from "@trpc/server";
import { getTableName, type Table } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import type { DrizzleClient } from "@/server/db";
import * as schema from "@/drizzle/schema";
import { withAfterTasks } from "./after";
import { pollUntil } from "./statements";
import { readTestDatabaseUrl } from "./testDatabaseConfig";

const url = readTestDatabaseUrl(process.env);

/** Real-SQL suites run only with explicitly acknowledged throwaway database configuration. */
export const hasTestDatabase = !!url;

/** `describe` that skips wholesale when no test database is configured. */
export const describeWithDatabase = hasTestDatabase ? describe : describe.skip;

let pool: mysql.Pool | undefined;
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
        return (
          onFulfilled?: (value: unknown) => unknown,
          onRejected?: () => unknown,
        ) =>
          Promise.resolve(target as PromiseLike<unknown>).then(
            (value) => onFulfilled?.(normalize(value)),
            onRejected,
          );
      }
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const next = (value as (...a: unknown[]) => unknown).apply(target, args);
        return next && typeof next === "object"
          ? wrapWriteBuilder(next as object)
          : next;
      };
    },
  });

/** Normalise `execute` results and write builders on a client and on the transactions it opens. */
const normalizeWrites = <T extends object>(database: T): T =>
  new Proxy(database, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as (
        ...args: unknown[]
      ) => unknown;
      if (property === "execute") {
        return async (...args: unknown[]) => normalize(await value.apply(target, args));
      }
      if (property === "insert" || property === "update" || property === "delete") {
        return (...args: unknown[]) =>
          wrapWriteBuilder(value.apply(target, args) as object);
      }
      if (property === "transaction") {
        return (callback: (tx: unknown) => Promise<unknown>, ...rest: unknown[]) =>
          value.call(
            target,
            async (tx: object) => callback(normalizeWrites(tx)),
            ...rest,
          );
      }
      return value;
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
  await dropEveryTrigger();
};

const truncateEveryTable = async () => {
  const active = await mysql.createConnection({ uri: url, multipleStatements: true });
  try {
    const [tables] = await active.query<mysql.RowDataPacket[]>(
      "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()",
    );
    if (tables.length === 0) return;
    const truncations = tables
      .map((row) => `TRUNCATE TABLE \`${row.name}\`;`)
      .join(" ");
    await active.query(
      `SET FOREIGN_KEY_CHECKS = 0; ${truncations} SET FOREIGN_KEY_CHECKS = 1;`,
    );
  } finally {
    await active.end();
  }
};

/**
 * Drizzle client against the shared test database, shaped like the app's `DrizzleClient` so
 * server functions can be called directly. The schema is pushed once per run by
 * `prepareTestDatabase`, which `setup/preload.ts` registers.
 *
 * This is a pool, not a single connection. Production talks to PlanetScale over HTTP, so
 * every query in a `Promise.all` is an independent request. A lone mysql2 connection cannot
 * do that: interleaved packets come back as empty reads (`User not found`, `Missing store
 * receipt`) even though the rows are there. The pool is the local equivalent of that
 * concurrent model, which is the whole point of driving the real procedures.
 */
export const getTestDatabase = async (): Promise<DrizzleClient> => {
  if (!client) {
    pool = mysql.createPool({
      uri: url,
      multipleStatements: true,
      connectionLimit: 10,
    });
    instrumentQueries(pool as unknown as Parameters<typeof instrumentQueries>[0]);
    const getConnection = pool.getConnection.bind(pool);
    pool.getConnection = async () => {
      const connection = await getConnection();
      instrumentQueries(
        connection as unknown as Parameters<typeof instrumentQueries>[0],
      );
      return connection;
    };
    // Production's PlanetScale driver builds relational queries without lateral joins.
    client = normalizeWrites(
      drizzle(pool, { schema, mode: "planetscale" }),
    ) as unknown as DrizzleClient;
  }
  return client;
};

export const peekTestDatabase = (): DrizzleClient | null => client ?? null;

/**
 * Empty the given tables. Call in `beforeEach` for the tables a suite writes.
 *
 * Suites that open isolated Pyramid runs also reset `questHistory` in `afterEach`:
 * enforcePyramidIsolation rejects restricted mutations for any user with an open isolated
 * row, so a leftover run would break later files that reuse the same user ids.
 *
 * Runs as one session with foreign-key checks off. Parallel drizzle `DELETE`s on
 * the pool race parent against child and leave rows behind (duplicate userId on
 * the next insert, or a leftover revocation that silently retires the next
 * grant). `TRUNCATE` is not a substitute: MySQL still refuses to truncate a
 * parent that other tables reference, even with foreign-key checks off.
 */
export const resetTables = async (...tables: Table[]) => {
  if (!url || tables.length === 0) return;
  const deletions = tables
    .map((table) => `DELETE FROM \`${getTableName(table)}\`;`)
    .join(" ");
  const active = await mysql.createConnection({ uri: url, multipleStatements: true });
  try {
    await active.query(
      `SET FOREIGN_KEY_CHECKS = 0; ${deletions} SET FOREIGN_KEY_CHECKS = 1;`,
    );
  } finally {
    await active.end();
  }
};

/** Run one raw statement, for the few cases that need DDL (applying a migration, for example). */
export const runRawSql = async (statement: string) => {
  await getTestDatabase();
  await pool?.query(statement);
};

/** Run one raw read and return its rows, for fixture tables outside the schema. */
export const queryRawSql = async <Row>(statement: string) => {
  await getTestDatabase();
  const result = (await pool?.query(statement)) as [Row[], unknown] | undefined;
  return result?.[0] ?? [];
};

/** Triggers present in the test database, sorted by name. */
export const triggerNames = async () => {
  await getTestDatabase();
  const [rows] = (await pool?.query(
    "SELECT trigger_name AS name FROM information_schema.triggers WHERE trigger_schema = DATABASE()",
  )) as [mysql.RowDataPacket[], unknown];
  return rows.map((row) => row.name as string).sort();
};

/**
 * The schema defines no triggers, so any trigger here is a fault injection from a run killed
 * before its cleanup. Truncation leaves them in place, and they fail unrelated suites.
 */
export const dropEveryTrigger = async () => {
  for (const name of await triggerNames()) await runRawSql(`DROP TRIGGER \`${name}\``);
};

/** Current index columns for a table, so a suite can assert on constraints. */
export const indexColumns = async (table: string, keyName: string) => {
  await getTestDatabase();
  const [rows] = (await pool?.query(
    "SELECT COLUMN_NAME AS col, NON_UNIQUE AS nonUnique FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? ORDER BY SEQ_IN_INDEX",
    [table, keyName],
  )) as [{ col: string; nonUnique: number }[], unknown];
  return {
    columns: rows.map((row) => row.col),
    unique: rows.every((row) => !row.nonUnique),
  };
};

/**
 * Whether a session comes to wait on a lock held in `table`, optionally narrowed to the held
 * row's LOCK_DATA or the requested LOCK_MODE. Returning false lets a caller settle its in-flight
 * work before asserting.
 */
export const lockWaitObserved = async ({
  table,
  heldLockData,
  requestedMode,
}: {
  table: string;
  heldLockData?: string;
  requestedMode?: "S" | "X";
}) => {
  await getTestDatabase();
  const filters = [
    ...(heldLockData ? ["AND blocking.LOCK_DATA LIKE ?"] : []),
    ...(requestedMode ? ["AND requested.LOCK_MODE LIKE ?"] : []),
  ];
  const params = [
    table,
    table,
    ...(heldLockData ? [`%${heldLockData}%`] : []),
    ...(requestedMode ? [`${requestedMode}%`] : []),
  ];
  return pollUntil(
    async () => {
      const [rows] = (await pool?.query(
        `SELECT COUNT(*) AS waiting FROM performance_schema.data_lock_waits AS waits
       INNER JOIN performance_schema.data_locks AS requested
         ON requested.ENGINE_LOCK_ID = waits.REQUESTING_ENGINE_LOCK_ID
       INNER JOIN performance_schema.data_locks AS blocking
         ON blocking.ENGINE_LOCK_ID = waits.BLOCKING_ENGINE_LOCK_ID
       WHERE requested.OBJECT_SCHEMA = DATABASE() AND requested.OBJECT_NAME = ?
         AND blocking.OBJECT_SCHEMA = DATABASE() AND blocking.OBJECT_NAME = ?
         ${filters.join(" ")}`,
        params,
      )) as [{ waiting: number }[], unknown];
      return Number(rows[0]?.waiting) > 0;
    },
    { attempts: 200, intervalMs: 10 },
  );
};

type QueryRecorder = { statements: string[]; roundTrips: number; inFlight: number };
let recorder: QueryRecorder | undefined;

/**
 * Count promise API submissions before pool acquisition, or directly on a transaction's
 * checked-out connection. Each statement is recorded once, including transaction boundaries.
 */
const instrumentQueries = (connection: {
  query: (...args: unknown[]) => unknown;
  execute: (...args: unknown[]) => unknown;
}) => {
  for (const method of ["query", "execute"] as const) {
    const original = connection[method].bind(connection);
    connection[method] = async (...args: unknown[]) => {
      const active = recorder;
      if (!active) return original(...args);
      const [first, values] = args;
      const options =
        typeof first === "string"
          ? undefined
          : (first as { sql?: string; values?: unknown });
      const statement = typeof first === "string" ? first : String(options?.sql);
      // mysql2 prefers execute's embedded values, but query's separate argument wins.
      const bindValues =
        method === "execute"
          ? options?.values || values
          : values === undefined
            ? options?.values
            : values;
      active.statements.push(
        mysql.format(statement, bindValues as Parameters<typeof mysql.format>[1]),
      );
      if (active.inFlight === 0) active.roundTrips += 1;
      active.inFlight += 1;
      try {
        return await original(...args);
      } finally {
        active.inFlight -= 1;
      }
    };
  }
};

/**
 * Return SQL statements and sequential application query waves to pin a hot path's cost.
 * Requests are pending while waiting for a local pool connection, so pool contention
 * cannot inflate the count. Transaction boundaries and statements are included.
 */
export const recordQueries = async <T>(work: () => Promise<T>) => {
  await getTestDatabase();
  const active: QueryRecorder = { statements: [], roundTrips: 0, inFlight: 0 };
  recorder = active;
  try {
    const result = await work();
    return { result, statements: active.statements, roundTrips: active.roundTrips };
  } finally {
    recorder = undefined;
  }
};

/** Release the shared pool. Registered once by the test preload. */
export const closeTestDatabase = async () => {
  await pool?.end();
  pool = undefined;
  client = undefined;
};

/**
 * A procedure's resolver without its middleware or input parsing, for suites that exercise
 * the handler itself on an explicit context.
 */
export const resolverOf = <Procedure extends AnyProcedure>(procedure: Procedure) =>
  (
    procedure._def as unknown as {
      resolver: (options: {
        ctx: object;
        input: inferProcedureInput<Procedure>;
        type?: string;
        path?: string;
      }) => Promise<inferProcedureOutput<Procedure>>;
    }
  ).resolver;

/**
 * Build a tRPC caller for `router`, backed by the throwaway database and acting as `userId`.
 *
 * Routers are worth testing directly: the guards, level gates and compare-and-swap
 * predicates live in the procedures rather than in the helpers they call, and a mocked
 * client would only prove which query was written, not which row the engine ends up with.
 */
export const callerFor = async <Context, Caller>(
  router: { createCaller: (context: Context) => Caller },
  userId: string,
): Promise<Caller> =>
  withAfterTasks(
    router.createCaller({ drizzle: await getTestDatabase(), userId } as Context),
  );

export const callerForDatabase = <Context, Caller>(
  router: { createCaller: (context: Context) => Caller },
  userId: string,
  database: DrizzleClient,
): Caller =>
  withAfterTasks(
    router.createCaller({
      drizzle: withEmptyIsolationHistory(database),
      userId,
    } as Context),
  );

/** Partial test clients default to no isolated run; supplied history stubs and real clients stay intact. */
export const withEmptyIsolationHistory = <Client extends object>(
  database: Client,
): Client => {
  const partial = database as Client & {
    query?: { questHistory?: { findFirst?: unknown } };
  };
  if (typeof partial.query?.questHistory?.findFirst === "function") return database;
  return {
    ...database,
    query: {
      ...partial.query,
      questHistory: {
        ...partial.query?.questHistory,
        findFirst: async () => undefined,
      },
    },
  };
};
