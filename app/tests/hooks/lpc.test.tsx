import { afterEach, describe, expect, it, vi } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { cleanup, renderHook } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import { useLpcCatalogInvalidation, useLpcCatalogLoader } from "@/hooks/lpc";
import { buildLpcCatalog } from "@/libs/lpc/catalog";
import { deferred } from "../setup/deferred";
import { lpcAssets } from "../setup/lpc";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Control refresh completion while exercising the scene loader's cached and fresh snapshots. */
const fixture = (cached?: typeof lpcAssets) => {
  let resolve!: (assets: typeof lpcAssets) => void;
  let reject!: (error: Error) => void;
  const pending = new Promise<ReturnType<typeof buildLpcCatalog>>((complete, fail) => {
    resolve = (assets) => complete(buildLpcCatalog(assets));
    reject = fail;
  });
  let compiled = cached ? buildLpcCatalog(cached) : undefined;
  const fetch = vi.fn(async () => {
    compiled = await pending;
    return compiled;
  });
  const discoveryInvalidation = vi.fn(async () => {}),
    sceneInvalidation = vi.fn(async () => {}),
    freshQuery = vi.fn(async () => buildLpcCatalog(lpcAssets)),
    setData = vi.fn(
      (_input: undefined, catalog: ReturnType<typeof buildLpcCatalog>) => {
        compiled = catalog;
      },
    );
  const utils = {
    client: { gameAsset: { getLpcSceneCatalog: { query: freshQuery } } },
    gameAsset: {
      getLpcCatalog: { invalidate: discoveryInvalidation },
      getLpcSceneCatalog: {
        getData: () => compiled,
        cancel: vi.fn(async () => {}),
        fetch,
        invalidate: sceneInvalidation,
        setData,
      },
    },
  };
  Object.assign(vi.spyOn(client, "api" as never), { useUtils: () => utils });
  return {
    resolve,
    reject,
    fetch,
    pending,
    discoveryInvalidation,
    sceneInvalidation,
    freshQuery,
    setData,
  };
};

/** Bind the loader to a real query cache whose network read is counted. */
const queryCacheFixture = () => {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const queryKey = ["gameAsset.getLpcSceneCatalog"];
  let assets = lpcAssets;
  const network = vi.fn(async () => buildLpcCatalog(assets));
  const freshQuery = vi.fn(async () => buildLpcCatalog(assets));
  const utils = {
    client: { gameAsset: { getLpcSceneCatalog: { query: freshQuery } } },
    gameAsset: {
      getLpcCatalog: { invalidate: async () => {} },
      getLpcSceneCatalog: {
        getData: () => cache.getQueryData(queryKey),
        cancel: () => cache.cancelQueries({ queryKey }),
        setData: (_input: undefined, catalog: ReturnType<typeof buildLpcCatalog>) =>
          cache.setQueryData(queryKey, catalog),
        fetch: (_input: undefined, options: { staleTime: number; gcTime: number }) =>
          cache.fetchQuery({ queryKey, queryFn: network, ...options }),
        invalidate: () => cache.invalidateQueries({ queryKey }),
      },
    },
  };
  Object.assign(vi.spyOn(client, "api" as never), { useUtils: () => utils });
  return {
    network,
    freshQuery,
    invalidate: utils.gameAsset.getLpcSceneCatalog.invalidate,
    save: (edited: typeof lpcAssets) => {
      assets = edited;
    },
  };
};

describe("scene character catalog loading", () => {
  it("refreshes discovery and stores a freshly read scene snapshot after saved artwork changes", async () => {
    const request = fixture(lpcAssets);
    const { result } = renderHook(() => useLpcCatalogInvalidation());
    await result.current();
    expect(request.discoveryInvalidation).toHaveBeenCalledTimes(1);
    // Other server instances may still cache the previous artwork.
    expect(request.freshQuery).toHaveBeenCalledWith(
      { fresh: true },
      { context: { skipBatch: true } },
    );
    expect(request.setData).toHaveBeenCalledWith(undefined, buildLpcCatalog(lpcAssets));
    expect(request.sceneInvalidation).not.toHaveBeenCalled();
  });

  it("marks the scene snapshot stale when the fresh read fails", async () => {
    const request = fixture(lpcAssets);
    request.freshQuery.mockRejectedValueOnce(new Error("Catalog unavailable"));
    const { result } = renderHook(() => useLpcCatalogInvalidation());
    await result.current();
    expect(request.setData).not.toHaveBeenCalled();
    expect(request.sceneInvalidation).toHaveBeenCalledTimes(1);
  });

  it("reuses a recent catalog across scenes and previews until a save invalidates it", async () => {
    const scenes = queryCacheFixture();
    const travel = renderHook(() =>
      useLpcCatalogLoader({ revalidateInBackground: true }),
    );
    const preview = renderHook(() => useLpcCatalogLoader());
    expect(await travel.result.current()).toEqual(buildLpcCatalog(lpcAssets));
    expect(await preview.result.current()).toEqual(buildLpcCatalog(lpcAssets));
    expect(await travel.result.current()).toEqual(buildLpcCatalog(lpcAssets));
    expect(scenes.network).toHaveBeenCalledTimes(1);
    const edited = [{ ...lpcAssets[0]!, id: "saved-artwork" }];
    scenes.save(edited);
    await scenes.invalidate();
    // Previews wait for the saved artwork; scenes refresh it for the next one.
    expect(await preview.result.current()).toEqual(buildLpcCatalog(edited));
    expect(scenes.network).toHaveBeenCalledTimes(2);
  });

  it.each(["before", "during"] as const)(
    "keeps saved artwork when a scene request starts %s the fresh read and finishes later",
    async (timing) => {
      const scenes = queryCacheFixture();
      const older = deferred<ReturnType<typeof buildLpcCatalog>>();
      const fresh = deferred<ReturnType<typeof buildLpcCatalog>>();
      scenes.network.mockImplementationOnce(() => older.promise);
      scenes.freshQuery.mockImplementationOnce(() => fresh.promise);
      const loader = renderHook(() => useLpcCatalogLoader());
      const invalidation = renderHook(() => useLpcCatalogInvalidation());
      const startScene = () => loader.result.current();
      const beforeSave = timing === "before" ? startScene() : undefined;
      const saving = invalidation.result.current();
      const loading = beforeSave ?? startScene();
      const edited = buildLpcCatalog([{ ...lpcAssets[0]!, id: "saved-artwork" }]);
      fresh.resolve(edited);
      await saving;
      older.resolve(buildLpcCatalog(lpcAssets));
      expect(await loading).toEqual(edited);
      expect(await loader.result.current()).toEqual(edited);
      expect(scenes.network).toHaveBeenCalledTimes(1);
    },
  );

  it("shares a prepared request with the first scene and refreshes later scenes", async () => {
    const request = fixture();
    const { result } = renderHook(() => useLpcCatalogLoader({ preload: true }));
    expect(request.fetch).toHaveBeenCalledTimes(1);
    // The slow catalog travels in its own request rather than holding up a batch.
    expect(request.fetch).toHaveBeenCalledWith(undefined, {
      staleTime: 5 * 60 * 1000,
      gcTime: Infinity,
      trpc: { context: { skipBatch: true } },
    });
    const loading = result.current();
    expect(request.fetch).toHaveBeenCalledTimes(1);
    request.resolve(lpcAssets);
    expect(await loading).toEqual(buildLpcCatalog(lpcAssets));
    await result.current();
    expect(request.fetch).toHaveBeenCalledTimes(2);
  });

  it("hands a preparation error to the scene without leaking a rejection", async () => {
    const request = fixture();
    const { result } = renderHook(() => useLpcCatalogLoader({ preload: true }));
    request.reject(new Error("Catalog unavailable"));
    await Promise.resolve();
    await expect(result.current()).rejects.toThrow("Catalog unavailable");
    expect(request.fetch).toHaveBeenCalledTimes(1);
  });

  it("waits for artwork on a cold cache", async () => {
    const request = fixture();
    const { result } = renderHook(() =>
      useLpcCatalogLoader({ revalidateInBackground: true }),
    );
    let loaded = false;
    const loading = result.current().then((catalog) => {
      loaded = true;
      return catalog;
    });
    await Promise.resolve();
    expect(loaded).toBe(false);
    request.resolve(lpcAssets);
    expect(await loading).toEqual(buildLpcCatalog(lpcAssets));
  });

  it("returns cached artwork during revalidation and uses saved edits in the next scene", async () => {
    const request = fixture(lpcAssets);
    const { result } = renderHook(() =>
      useLpcCatalogLoader({ revalidateInBackground: true }),
    );
    expect(await result.current()).toEqual(buildLpcCatalog(lpcAssets));
    expect(request.fetch).toHaveBeenCalledTimes(1);
    const edited = [{ ...lpcAssets[0]!, id: "saved-artwork" }];
    request.resolve(edited);
    await request.pending;
    expect(await result.current()).toEqual(buildLpcCatalog(edited));
  });

  it("keeps cached travel artwork usable after a refresh failure", async () => {
    const request = fixture(lpcAssets);
    const { result } = renderHook(() =>
      useLpcCatalogLoader({ revalidateInBackground: true }),
    );
    expect(await result.current()).toEqual(buildLpcCatalog(lpcAssets));
    request.reject(new Error("Catalog temporarily unavailable"));
    await Promise.resolve();
    expect(await result.current()).toEqual(buildLpcCatalog(lpcAssets));
  });

  it("waits for artwork in previews when no recent catalog is held", async () => {
    const request = fixture(lpcAssets);
    const { result } = renderHook(() => useLpcCatalogLoader());
    let loaded = false;
    const loading = result.current().then((catalog) => {
      loaded = true;
      return catalog;
    });
    await Promise.resolve();
    expect(loaded).toBe(false);
    const edited = [{ ...lpcAssets[0]!, id: "preview-artwork" }];
    request.resolve(edited);
    expect(await loading).toEqual(buildLpcCatalog(edited));
  });

  it("rejects an unavailable cold catalog", async () => {
    const request = fixture();
    const { result } = renderHook(() =>
      useLpcCatalogLoader({ revalidateInBackground: true }),
    );
    const loading = result.current();
    request.reject(new Error("Catalog unavailable"));
    await expect(loading).rejects.toThrow("Catalog unavailable");
  });
});
