import { buildLpcCatalog, type LpcCatalog } from "@/libs/lpc/catalog";
import { listLpcAssets } from "@/queries/asset";
import type { DrizzleClient } from "@/server/db";

// Every travel, combat and battlelog scene loads the complete LPC library, which changes
// only when staff save artwork. Each server instance keeps one snapshot briefly; a save on
// this instance replaces it at once, and one on another instance reaches it within the TTL.
const LPC_CATALOG_TTL_MS = 60 * 1000;

type LpcClient = Pick<DrizzleClient, "query">;
type LpcCatalogSnapshot = {
  assets: Awaited<ReturnType<typeof listLpcAssets>>;
  catalog: LpcCatalog;
  at: number;
  generation: number;
};

const snapshots = new WeakMap<LpcClient, LpcCatalogSnapshot>();
// Concurrent misses share one read instead of each transferring the whole library.
const pendingSnapshots = new WeakMap<
  LpcClient,
  { promise: Promise<LpcCatalogSnapshot>; generation: number }
>();
let generation = 0;

/** Drop cached snapshots and prevent in-flight reads from refilling them; call after LPC writes. */
export const invalidateLpcCatalog = () => {
  generation += 1;
};

/**
 * Load the LPC designs and their compiled scene catalog from the instance cache. `fresh`
 * reads past it, for editors that need artwork saved on any instance. Failed reads are not
 * cached. Callers share the returned objects and must not mutate them.
 */
export const fetchLpcCatalog = (
  client: LpcClient,
  { fresh = false }: { fresh?: boolean } = {},
): Promise<LpcCatalogSnapshot> => {
  if (fresh) return loadSnapshot(client);
  const cached = snapshots.get(client);
  if (
    cached &&
    cached.generation === generation &&
    Date.now() - cached.at < LPC_CATALOG_TTL_MS
  )
    return Promise.resolve(cached);
  // A read started before an edit must not answer requests made after it.
  const pending = pendingSnapshots.get(client);
  if (pending?.generation === generation) return pending.promise;
  const promise = loadSnapshot(client).finally(() => {
    if (pendingSnapshots.get(client)?.promise === promise)
      pendingSnapshots.delete(client);
  });
  pendingSnapshots.set(client, { promise, generation });
  return promise;
};

/** Read and compile the library, caching it unless an edit or a newer read superseded it. */
const loadSnapshot = async (client: LpcClient) => {
  const startedGeneration = generation;
  // A slow read cannot claim freshness newer than its snapshot.
  const startedAt = Date.now();
  const assets = await listLpcAssets(client);
  const snapshot = {
    assets,
    catalog: buildLpcCatalog(assets),
    at: startedAt,
    generation: startedGeneration,
  };
  const cached = snapshots.get(client);
  if (
    startedGeneration === generation &&
    (!cached || cached.generation !== generation || cached.at <= startedAt)
  )
    snapshots.set(client, snapshot);
  return snapshot;
};
