import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-request memo for reads that every procedure in an HTTP request repeats.
 *
 * The tRPC client batches whatever a page mounts into a single POST, and tRPC
 * resolves those procedures concurrently. Any read that a shared helper performs
 * - the achievement catalogue and game settings that `fetchUpdatedUser` needs, for
 * instance - therefore hits PlanetScale once per procedure rather than once per
 * page load, which is the dominant source of duplicate queries on the busy pages.
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
 * Outside a request scope (crons, scripts, tests) this is a plain pass-through, so
 * callers behave exactly as they did before.
 *
 * Every caller - including the first - receives a structured clone rather than the
 * memoized value. Callers routinely mutate what they read back: quest objectives
 * are rewritten in place to hide locations from players who are not in the right
 * sector, for example, and that rewrite is user-specific. Handing out the memoized
 * object itself would let one caller's edits leak into the next caller's copy.
 */
export const scopedRead = async <T>(
  key: string,
  load: () => Promise<T>,
): Promise<T> => {
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
};
