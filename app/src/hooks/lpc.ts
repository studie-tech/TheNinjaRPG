import { useCallback, useEffect, useRef } from "react";
import { api } from "@/app/_trpc/client";
import type { LpcCatalog } from "@/libs/lpc/catalog";

/** Share the staff design discovery query across equipment and design editors. */
export const useLpcDesigns = () => api.gameAsset.getLpcCatalog.useQuery();

/** Saved artwork refreshes both editor discovery and compiled scene snapshots. */
export const useLpcCatalogInvalidation = () => {
  const utils = api.useUtils();
  return useCallback(
    () =>
      Promise.all([
        utils.gameAsset.getLpcCatalog.invalidate(),
        utils.gameAsset.getLpcSceneCatalog.invalidate(),
      ]),
    [utils],
  );
};

/**
 * Load a fresh catalog by default. Travel can return a cached scene snapshot while
 * refreshing artwork for subsequent scenes; a cold cache still awaits the request.
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
    // The catalog is slow to build and loads beside a scene's other data, not inside its batch.
    const fresh = utils.gameAsset.getLpcSceneCatalog.fetch(undefined, {
      staleTime: 0,
      trpc: { context: { skipBatch: true } },
    });
    if (cached) {
      // Cached artwork remains usable if revalidation fails; a later scene retries.
      void fresh.catch(() => undefined);
      return cached;
    }
    return fresh;
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
