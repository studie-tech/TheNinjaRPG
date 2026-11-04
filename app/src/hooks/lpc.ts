import { useCallback } from "react";
import { api } from "@/app/_trpc/client";

/** Share the staff design discovery query across equipment and design editors. */
export const useLpcDesigns = () => api.gameAsset.getLpcCatalog.useQuery();

/**
 * Load a fresh catalog by default. Travel can return a cached scene snapshot while
 * refreshing artwork for subsequent scenes; a cold cache still awaits the request.
 */
export const useLpcCatalogLoader = ({
  revalidateInBackground = false,
}: {
  revalidateInBackground?: boolean;
} = {}) => {
  const utils = api.useUtils();
  return useCallback(async () => {
    const cached = revalidateInBackground
      ? utils.gameAsset.getLpcSceneCatalog.getData()
      : undefined;
    const fresh = utils.gameAsset.getLpcSceneCatalog.fetch(undefined, {
      staleTime: 0,
    });
    if (cached) {
      // Cached artwork remains usable if revalidation fails; a later scene retries.
      void fresh.catch(() => undefined);
      return cached;
    }
    return fresh;
  }, [utils, revalidateInBackground]);
};
