import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { DrizzleClient } from "@/server/db";
import { deferred } from "./deferred";

type Operation = "insert" | "update" | "delete" | "execute" | "select";
type SetValues = Record<string, unknown>;
type RawStatement = Parameters<DrizzleClient["execute"]>[0];
type Queries = DrizzleClient["query"];
type QueryTable = keyof Queries;
type QueryMethod = "findFirst" | "findMany";
type Work = Parameters<DrizzleClient["transaction"]>[0];
type Options = Parameters<DrizzleClient["transaction"]>[1];

/** Narrows which statements against a table a hook applies to. */
export type StatementFilter = {
  /** Statement kinds to act on: every write by default, only updates under `when`. */
  operations?: Operation[];
  /** Picks an update by the values it sets. Only the updates it accepts count as statements. */
  when?: (values: SetValues) => boolean;
};

/**
 * Force an interleaving without a second connection. Every statement the application makes
 * is a drizzle builder or a raw `execute`, and both run when they are awaited, so wrapping
 * that await is enough to slip another operation into the exact gap a race needs. Each
 * statement against `table` goes through `around`, which decides whether and when `run`
 * sends it and what the caller sees, on the same connection and against whatever the
 * hook left behind.
 */
export const aroundStatements = (
  client: DrizzleClient,
  table: object,
  around: (run: () => Promise<unknown>) => Promise<unknown>,
  {
    when,
    operations = when ? ["update"] : ["insert", "update", "delete", "execute"],
  }: StatementFilter = {},
): DrizzleClient => {
  const touches = (query: unknown): boolean => {
    const chunks = (query as { queryChunks?: unknown[] })?.queryChunks ?? [];
    return chunks.some(
      (chunk) => chunk === table || (chunk as { table?: unknown })?.table === table,
    );
  };
  const wrapBuilder = (
    builder: object,
    statement: { values?: SetValues } = {},
  ): object =>
    new Proxy(builder, {
      get(target, property, receiver) {
        if (
          property === "then" ||
          property === "catch" ||
          property === "finally" ||
          property === "execute"
        ) {
          const run = () => Promise.resolve(target as PromiseLike<unknown>);
          const selected =
            !when || (statement.values !== undefined && when(statement.values));
          const settle = selected ? around(run) : run();
          return property === "execute" ? () => settle : settle[property].bind(settle);
        }
        const value = Reflect.get(target, property, receiver);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          if (property === "set") statement.values = args[0] as SetValues;
          const result = value.apply(target, args);
          if (result === target || result === receiver) return receiver;
          return result && typeof result === "object" && !(result instanceof Promise)
            ? wrapBuilder(result, statement)
            : result;
        };
      },
    });
  return new Proxy(client, {
    get(target, property, receiver) {
      if (!operations.includes(property as Operation))
        return Reflect.get(target, property, receiver);
      if (property === "insert" || property === "update" || property === "delete") {
        return (subject: object) => {
          const builder = (target[property] as (t: object) => object)(subject);
          return subject === table ? wrapBuilder(builder) : builder;
        };
      }
      if (property === "select") {
        return (...args: unknown[]) =>
          new Proxy((target.select as (...a: unknown[]) => object)(...args), {
            get(selection, key, proxy) {
              if (key !== "from") return Reflect.get(selection, key, proxy);
              return (subject: object) => {
                const query = (
                  selection as unknown as { from: (t: object) => object }
                ).from(subject);
                return subject === table ? wrapBuilder(query) : query;
              };
            },
          });
      }
      return (query: unknown) => {
        const run = () => (target.execute as (q: unknown) => Promise<unknown>)(query);
        return touches(query) ? around(run) : run();
      };
    },
  }) as DrizzleClient;
};

/**
 * A client that runs each action, in order, just before the next statement against
 * `table` executes. Once the actions are used up the client is transparent.
 */
export const beforeStatements = (
  client: DrizzleClient,
  table: object,
  actions: Array<() => unknown>,
  filter?: StatementFilter,
): DrizzleClient => {
  const queue = [...actions];
  return aroundStatements(
    client,
    table,
    async (run) => {
      await queue.shift()?.();
      return run();
    },
    filter,
  );
};

/** A client whose next `count` statements against `table` fail instead of running. */
export const failStatements = (
  client: DrizzleClient,
  table: object,
  count = 1,
  filter?: StatementFilter,
): DrizzleClient => {
  let remaining = count;
  return aroundStatements(
    client,
    table,
    async (run) => {
      if (remaining <= 0) return run();
      remaining -= 1;
      throw new Error("Statement failed on purpose");
    },
    filter,
  );
};

/**
 * A client that hands every raw `execute` to `handle`, whatever it touches, which decides
 * whether and when `run` sends it. `sqlText` reads the statement.
 */
export const interceptExecute = (
  client: DrizzleClient,
  handle: (
    query: RawStatement,
    run: () => ReturnType<DrizzleClient["execute"]>,
  ) => unknown,
): DrizzleClient =>
  new Proxy(client, {
    get(target, property, receiver) {
      if (property !== "execute") return Reflect.get(target, property, receiver);
      return (query: RawStatement) => handle(query, () => target.execute(query));
    },
  });

/** The SQL text of a statement, for matching one out of what `interceptExecute` sees. */
export const sqlText = (query: RawStatement) =>
  typeof query === "string" ? query : new MySqlDialect().sqlToQuery(query.getSQL()).sql;

/**
 * A client whose relational reads of `table` go through `overrides`. Each receives the real
 * method and the caller's arguments, so it can pause, skew or replace that read; every other
 * method on the table keeps working. Nest calls to override several tables.
 */
export const overrideQuery = <Table extends QueryTable>(
  client: DrizzleClient,
  table: Table,
  overrides: {
    [Method in QueryMethod]?: (
      read: Queries[Table][Method],
      ...args: Parameters<Queries[Table][Method]>
    ) => unknown;
  },
): DrizzleClient => {
  const reads = new Proxy(client.query[table] as object, {
    get(target, property, receiver) {
      const override = overrides[property as QueryMethod] as
        | ((read: unknown, ...args: unknown[]) => unknown)
        | undefined;
      const value = Reflect.get(target, property, receiver);
      if (!override) return value;
      return (...args: unknown[]) => override(value.bind(target), ...args);
    },
  });
  return new Proxy(client, {
    get(target, property, receiver) {
      return property === "query"
        ? { ...target.query, [table]: reads }
        : Reflect.get(target, property, receiver);
    },
  });
};

/** A client whose `transaction` is replaced; `open` starts a real one for the given work. */
const replaceTransaction = (
  client: DrizzleClient,
  transact: (work: Work, open: (work: Work) => Promise<unknown>) => unknown,
): DrizzleClient =>
  new Proxy(client, {
    get(target, property, receiver) {
      if (property !== "transaction") return Reflect.get(target, property, receiver);
      return (work: Work, options?: Options) =>
        transact(work, (next) => target.transaction(next, options));
    },
  });

/**
 * A client whose transactions run on `wrap(tx)`. Statements issued on `tx` bypass the client
 * they started from, so this is how the hooks above reach them. `attempt` counts this client's
 * transactions from 1, so a test can single out a retry or a later transaction.
 */
export const inTransactions = (
  client: DrizzleClient,
  wrap: (tx: DrizzleClient, attempt: number) => DrizzleClient,
): DrizzleClient => {
  let attempts = 0;
  return replaceTransaction(client, (work, open) => {
    const attempt = ++attempts;
    return open((tx) =>
      work(wrap(tx as unknown as DrizzleClient, attempt) as unknown as typeof tx),
    );
  });
};

/** A client that runs `hook` before each transaction opens; `call` counts them from 1. */
export const beforeTransaction = (
  client: DrizzleClient,
  hook: (call: number) => unknown,
): DrizzleClient => {
  let calls = 0;
  return replaceTransaction(client, async (work, open) => {
    await hook(++calls);
    return open(work);
  });
};

/** A client that fails the test's request if anything opens a transaction on it. */
export const withoutTransactions = (
  client: DrizzleClient,
  message = "Unexpected transaction",
): DrizzleClient =>
  replaceTransaction(client, () => {
    throw new Error(message);
  });

/**
 * A client whose first `failures` transactions finish their work and then throw `message` in
 * place of committing, so everything they did rolls back. `attempts` counts those that finished.
 */
export const failCommits = (
  client: DrizzleClient,
  failures: number,
  message = "Commit failed on purpose",
) => {
  let attempts = 0;
  return {
    client: replaceTransaction(client, (work, open) =>
      open(async (tx) => {
        const result = await work(tx);
        if (++attempts <= failures) throw new Error(message);
        return result;
      }),
    ),
    attempts: () => attempts,
  };
};

/** A wait that returns only once `count` callers have arrived, so a race's competitors overlap. */
export const barrier = (count: number) => {
  const { promise, resolve } = deferred<void>();
  let arrivals = 0;
  return async () => {
    if (++arrivals >= count) resolve();
    await promise;
  };
};

/**
 * A client whose reads of `table` complete and then wait for `count` of them, so competing
 * requests hold the same snapshot before their guarded writes race.
 */
export const holdReads = (
  client: DrizzleClient,
  table: QueryTable,
  count: number,
  method: QueryMethod = "findFirst",
): DrizzleClient => {
  const arrive = barrier(count);
  return overrideQuery(client, table, {
    [method]: async (read: (...args: unknown[]) => unknown, ...args: unknown[]) => {
      const result = await read(...args);
      await arrive();
      return result;
    },
  });
};

/** Check until `check` passes. False means it never did, and the caller decides what that fails. */
export const pollUntil = async (
  check: () => boolean | Promise<boolean>,
  { attempts = 100, intervalMs = 1 } = {},
) => {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
};
