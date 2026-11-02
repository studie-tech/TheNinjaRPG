import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "bun:test";
import * as client from "@/app/_trpc/client";
import { useLpcCatalogLoader } from "@/hooks/lpc";
import { buildLpcCatalog } from "@/libs/lpc/catalog";
import { lpcAssets } from "../setup/lpc";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Control refresh completion while exercising the scene loader's cached and fresh snapshots. */
const fixture = (cached?: typeof lpcAssets) => {
  let resolve!: (assets: typeof lpcAssets) => void;
  let reject!: (error: Error) => void;
  const pending = new Promise<typeof lpcAssets>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  const fetch = vi.fn(async () => {
    cached = await pending;
    return cached;
  });
  const utils = {
    gameAsset: { getLpcCatalog: { getData: () => cached, fetch } },
  };
  Object.assign(vi.spyOn(client, "api" as never), { useUtils: () => utils });
  return { resolve, reject, fetch, pending };
};

describe("scene character catalog loading", () => {
  it("waits for artwork on a cold cache", async () => {
    const request = fixture();
    const { result } = renderHook(() => useLpcCatalogLoader({ revalidateInBackground: true }));
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
    const { result } = renderHook(() => useLpcCatalogLoader({ revalidateInBackground: true }));
    expect(await result.current()).toEqual(buildLpcCatalog(lpcAssets));
    expect(request.fetch).toHaveBeenCalledTimes(1);
    const edited = [{ ...lpcAssets[0]!, id: "saved-artwork" }];
    request.resolve(edited);
    await request.pending;
    expect(await result.current()).toEqual(buildLpcCatalog(edited));
  });

  it("keeps cached travel artwork usable after a refresh failure", async () => {
    const request = fixture(lpcAssets);
    const { result } = renderHook(() => useLpcCatalogLoader({ revalidateInBackground: true }));
    expect(await result.current()).toEqual(buildLpcCatalog(lpcAssets));
    request.reject(new Error("Catalog temporarily unavailable"));
    await Promise.resolve();
    expect(await result.current()).toEqual(buildLpcCatalog(lpcAssets));
  });

  it("requires fresh artwork for editors and previews", async () => {
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
    const { result } = renderHook(() => useLpcCatalogLoader({ revalidateInBackground: true }));
    const loading = result.current();
    request.reject(new Error("Catalog unavailable"));
    await expect(loading).rejects.toThrow("Catalog unavailable");
  });
});
