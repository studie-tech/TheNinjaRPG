import { useCallback, useEffect, useRef } from "react";
import { api } from "@/app/_trpc/client";
import type { LpcCatalog } from "@/libs/lpc/catalog";

/** Share the staff design discovery query across equipment and design editors. */
export const useLpcDesigns = () => api.gameAsset.getLpcCatalog.useQuery();

/** Artwork changes only when staff save it, so a recently loaded scene catalog is reused. */
const LPC_SCENE_CATALOG_STALE_MS = 5 * 60 * 1000;

/** Saved artwork refreshes both editor discovery and compiled scene snapshots. */
export const useLpcCatalogInvalidation = () => {
  const utils = api.useUtils();
  return useCallback(
    () =>
      Promise.all([
        utils.gameAsset.getLpcCatalog.invalidate(),
        utils.client.gameAsset.getLpcSceneCatalog
          .query(undefined, { context: { skipBatch: true } })
          .then((catalog) => {
            // Stop stale writes, then supply saved artwork before pending scene readers settle.
            const cancelled = utils.gameAsset.getLpcSceneCatalog.cancel();
            utils.gameAsset.getLpcSceneCatalog.setData(undefined, catalog);
            return cancelled;
          })
          .catch(async () => {
            // A pending obsolete response must not mark the failed refresh as fresh.
            await utils.gameAsset.getLpcSceneCatalog.cancel();
            return utils.gameAsset.getLpcSceneCatalog.invalidate();
          }),
      ]),
    [utils],
  );
};

/**
 * Reuse a recently loaded catalog, otherwise await a fresh one. Scenes can return an older
 * snapshot while refreshing artwork for subsequent scenes; a cold cache still awaits the request.
 */
export const useLpcCatalogLoader = ({
  revalidateInBackground = false,
  preload = false,
}: {
  revalidateInBackground?: boolean;
  /** Prepare the first scene's request alongside its parent data, before the renderer mounts. */
  preload?: boolean;
} = {}) => {
  const utils = api.useUtils();
  const prepared = useRef<Promise<LpcCatalog> | null>(null);
  const request = useCallback(async () => {
    const cached = revalidateInBackground
      ? utils.gameAsset.getLpcSceneCatalog.getData()
      : undefined;
    const latest = fetchLpcSceneCatalog(utils);
    if (cached) {
      // Cached artwork remains usable if revalidation fails; a later scene retries.
      void latest.catch(() => undefined);
      return cached;
    }
    return latest;
  }, [utils, revalidateInBackground]);
  useEffect(() => {
    if (!preload) return;
    const promise = request();
    prepared.current = promise;
    // The scene consumes the same success or error; preparing it must not leak an unhandled rejection.
    void promise.catch(() => undefined);
    return () => {
      if (prepared.current === promise) prepared.current = null;
    };
  }, [preload, request]);
  return useCallback(() => {
    const promise = prepared.current;
    prepared.current = null;
    return promise ?? request();
  }, [request]);
};

/**
 * The catalog is slow to build and loads beside a scene's other data, not inside its batch.
 * It has no observers, so it is kept for the page's lifetime for the next scene to reuse;
 * a recent copy that no save invalidated answers without a request, and a scene that asks
 * while a request is in flight shares it.
 */
export const fetchLpcSceneCatalog = (utils: ReturnType<typeof api.useUtils>) =>
  utils.gameAsset.getLpcSceneCatalog.fetch(undefined, {
    staleTime: LPC_SCENE_CATALOG_STALE_MS,
    gcTime: Infinity,
    trpc: { context: { skipBatch: true } },
  });
