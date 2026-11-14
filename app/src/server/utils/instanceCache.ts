// Every cache's invalidation, so tests can reset them together.
const invalidators = new Set<() => void>();

/**
 * A user-independent read kept by each server instance for `ttlMs`, per database client.
 *
 * A miss issues one read shared by every concurrent caller; a failed read is not cached.
 * `invalidate` drops this instance's snapshot at once and keeps reads already in flight
 * from refilling it, while other instances converge within the TTL. Every caller
 * receives a structured clone, so per-user rewrites of the rows stay private.
 */
export const createInstanceCache = <Client extends object, T>(
  ttlMs: number,
  load: (client: Client) => Promise<T>,
) => {
  const snapshots = new WeakMap<Client, { value: T; at: number; generation: number }>();
  const pendingReads = new WeakMap<
    Client,
    { promise: Promise<T>; generation: number }
  >();
  let generation = 0;
  const invalidate = () => {
    generation += 1;
  };
  invalidators.add(invalidate);

  /** Read, caching the result unless an invalidation superseded it. */
  const loadSnapshot = async (client: Client) => {
    const startedGeneration = generation;
    // A slow read cannot claim freshness newer than its snapshot.
    const startedAt = Date.now();
    const value = await load(client);
    if (startedGeneration === generation)
      snapshots.set(client, { value, at: startedAt, generation: startedGeneration });
    return value;
  };

  const readShared = (client: Client): Promise<T> => {
    const cached = snapshots.get(client);
    if (cached && cached.generation === generation && Date.now() - cached.at < ttlMs)
      return Promise.resolve(cached.value);
    // A read started before an invalidation must not answer requests made after it.
    const pending = pendingReads.get(client);
    if (pending?.generation === generation) return pending.promise;
    const promise = loadSnapshot(client).finally(() => {
      if (pendingReads.get(client)?.promise === promise) pendingReads.delete(client);
    });
    pendingReads.set(client, { promise, generation });
    return promise;
  };

  return {
    read: async (client: Client): Promise<T> =>
      structuredClone(await readShared(client)),
    /** Drop cached snapshots and prevent in-flight reads from refilling them. */
    invalidate,
  };
};

/** Invalidate every instance cache. Used by tests that seed their own content. */
export const invalidateInstanceCaches = () => {
  for (const invalidate of invalidators) invalidate();
};
