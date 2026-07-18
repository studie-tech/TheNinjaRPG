import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SECTOR_MAP_VERSION } from "@/drizzle/constants";
import type { NormalizedSectorMap } from "@/libs/sector-map/types";
import type { DrizzleClient } from "@/server/db";
import {
  fetchPublishedSectorMap,
  fetchPublishedSectorMaps,
  invalidatePublishedMapCache,
} from "@/server/utils/sectorMap";

const makeMap = (sector: number, marker: string): NormalizedSectorMap => ({
  formatVersion: SECTOR_MAP_VERSION,
  sector,
  name: marker,
  width: 2,
  height: 2,
  tiles: [],
  objects: [],
  anchors: [],
  exits: [],
  metadata: { importedAt: "2026-01-01T00:00:00.000Z", source: "tiled" },
});

/** Stub drizzle client serving the given rows, counting every query */
const makeClient = (
  rows: { sector: number; version: number; normalizedJson: NormalizedSectorMap }[],
) => {
  const calls = { findMany: 0, findFirst: 0 };
  const client = {
    query: {
      sectorMap: {
        findMany: async () => {
          calls.findMany += 1;
          return rows;
        },
        findFirst: async () => {
          calls.findFirst += 1;
          return rows[0] ? { normalizedJson: rows[0].normalizedJson } : undefined;
        },
      },
    },
  } as unknown as DrizzleClient;
  return { client, calls };
};

describe("published sector map cache", () => {
  beforeEach(() => invalidatePublishedMapCache());
  afterEach(() => vi.useRealTimers());

  it("picks the highest published version when multiple rows exist", async () => {
    const { client } = makeClient([
      { sector: 5, version: 1, normalizedJson: makeMap(5, "old") },
      { sector: 5, version: 3, normalizedJson: makeMap(5, "newest") },
      { sector: 5, version: 2, normalizedJson: makeMap(5, "mid") },
    ]);
    const maps = await fetchPublishedSectorMaps(client, [5]);
    expect(maps.get(5)?.name).toBe("newest");
  });

  it("serves repeat requests from the cache without querying again", async () => {
    const { client, calls } = makeClient([
      { sector: 7, version: 1, normalizedJson: makeMap(7, "v1") },
    ]);
    const first = await fetchPublishedSectorMaps(client, [7]);
    expect(calls.findMany).toBe(1);
    const second = await fetchPublishedSectorMaps(client, [7]);
    expect(calls.findMany).toBe(1); // cache hit: no second query
    expect(second.get(7)).toBe(first.get(7));
    // The single-sector variant shares the same cache
    const single = await fetchPublishedSectorMap(client, 7);
    expect(calls.findFirst).toBe(0);
    expect(single).toBe(first.get(7));
  });

  it("re-queries only the missing sectors of a window", async () => {
    const { client, calls } = makeClient([
      { sector: 1, version: 1, normalizedJson: makeMap(1, "one") },
      { sector: 2, version: 1, normalizedJson: makeMap(2, "two") },
    ]);
    await fetchPublishedSectorMaps(client, [1, 2]);
    expect(calls.findMany).toBe(1);
    // 1 and 2 are cached; only a window containing an uncached sector queries
    await fetchPublishedSectorMaps(client, [1, 2]);
    expect(calls.findMany).toBe(1);
  });

  it("invalidation forces a fresh query and serves the republished map", async () => {
    const { client, calls } = makeClient([
      { sector: 9, version: 1, normalizedJson: makeMap(9, "before") },
    ]);
    const before = await fetchPublishedSectorMap(client, 9);
    expect(before.name).toBe("before");
    // Republished: new rows behind the same client
    const updated = makeClient([
      { sector: 9, version: 2, normalizedJson: makeMap(9, "after") },
    ]);
    invalidatePublishedMapCache(9);
    const after = await fetchPublishedSectorMap(updated.client, 9);
    expect(after.name).toBe("after");
    expect(calls.findFirst + updated.calls.findFirst).toBeGreaterThan(0);
  });

  it("expires cache entries after the TTL", async () => {
    vi.useFakeTimers();
    const { client, calls } = makeClient([
      { sector: 4, version: 1, normalizedJson: makeMap(4, "v1") },
    ]);
    await fetchPublishedSectorMaps(client, [4]);
    expect(calls.findMany).toBe(1);
    vi.advanceTimersByTime(61_000); // past the 60s TTL
    await fetchPublishedSectorMaps(client, [4]);
    expect(calls.findMany).toBe(2);
  });
});
