import { queryBloodlineCollectionCatalogue } from "@/queries/quests";
import { createRuntimeCache } from "@/server/utils/caches/runtimeCache";

// Bloodline editors invalidate the cache. Ownership is always read per caller.
const bloodlineCollectionCatalogue = createRuntimeCache({
  name: "bloodline-collection-catalogue",
  ttlSeconds: 60 * 60,
  load: queryBloodlineCollectionCatalogue,
});

/** The visible bloodline catalogue from the Runtime Cache. */
export const fetchBloodlineCollectionCatalogue = bloodlineCollectionCatalogue.read;

/** Make every instance read the bloodline catalogue again; await after bloodline writes. */
export const invalidateBloodlineCollectionCatalogue =
  bloodlineCollectionCatalogue.invalidate;
