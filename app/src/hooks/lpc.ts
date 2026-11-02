import { useCallback } from "react";
import { api } from "@/app/_trpc/client";
import { buildLpcCatalog } from "@/libs/lpc/catalog";

/** Share the staff design discovery query across equipment and design editors. */
export const useLpcDesigns = () => api.gameAsset.getLpcCatalog.useQuery();

/** Share catalog reads; travel can use saved artwork while revalidating for its next scene. */
export const useLpcCatalogLoader = ({
  revalidateInBackground = false,
}: {
  revalidateInBackground?: boolean;
} = {}) => {
  const utils = api.useUtils();
  return useCallback(async () => {
    const cached = revalidateInBackground
      ? utils.gameAsset.getLpcCatalog.getData()
      : undefined;
    const fresh = utils.gameAsset.getLpcCatalog.fetch(undefined, {
      staleTime: 0,
    });
    if (cached) {
      // Cached artwork remains usable if revalidation fails; a later scene retries.
      void fresh.catch(() => undefined);
      return buildLpcCatalog(cached);
    }
    return buildLpcCatalog(await fresh);
  }, [utils, revalidateInBackground]);
};
