import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { fetchMap } from "@/libs/sector-map/topology";
import type { GlobalMapData } from "@/libs/sector-map/world-types";

const cacheKey = "hexasphere_map_cache";
const cacheVersion = "v21-horizon-near-wake";
const map: GlobalMapData = {
  radius: 300,
  projection: "cylindrical",
  visualScale: 1,
  polarCapColumns: 1,
  polarCapRows: 1,
  polarCapColors: { north: [0, 0, 0, 0], south: [0, 0, 0, 0] },
  columns: 1,
  rows: 1,
  latitudeLimit: 65,
  tiles: [
    { b: [{ x: 1, y: 0, z: 0 }], c: { x: 1, y: 0, z: 0 }, t: 1, vc: [0, 0, 0, 0] },
  ],
};

describe("map topology cache", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("reuses the existing versioned cache without a request", async () => {
    window.localStorage.setItem(
      cacheKey,
      JSON.stringify({ version: cacheVersion, data: map }),
    );
    const request = vi.fn();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      request as unknown as typeof fetch,
    );
    expect(await fetchMap()).toEqual(map);
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    null,
    "malformed JSON",
    JSON.stringify({ version: "old-version", data: {} }),
  ])("refreshes an absent, invalid or outdated cache: %s", async (cached) => {
    if (cached !== null) window.localStorage.setItem(cacheKey, cached);
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json(map),
    );
    vi.spyOn(globalThis, "fetch").mockImplementation(
      request as unknown as typeof fetch,
    );
    expect(await fetchMap()).toEqual(map);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[0]).toBe(`/api/map/topology?v=${cacheVersion}`);
    expect(JSON.parse(window.localStorage.getItem(cacheKey) ?? "null")).toEqual({
      version: cacheVersion,
      data: map,
    });
    expect(await fetchMap()).toEqual(map);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("returns topology when browser storage is blocked", async () => {
    const storage = Object.getPrototypeOf(window.localStorage) as Storage;
    vi.spyOn(storage, "getItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "fetch").mockImplementation(
      vi.fn(async () => Response.json(map)) as unknown as typeof fetch,
    );
    expect(await fetchMap()).toEqual(map);
  });
});
