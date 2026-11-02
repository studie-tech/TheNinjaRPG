import { useCallback } from "react";
import { api } from "@/app/_trpc/client";
import { buildLpcCatalog } from "@/libs/lpc/catalog";

/** Share the staff design discovery query across equipment and design editors. */
export const useLpcDesigns = () => api.gameAsset.getLpcCatalog.useQuery();

/** Load a fresh catalog for each new scene, sharing concurrent reads through the query client. */
export const useLpcCatalogLoader = () => {
  const utils = api.useUtils();
  return useCallback(
    async () =>
      buildLpcCatalog(
        await utils.gameAsset.getLpcCatalog.fetch(undefined, {
          staleTime: 0,
        }),
      ),
    [utils],
  );
};
