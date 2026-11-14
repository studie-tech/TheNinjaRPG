import { getCache, type RuntimeCache } from "@vercel/functions";
import { nanoid } from "nanoid";
import superjson, { type SuperJSONResult } from "superjson";

/*
 * Functions are ephemeral and Vercel runs many instances at once, so process memory alone
 * can neither survive a cold start nor learn of a save made on another instance. Shared
 * reads therefore live in the regional Vercel Runtime Cache, and each instance keeps the
 * decoded value in memory only while the cache's version key still names it.
 *
 * Reads are billed per 8 KB unit, so a call reads only the small version key and fetches
 * the payload when its instance does not hold that version yet. Payload keys carry the
 * deployment, because entries outlive deployments and a new build may shape rows
 * differently. Outside Vercel, `getCache` falls back to a process-local store.
 */

const VERSION_TTL_SECONDS = 24 * 60 * 60;
const deploymentKey = process.env.VERCEL_DEPLOYMENT_ID ?? "local";

type StoredPayload = { at: number; data: SuperJSONResult };

const runtimeCache = getCache({ namespace: "shared", keyHashFunction: (key) => key });

// Every cache's invalidation, so tests can reset them together.
const invalidators = new Set<() => Promise<void>>();

/**
 * A user-independent read shared by every instance through the Vercel Runtime Cache.
 *
 * Each call reads the version key and answers from this instance's memory when it holds
 * that version and the rows are younger than `ttlSeconds`; otherwise it reads the stored
 * payload, or the database and stores the result. Concurrent misses share one read and
 * failed reads are never cached. `invalidate` names a new version after a write, so every
 * instance reads the saved rows on its next call. While the Runtime Cache fails, reads go
 * to the database. Callers receive a structured clone unless `cloneReads` is false, so
 * per-user rewrites of the rows stay private.
 */
export const createRuntimeCache = <Client, T>({
  name,
  ttlSeconds,
  load,
  cloneReads = true,
  store,
}: {
  /** Key prefix and Runtime Cache tag: letters, digits and dashes. */
  name: string;
  /** Bounds staleness for writes that do not call `invalidate`. */
  ttlSeconds: number;
  load: (client: Client) => Promise<T>;
  /** False when callers never mutate the value and may share one object. */
  cloneReads?: boolean;
  /** Replaces the Runtime Cache, for tests; such caches stay out of `invalidateRuntimeCaches`. */
  store?: RuntimeCache;
}) => {
  const cache = store ?? runtimeCache;
  const versionKey = `${name}:version`;
  const payloadTag = `${name}:payload`;
  const payloadKey = (version: string) => `${name}:${deploymentKey}:${version}`;
  const ttlMs = ttlSeconds * 1000;
  let memory: { version: string; value: T; at: number } | undefined;
  let pendingVersion: Promise<string> | undefined;
  // Reads on the invalidating instance wait for the new version.
  let pendingInvalidation: Promise<void> | undefined;
  const pendingReads = new Map<string, Promise<T>>();
  // Local invalidations stop reads already in flight from refilling memory.
  let generation = 0;

  /** The version every instance currently serves, created when absent. */
  const readVersionKey = async () => {
    const stored = await cache.get(versionKey);
    if (typeof stored === "string") return stored;
    // The database is read only after this set, so a write whose version this set
    // overwrites had already committed and the read sees it.
    const created = nanoid();
    await cache.set(versionKey, created, { ttl: VERSION_TTL_SECONDS });
    return created;
  };

  /** Concurrent calls share one version read, so a cold instance creates one version. */
  const currentVersion = () => {
    if (!pendingVersion) {
      const promise = readVersionKey().finally(() => {
        if (pendingVersion === promise) pendingVersion = undefined;
      });
      pendingVersion = promise;
    }
    return pendingVersion;
  };

  /** The stored payload for `version`, or null when absent, expired or unreadable. */
  const storedValue = async (version: string) => {
    try {
      const stored = (await cache.get(payloadKey(version))) as StoredPayload | null;
      if (!stored || Date.now() - stored.at >= ttlMs) return null;
      return { value: superjson.deserialize<T>(stored.data), at: stored.at };
    } catch {
      return null;
    }
  };

  /** Read `version` from the Runtime Cache, else the database, and keep it in memory. */
  const readVersion = async (client: Client, version: string) => {
    const startedGeneration = generation;
    let entry = await storedValue(version);
    if (!entry) {
      // A slow read cannot claim freshness newer than its start.
      const at = Date.now();
      entry = { value: await load(client), at };
      await cache
        .set(
          payloadKey(version),
          { at, data: superjson.serialize(entry.value) } satisfies StoredPayload,
          { ttl: ttlSeconds, tags: [payloadTag] },
        )
        .catch(() => undefined);
    }
    if (startedGeneration === generation) memory = { version, ...entry };
    return entry.value;
  };

  const readShared = async (client: Client): Promise<T> => {
    await pendingInvalidation;
    let version: string;
    try {
      version = await currentVersion();
    } catch {
      // Without the shared version no instance can prove its copy current.
      return load(client);
    }
    if (memory?.version === version && Date.now() - memory.at < ttlMs)
      return memory.value;
    const pendingKey = `${generation}:${version}`;
    const pending = pendingReads.get(pendingKey);
    if (pending) return pending;
    const promise = readVersion(client, version).finally(() => {
      pendingReads.delete(pendingKey);
    });
    pendingReads.set(pendingKey, promise);
    return promise;
  };

  /** Make every instance read the database again; call after a successful write. */
  const invalidate = (): Promise<void> => {
    generation += 1;
    memory = undefined;
    pendingVersion = undefined;
    // The tag drops superseded payloads of every deployment at once.
    const invalidation = Promise.all([
      cache.set(versionKey, nanoid(), { ttl: VERSION_TTL_SECONDS }),
      cache.expireTag(payloadTag),
    ]).then(
      () => undefined,
      (error: unknown) => {
        console.error(`Runtime Cache invalidation failed for ${name}`, error);
      },
    );
    pendingInvalidation = invalidation;
    void invalidation.then(() => {
      if (pendingInvalidation === invalidation) pendingInvalidation = undefined;
    });
    return invalidation;
  };
  if (!store) invalidators.add(invalidate);

  return {
    read: async (client: Client): Promise<T> => {
      const value = await readShared(client);
      return cloneReads ? structuredClone(value) : value;
    },
    invalidate,
  };
};

/** Invalidate every Runtime Cache. Used by tests that seed their own content. */
export const invalidateRuntimeCaches = async () => {
  await Promise.all([...invalidators].map((invalidate) => invalidate()));
};
