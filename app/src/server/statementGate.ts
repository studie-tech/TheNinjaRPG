import { AsyncLocalStorage } from "node:async_hooks";
import { isReadOnlyQuery } from "@/server/dbRetry";

/**
 * Hold a procedure's database work behind a check that runs alongside its first reads.
 *
 * Inside `runBehindStatementGate`, every statement issued through a gated client waits
 * for the gate: reads are sent at once but their results are withheld until it settles,
 * and writes and transactions are not sent before it settles. A rejected gate rejects
 * every such statement with its own error, so a procedure stops at its first awaited
 * statement and cannot reach a write, or any side effect that follows a read, on stale
 * permission. The caller decides what the procedure answers once the gate rejects.
 *
 * Side effects a procedure fires before awaiting any statement are not held, so a
 * procedure under a gate reads before it calls external services.
 */
const storage = new AsyncLocalStorage<Promise<unknown>>();
const gatedSessions = new WeakSet<object>();

/** Run `fn` with every statement of gated clients held until `gate` settles. */
export const runBehindStatementGate = <T>(gate: Promise<unknown>, fn: () => T): T => {
  // Statements observe the rejection; the caller awaits the gate itself.
  void gate.catch(() => {});
  return storage.run(gate, fn);
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
      const gate = storage.getStore();
      if (!gate) return execute(...args);
      return isReadOnlyQuery(query.sql)
        ? Promise.all([execute(...args), gate]).then(([result]) => result)
        : gate.then(() => execute(...args));
    };
    return prepared;
  };
  session.transaction = (...args) => {
    const gate = storage.getStore();
    return gate ? gate.then(() => transaction(...args)) : transaction(...args);
  };
  return client;
};

/** The internal Drizzle session members every statement passes through. */
type GatedSession = {
  prepareQuery: (
    query: { sql: string },
    ...options: unknown[]
  ) => { execute: (...args: unknown[]) => Promise<unknown> };
  transaction: (...args: unknown[]) => Promise<unknown>;
};
