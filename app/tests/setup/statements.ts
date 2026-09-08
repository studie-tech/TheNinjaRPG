import type { DrizzleClient } from "@/server/db";

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
