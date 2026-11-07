import type { DrizzleClient } from "@/server/db";
import { deferred } from "./deferred";

type Hook = () => Promise<void>;

/**
 * Force an interleaving without a second connection. Every write the application makes
 * is a drizzle builder or a raw `execute`, and both run when they are awaited, so wrapping
 * that await is enough to slip another operation into the exact gap a race needs: the
 * hook runs just before the next statement against `table` executes, on the same
 * connection, and the statement then proceeds against whatever the hook left behind.
 */
const interpose = (client: DrizzleClient, table: object, hook: Hook): DrizzleClient => {
  const touches = (query: unknown): boolean => {
    const chunks = (query as { queryChunks?: unknown[] })?.queryChunks ?? [];
    return chunks.some(
      (chunk) => chunk === table || (chunk as { table?: unknown })?.table === table,
    );
  };
  const hooked = <T>(run: () => Promise<T>): Promise<T> => hook().then(run);
  const wrapBuilder = (builder: object): object =>
    new Proxy(builder, {
      get(target, property, receiver) {
        if (property === "then") {
          const settle = hooked(() => Promise.resolve(target as PromiseLike<unknown>));
          return settle.then.bind(settle);
        }
        const value = Reflect.get(target, property, receiver);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          const result = value.apply(target, args);
          if (result === target) return receiver;
          return result && typeof result === "object" && !(result instanceof Promise)
            ? wrapBuilder(result)
            : result;
        };
      },
    });
  return new Proxy(client, {
    get(target, property, receiver) {
      if (property === "insert" || property === "update" || property === "delete") {
        return (subject: object) => {
          const builder = (target[property] as (t: object) => object)(subject);
          return subject === table ? wrapBuilder(builder) : builder;
        };
      }
      if (property === "execute") {
        return (query: unknown) =>
          touches(query)
            ? hooked(() => (target.execute as (q: unknown) => Promise<unknown>)(query))
            : (target.execute as (q: unknown) => Promise<unknown>)(query);
      }
      return Reflect.get(target, property, receiver);
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
  actions: Array<() => Promise<unknown>>,
): DrizzleClient => {
  const queue = [...actions];
  return interpose(client, table, async () => {
    await queue.shift()?.();
  });
};

/** A client whose next `count` statements against `table` fail instead of running. */
export const failStatements = (
  client: DrizzleClient,
  table: object,
  count = 1,
): DrizzleClient => {
  let remaining = count;
  return interpose(client, table, async () => {
    if (remaining > 0) {
      remaining -= 1;
      throw new Error("Statement failed on purpose");
    }
  });
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
  table: keyof DrizzleClient["query"],
  count: number,
  method: "findFirst" | "findMany" = "findFirst",
): DrizzleClient => {
  const arrive = barrier(count);
  const reads = new Proxy(client.query[table] as object, {
    get(target, property, receiver) {
      if (property !== method) return Reflect.get(target, property, receiver);
      return async (...args: unknown[]) => {
        const read = target as Record<string, (...args: unknown[]) => PromiseLike<unknown>>;
        const result = await read[method]?.(...args);
        await arrive();
        return result;
      };
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
