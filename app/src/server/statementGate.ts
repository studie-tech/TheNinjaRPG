import { AsyncLocalStorage } from "node:async_hooks";
import { isReadOnlyQuery } from "@/server/dbRetry";

/**
 * Hold a procedure's database work behind a check that runs alongside its first reads.
 *
 * Inside `runBehindStatementGate`, procedure statements wait for the gate: reads are
 * sent at once but their results are withheld until it settles,
 * and writes and transactions are not sent before it settles. A rejected gate rejects
 * every such statement with its own error, so a procedure stops at its first awaited
 * statement and cannot reach a write, or any side effect that follows a read, on stale
 * permission. Shared read loaders may populate caches independently; each consumer
 * waits for its own gate. The caller decides what the procedure answers on rejection.
 *
 * Side effects a procedure fires before awaiting any statement are not held, so a
 * procedure under a gate reads before it calls external services.
 */
const storage = new AsyncLocalStorage<{
  gate: Promise<unknown>;
  isSharedRead?: boolean;
}>();
const gatedSessions = new WeakSet<object>();

/** Run `fn` with every statement of gated clients held until `gate` settles. */
export const runBehindStatementGate = <T>(gate: Promise<unknown>, fn: () => T): T => {
  // Statements observe the rejection; the caller awaits the gate itself.
  void gate.catch(() => {});
  return storage.run({ gate }, fn);
};

/**
 * Keep shared read loaders independent of a caller's clearance, then hold that caller's
 * result. Only read-only cache loaders belong here: their reads and cache population
 * may finish before clearance, while their consumers still wait. Nested loaders share
 * that work; writes and transactions remain gated even inside a loader.
 */
export const runSharedReadBehindStatementGate = async <T>(
  load: () => Promise<T>,
): Promise<T> => {
  const context = storage.getStore();
  if (!context || context.isSharedRead) return load();
  // Await thenable query builders in the loader's context before sharing the result.
  const pending = storage.run({ ...context, isSharedRead: true }, async () => load());
  return awaitStatementGate(pending, context.gate);
};

/**
 * Route a Drizzle client's statements through the active gate. Drizzle sends every
 * builder, relational query and `execute` through its session's `prepareQuery`, and
 * transactions through `session.transaction`; statements inside a transaction run
 * only after that transaction was admitted. Installing twice is a no-op, so a client
 * cached across development reloads can pass through again.
 */
export const gateStatements = <Client extends object>(client: Client): Client => {
  const { session } = client as unknown as { session: GatedSession };
  if (gatedSessions.has(session)) return client;
  gatedSessions.add(session);
  const prepareQuery = session.prepareQuery.bind(session);
  const transaction = session.transaction.bind(session);
  session.prepareQuery = (query, ...options) => {
    const prepared = prepareQuery(query, ...options);
    const execute = prepared.execute.bind(prepared);
    prepared.execute = (...args) => {
      const context = storage.getStore();
      if (!context) return execute(...args);
      if (isReadOnlyQuery(query.sql)) {
        const pending = execute(...args);
        return context.isSharedRead
          ? pending
          : awaitStatementGate(pending, context.gate);
      }
      return context.gate.then(() => execute(...args));
    };
    return prepared;
  };
  session.transaction = (...args) => {
    const gate = storage.getStore()?.gate;
    return gate ? gate.then(() => transaction(...args)) : transaction(...args);
  };
  return client;
};

/** Withhold read failures as well as results, with the gate's error taking precedence. */
const awaitStatementGate = async <T>(pending: Promise<T>, gate: Promise<unknown>) => {
  // Observe an early failure while clearance is pending, without delaying a rejected gate.
  void pending.catch(() => {});
  await gate;
  return pending;
};

/** The internal Drizzle session members every statement passes through. */
type GatedSession = {
  prepareQuery: (
    query: { sql: string },
    ...options: unknown[]
  ) => { execute: (...args: unknown[]) => Promise<unknown> };
  transaction: (...args: unknown[]) => Promise<unknown>;
};
