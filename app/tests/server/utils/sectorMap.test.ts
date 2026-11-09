import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { SECTOR_MAP_VERSION } from "@/drizzle/constants";
import type { NormalizedSectorMap } from "@/libs/sector-map/types";
import type { DrizzleClient } from "@/server/db";
import {
  fetchPublishedSectorMap,
  fetchPublishedSectorMaps,
  invalidatePublishedMapCache,
} from "@/server/utils/sectorMap";
import { deferred } from "../../setup/deferred";
import { planetScaleFixture } from "../../setup/planetscale";

const makeMap = (sector: number, name = "map"): NormalizedSectorMap => ({
  formatVersion: SECTOR_MAP_VERSION,
  sector,
  name,
  width: 2,
  height: 2,
  tiles: [],
  objects: [],
  anchors: [],
  exits: [],
  metadata: { importedAt: "2026-01-01T00:00:00.000Z", source: "tiled" },
});

type MapRow = { sector: number; version: number; normalizedJson: NormalizedSectorMap };
type MapQuery = {
  columns: { sector: true; version: true; normalizedJson?: true };
  where: SQL;
};

/** Honor sector filters and projections so tests detect unintended blob reads. */
const makeClient = (rows: MapRow[]) => {
  const findMany = vi.fn(async ({ columns, where }: MapQuery) => {
    const { params } = new MySqlDialect().sqlToQuery(where);
    return rows
      .filter((row) => params.includes(row.sector))
      .map((row) =>
        columns.normalizedJson ? row : { sector: row.sector, version: row.version },
      );
  });
  const client = {
    query: {
      sectorMap: {
        findMany,
        findFirst: async (query: MapQuery) =>
          (await findMany(query)).sort((a, b) => b.version - a.version)[0],
      },
    },
  } as unknown as DrizzleClient;
  return { client, findMany };
};

describe("published sector map cache", () => {
  let now = 1000;
  beforeEach(() => {
    invalidatePublishedMapCache();
    now = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    invalidatePublishedMapCache();
  });

  it("shares the highest published version between batch and single-sector reads", async () => {
    const newest = makeMap(5, "newest");
    const { client, findMany } = makeClient([
      { sector: 5, version: 1, normalizedJson: makeMap(5, "old") },
      { sector: 5, version: 3, normalizedJson: newest },
      { sector: 5, version: 2, normalizedJson: makeMap(5, "mid") },
    ]);
    expect((await fetchPublishedSectorMaps(client, [5, 5])).get(5)).toBe(newest);
    expect(await fetchPublishedSectorMap(client, 5)).toBe(newest);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it("revalidates expired maps with metadata only and renews the TTL", async () => {
    const map = makeMap(4);
    const { client, findMany } = makeClient([
      { sector: 4, version: 1, normalizedJson: map },
    ]);
    await fetchPublishedSectorMap(client, 4);
    now += 60_000;
    expect(await fetchPublishedSectorMap(client, 4)).toBe(map);
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany.mock.calls[1]![0].columns).toEqual({ sector: true, version: true });
    now += 59_999;
    expect((await fetchPublishedSectorMaps(client, [4])).get(4)).toBe(map);
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it("downloads only changed sectors and compares the highest published version", async () => {
    const rows = [1, 2].map((sector) => ({
      sector,
      version: 1,
      normalizedJson: makeMap(sector),
    }));
    const { client, findMany } = makeClient(rows);
    await fetchPublishedSectorMaps(client, [1, 2]);
    const changed = makeMap(2, "new");
    rows.push({ sector: 2, version: 3, normalizedJson: changed });
    rows.push({ sector: 2, version: 2, normalizedJson: makeMap(2, "intermediate") });
    now += 60_000;
    const maps = await fetchPublishedSectorMaps(client, [1, 2]);
    expect(maps.get(1)).toBe(rows[0]!.normalizedJson);
    expect(maps.get(2)).toBe(changed);
    expect(findMany).toHaveBeenCalledTimes(3);
    await expect(findMany.mock.results[2]!.value).resolves.toHaveLength(3);
    const { params } = new MySqlDialect().sqlToQuery(findMany.mock.calls[2]![0].where);
    expect(params).toEqual([2, "PUBLISHED"]);
  });

  it("detects an archived highest version and a completely unpublished sector", async () => {
    const old = { sector: 8, version: 1, normalizedJson: makeMap(8, "old") };
    const rows = [old, { sector: 8, version: 2, normalizedJson: makeMap(8, "new") }];
    const { client, findMany } = makeClient(rows);
    await fetchPublishedSectorMap(client, 8);
    rows.pop();
    now += 60_000;
    expect(await fetchPublishedSectorMap(client, 8)).toBe(old.normalizedJson);
    rows.pop();
    now += 60_000;
    expect((await fetchPublishedSectorMaps(client, [8])).has(8)).toBe(false);
    expect(findMany.mock.calls.at(-1)![0].columns).toEqual({
      sector: true,
      version: true,
    });
    await expect(fetchPublishedSectorMap(client, 8)).rejects.toThrow(
      "No published sector map",
    );
    expect(findMany.mock.calls.at(-1)![0].columns.normalizedJson).toBe(true);
  });

  it("starts cold loads and expired version probes together", async () => {
    const { client, findMany } = makeClient([
      { sector: 1, version: 1, normalizedJson: makeMap(1) },
    ]);
    await fetchPublishedSectorMap(client, 1);
    now += 60_000;
    let release: (rows: MapRow[]) => void = () => {};
    findMany.mockImplementationOnce(
      () =>
        new Promise<MapRow[]>((resolve) => {
          release = resolve;
        }),
    );
    const pending = fetchPublishedSectorMaps(client, [1, 2]);
    expect(findMany).toHaveBeenCalledTimes(3);
    expect(findMany.mock.calls[1]![0].columns.normalizedJson).toBe(true);
    expect(findMany.mock.calls[2]![0].columns.normalizedJson).toBeUndefined();
    release([{ sector: 2, version: 1, normalizedJson: makeMap(2) }]);
    expect((await pending).size).toBe(2);
  });

  it("immediately invalidates a sector without evicting other sectors", async () => {
    const rows = [1, 2].map((sector) => ({
      sector,
      version: 1,
      normalizedJson: makeMap(sector),
    }));
    const { client, findMany } = makeClient(rows);
    await fetchPublishedSectorMaps(client, [1, 2]);
    rows[0] = { sector: 1, version: 2, normalizedJson: makeMap(1, "republished") };
    invalidatePublishedMapCache(1);
    expect((await fetchPublishedSectorMaps(client, [1, 2])).get(1)?.name).toBe(
      "republished",
    );
    expect(
      new MySqlDialect().sqlToQuery(findMany.mock.calls[1]![0].where).params,
    ).toEqual([1, "PUBLISHED"]);
    expect(findMany.mock.calls[1]![0].columns.normalizedJson).toBe(true);
  });

  for (const stage of ["cold load", "unchanged probe", "changed load"] as const) {
    it(`does not repopulate the cache when invalidation races a ${stage}`, async () => {
      const rows = [{ sector: 3, version: 1, normalizedJson: makeMap(3, "before") }];
      const { client, findMany } = makeClient(rows);
      if (stage !== "cold load") {
        await fetchPublishedSectorMap(client, 3);
        now += 60_000;
      }
      if (stage === "changed load") {
        rows[0] = { sector: 3, version: 2, normalizedJson: makeMap(3, "new") };
        findMany.mockImplementationOnce(async () => [{ sector: 3, version: 2 }]);
      }
      let release: (rows: MapRow[]) => void = () => {};
      const { promise: started, resolve: markStarted } = deferred<void>();
      findMany.mockImplementationOnce(() => {
        markStarted();
        return new Promise<MapRow[]>((resolve) => {
          release = resolve;
        });
      });
      const pending = fetchPublishedSectorMap(client, 3);
      await started;
      invalidatePublishedMapCache(stage === "unchanged probe" ? undefined : 3);
      release([...rows]);
      await pending;
      const calls = findMany.mock.calls.length;
      rows[0] = { sector: 3, version: 3, normalizedJson: makeMap(3, "after") };
      expect((await fetchPublishedSectorMap(client, 3)).name).toBe("after");
      expect(findMany).toHaveBeenCalledTimes(calls + 1);
      expect(findMany.mock.calls.at(-1)![0].columns.normalizedJson).toBe(true);
    });
  }

  it("propagates probe failures and retries without serving an expired map", async () => {
    const { client, findMany } = makeClient([
      { sector: 1, version: 1, normalizedJson: makeMap(1) },
    ]);
    await fetchPublishedSectorMap(client, 1);
    now += 60_000;
    findMany.mockRejectedValueOnce(new Error("unavailable"));
    await expect(fetchPublishedSectorMap(client, 1)).rejects.toThrow("unavailable");
    await fetchPublishedSectorMap(client, 1);
    expect(findMany).toHaveBeenCalledTimes(3);
    expect(findMany.mock.calls[2]![0].columns.normalizedJson).toBeUndefined();
  });

  it("does not extend a slow version probe's snapshot beyond the TTL", async () => {
    const row = { sector: 1, version: 1, normalizedJson: makeMap(1) };
    const { client, findMany } = makeClient([row]);
    await fetchPublishedSectorMap(client, 1);
    now += 60_000;
    findMany.mockImplementationOnce(async () => {
      now += 60_000;
      return [row];
    });
    await fetchPublishedSectorMap(client, 1);
    await fetchPublishedSectorMap(client, 1);
    expect(findMany).toHaveBeenCalledTimes(3);
    expect(findMany.mock.calls[2]![0].columns.normalizedJson).toBeUndefined();
  });

  it("bounds retained entries at 200 and evicts the least recently used sector", async () => {
    const rows = Array.from({ length: 201 }, (_, sector) => ({
      sector,
      version: 1,
      normalizedJson: makeMap(sector),
    }));
    const { client, findMany } = makeClient(rows);
    await fetchPublishedSectorMaps(
      client,
      rows.slice(0, 200).map((row) => row.sector),
    );
    await fetchPublishedSectorMap(client, 0); // Protect the oldest insertion by using it.
    await fetchPublishedSectorMap(client, 200);
    await fetchPublishedSectorMap(client, 0);
    expect(findMany).toHaveBeenCalledTimes(2);
    await fetchPublishedSectorMap(client, 1);
    expect(findMany).toHaveBeenCalledTimes(3);
    // Retention remains bounded even when entries are all expired.
    now += 60_000;
    await fetchPublishedSectorMap(client, 0);
    expect(findMany.mock.calls.at(-1)![0].columns.normalizedJson).toBeUndefined();
    await fetchPublishedSectorMap(client, 2);
    expect(findMany.mock.calls.at(-1)![0].columns.normalizedJson).toBe(true);
  });

  it("validates single-sector IDs and skips database work for an empty batch", async () => {
    const { client, findMany } = makeClient([]);
    expect((await fetchPublishedSectorMaps(client, [])).size).toBe(0);
    await expect(fetchPublishedSectorMap(client, -1)).rejects.toThrow(
      "Sector must be between",
    );
    expect(findMany).not.toHaveBeenCalled();
  });

  it("sends no normalizedJson column over the wire when an expired version is unchanged", async () => {
    const json = JSON.stringify(makeMap(4));
    const { database, statements } = planetScaleFixture((query) => {
      const hasBlob = query.includes("normalizedJson");
      return {
        fields: [
          { name: "sector", type: "INT32" },
          { name: "version", type: "INT32" },
          ...(hasBlob ? [{ name: "normalizedJson", type: "JSON" as const }] : []),
        ],
        rows: [hasBlob ? ["4", "1", json] : ["4", "1"]],
      };
    });
    const map = await fetchPublishedSectorMap(database, 4);
    now += 60_000;
    expect(await fetchPublishedSectorMap(database, 4)).toBe(map);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("normalizedJson");
    expect(statements[1]).not.toContain("normalizedJson");
    expect(statements[1]).toContain("PUBLISHED");
  });
});
