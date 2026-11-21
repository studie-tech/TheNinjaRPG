import { buildLpcCatalog } from "@/libs/lpc/catalog";
import { listLpcAssets } from "@/queries/asset";
import type { DrizzleClient } from "@/server/db";
import { createRuntimeCache } from "@/server/utils/caches/runtimeCache";

// Every travel, combat and battlelog scene loads the complete LPC library, which changes
// only when staff save artwork. Only the compiled catalog is shared: it is a fraction of
// the library rows and stays within the Runtime Cache's item size limit.
const lpcSceneCatalog = createRuntimeCache({
  name: "lpc-scene-catalog",
  ttlSeconds: 60 * 60,
  cloneReads: false,
  load: async (client: Pick<DrizzleClient, "query">) =>
    buildLpcCatalog(await listLpcAssets(client)),
});

/** The compiled LPC scene catalog. Callers share the returned object and must not mutate it. */
export const fetchLpcSceneCatalog = lpcSceneCatalog.read;

/** Make every instance compile the LPC library again; await after LPC writes. */
export const invalidateLpcSceneCatalog = lpcSceneCatalog.invalidate;
