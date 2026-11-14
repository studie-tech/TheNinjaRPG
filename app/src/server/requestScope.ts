import { AsyncLocalStorage } from "node:async_hooks";
import { runSharedReadBehindStatementGate } from "@/server/statementGate";

/**
 * Per-request memo for reads shared by procedures in an HTTP request.
 *
 * The tRPC client batches whatever a page mounts into a single POST, and tRPC
 * resolves those procedures concurrently. The memo shares reads by key across the
 * batch, such as the wars, raids and shrine lobbies that `fetchUpdatedUser` needs.
 * Concurrent callers share a pending query, and later callers reuse its successful
 * result within the request. User-independent catalogues shared across requests use
 * `@/server/utils/runtimeCache` instead.
 *
 * Only reads that satisfy all three of the following belong here:
 *
 *  1. The predicate is fully determined by the key, so two callers in the same
 *     request cannot legitimately want different rows back.
 *  2. Nothing the request itself writes is expected to be visible to a later read
 *     in the same request. A memoized read returns the snapshot the first caller
 *     took, so a write landing in between is observed on the next request instead.
 *  3. The rows carry no per-caller state. `userData` is deliberately excluded: it
 *     is the row every mutation reads, mutates in memory and writes back.
 */
type RequestScope = Map<string, Promise<unknown>>;

const storage = new AsyncLocalStorage<RequestScope>();

/**
 * Run `fn` with a fresh memo. Call this once per HTTP request, at the outermost
 * point of the handler, so every procedure in a batch shares one store.
 */
export const withRequestScope = <T>(fn: () => T): T => storage.run(new Map(), fn);

/**
 * Read `load()` at most once per request, keyed by `key`.
 *
 * Outside a request scope (crons, scripts, tests), each call invokes `load()` directly.
 *
 * Every caller - including the first - receives a structured clone rather than the
 * memoized value. Callers routinely mutate what they read back: quest objectives
 * are rewritten in place to hide locations from players who are not in the right
 * sector, for example, and that rewrite is user-specific. Handing out the memoized
 * object itself would let one caller's edits leak into the next caller's copy.
 * Cache loaders only read and populate caches; each consumer waits for its own
 * statement gate, including cache hits, without caching another caller's clearance.
 */
export const scopedRead = <T>(key: string, load: () => Promise<T>): Promise<T> =>
  runSharedReadBehindStatementGate(async () => {
    const scope = storage.getStore();
    if (!scope) return load();
    let pending = scope.get(key) as Promise<T> | undefined;
    if (!pending) {
      // `load()` is awaited into a real promise before it is memoized. A Drizzle
      // query builder is a thenable that re-runs `execute()` on every `then`, so
      // memoizing the builder itself would cache the intent to query rather than
      // its result and every reader would still hit the database.
      pending = (async () => load())();
      scope.set(key, pending);
      // A dropped connection on the first caller must not fail every later one too;
      // evict the rejected read so the next caller re-issues it. The catch also keeps
      // the memoized promise from ever counting as an unhandled rejection.
      void pending.catch(() => {
        if (scope.get(key) === pending) scope.delete(key);
      });
    }
    return structuredClone(await pending);
  });
