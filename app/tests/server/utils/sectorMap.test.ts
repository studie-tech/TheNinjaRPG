import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { SECTOR_MAP_VERSION } from "@/drizzle/constants";
import type { NormalizedSectorMap } from "@/libs/sector-map/types";
import type { DrizzleClient } from "@/server/db";
import { invalidateRuntimeCaches } from "@/server/utils/runtimeCache";
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

type MapRow = {
  id?: string;
  sector: number;
  version: number;
  normalizedJson: NormalizedSectorMap;
};
type MapQuery = {
  columns: { id: true; sector: true; version: true; normalizedJson?: true };
  where: SQL;
};

/** Honor sector filters and projections so tests detect unintended blob reads. */
const makeClient = (rows: MapRow[]) => {
  const findMany = vi.fn(async ({ columns, where }: MapQuery) => {
    const { params } = new MySqlDialect().sqlToQuery(where);
    return rows
      .filter((row) => params.includes(row.sector))
      .map((row) => {
        const id = row.id ?? `${row.sector}-${row.version}`;
        return columns.normalizedJson
          ? { ...row, id }
          : { id, sector: row.sector, version: row.version };
      });
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

  /** Whether a recorded query downloaded map blobs. */
  const readsBlob = (
    findMany: ReturnType<typeof makeClient>["findMany"],
    call: number,
  ) => findMany.mock.calls.at(call)![0].columns.normalizedJson === true;

  it("shares the highest published version between batch and single-sector reads", async () => {
    const newest = makeMap(5, "newest");
    const { client, findMany } = makeClient([
      { sector: 5, version: 1, normalizedJson: makeMap(5, "old") },
      { sector: 5, version: 3, normalizedJson: newest },
      { sector: 5, version: 2, normalizedJson: makeMap(5, "mid") },
    ]);
    expect((await fetchPublishedSectorMaps(client, [5, 5])).get(5)).toBe(newest);
    expect(await fetchPublishedSectorMap(client, 5)).toBe(newest);
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(readsBlob(findMany, 0)).toBe(false);
    expect(readsBlob(findMany, 1)).toBe(true);
  });

  it("revalidates expired maps with metadata only and renews the TTL", async () => {
    const map = makeMap(4);
    const { client, findMany } = makeClient([
      { sector: 4, version: 1, normalizedJson: map },
    ]);
    await fetchPublishedSectorMap(client, 4);
    now += 60_000;
    expect(await fetchPublishedSectorMap(client, 4)).toBe(map);
    expect(findMany).toHaveBeenCalledTimes(3);
    expect(findMany.mock.calls[2]![0].columns).toEqual({
      id: true,
      sector: true,
      version: true,
    });
    now += 59_999;
    expect((await fetchPublishedSectorMaps(client, [4])).get(4)).toBe(map);
    expect(findMany).toHaveBeenCalledTimes(3);
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
    expect(findMany).toHaveBeenCalledTimes(4);
    await expect(findMany.mock.results[3]!.value).resolves.toHaveLength(3);
    const { params } = new MySqlDialect().sqlToQuery(findMany.mock.calls[3]![0].where);
    expect(params).toEqual([2, "PUBLISHED"]);
  });

  it("detects an archived highest version and a completely unpublished sector", async () => {
    const old = { sector: 8, version: 1, normalizedJson: makeMap(8, "old") };
    const rows = [old, { sector: 8, version: 2, normalizedJson: makeMap(8, "new") }];
    const { client, findMany } = makeClient(rows);
    expect((await fetchPublishedSectorMap(client, 8)).name).toBe("new");
    rows.pop();
    now += 60_000;
    expect(await fetchPublishedSectorMap(client, 8)).toBe(old.normalizedJson);
    rows.pop();
    now += 60_000;
    expect((await fetchPublishedSectorMaps(client, [8])).has(8)).toBe(false);
    expect(readsBlob(findMany, -1)).toBe(false);
    await expect(fetchPublishedSectorMap(client, 8)).rejects.toThrow(
      "No published sector map",
    );
    // An unpublished sector costs the metadata probe alone.
    expect(readsBlob(findMany, -1)).toBe(false);
  });

  it("probes cold and expired sectors together and downloads only the cold blob", async () => {
    const rows = [{ sector: 1, version: 1, normalizedJson: makeMap(1) }];
    const { client, findMany } = makeClient(rows);
    await fetchPublishedSectorMap(client, 1);
    rows.push({ sector: 2, version: 1, normalizedJson: makeMap(2) });
    now += 60_000;
    expect((await fetchPublishedSectorMaps(client, [1, 2])).size).toBe(2);
    expect(findMany).toHaveBeenCalledTimes(4);
    const dialect = new MySqlDialect();
    expect(readsBlob(findMany, 2)).toBe(false);
    expect(dialect.sqlToQuery(findMany.mock.calls[2]![0].where).params).toEqual([
      2,
      1,
      "PUBLISHED",
    ]);
    expect(readsBlob(findMany, 3)).toBe(true);
    expect(dialect.sqlToQuery(findMany.mock.calls[3]![0].where).params).toEqual([
      2,
      "PUBLISHED",
    ]);
  });

  it("serves a new instance from shared entries without downloading blobs", async () => {
    const rows = [1, 2].map((sector) => ({
      sector,
      version: 1,
      normalizedJson: makeMap(sector),
    }));
    const { client, findMany } = makeClient(rows);
    await fetchPublishedSectorMaps(client, [1, 2]);
    // Another instance holds no decoded maps; clearing them all leaves shared entries.
    invalidatePublishedMapCache();
    const maps = await fetchPublishedSectorMaps(client, [1, 2]);
    expect(maps.get(1)).toEqual(rows[0]!.normalizedJson);
    expect(maps.get(2)).toEqual(rows[1]!.normalizedJson);
    expect(findMany).toHaveBeenCalledTimes(3);
    expect(readsBlob(findMany, 2)).toBe(false);
    // The served copy is now held, so the next call needs no query.
    await fetchPublishedSectorMaps(client, [1, 2]);
    expect(findMany).toHaveBeenCalledTimes(3);
  });

  it("never serves a shared entry for a row that is no longer the published one", async () => {
    const old = { sector: 8, version: 1, normalizedJson: makeMap(8, "old") };
    const rows: MapRow[] = [
      old,
      { sector: 8, version: 2, normalizedJson: makeMap(8, "new") },
    ];
    const { client, findMany } = makeClient(rows);
    await fetchPublishedSectorMap(client, 8);
    rows.pop();
    invalidatePublishedMapCache(8);
    expect(await fetchPublishedSectorMap(client, 8)).toBe(old.normalizedJson);
    expect(readsBlob(findMany, -1)).toBe(true);
    // A republished row with a reused version still differs by id.
    const replacement = {
      id: "other",
      sector: 8,
      version: 1,
      normalizedJson: makeMap(8),
    };
    rows[0] = replacement;
    invalidatePublishedMapCache(8);
    expect(await fetchPublishedSectorMap(client, 8)).toBe(replacement.normalizedJson);
    expect(readsBlob(findMany, -1)).toBe(true);
  });

  it("probes fresh held maps on request so an unpublished sector disappears at once", async () => {
    const rows = [{ sector: 6, version: 1, normalizedJson: makeMap(6) }];
    const { client, findMany } = makeClient(rows);
    await fetchPublishedSectorMap(client, 6);
    expect(
      (await fetchPublishedSectorMaps(client, [6], { revalidate: true })).has(6),
    ).toBe(true);
    expect(findMany).toHaveBeenCalledTimes(3);
    expect(readsBlob(findMany, 2)).toBe(false);
    rows.pop();
    expect((await fetchPublishedSectorMaps(client, [6])).has(6)).toBe(true);
    expect(
      (await fetchPublishedSectorMaps(client, [6], { revalidate: true })).has(6),
    ).toBe(false);
    expect(findMany).toHaveBeenCalledTimes(4);
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
    const dialect = new MySqlDialect();
    expect(dialect.sqlToQuery(findMany.mock.calls[2]![0].where).params).toEqual([
      1,
      "PUBLISHED",
    ]);
    expect(dialect.sqlToQuery(findMany.mock.calls[3]![0].where).params).toEqual([
      1,
      "PUBLISHED",
    ]);
    expect(readsBlob(findMany, 3)).toBe(true);
  });

  for (const stage of ["cold load", "unchanged probe", "changed load"] as const) {
    it(`does not repopulate the cache when invalidation races a ${stage}`, async () => {
      const rows: MapRow[] = [
        { id: "3-1", sector: 3, version: 1, normalizedJson: makeMap(3, "before") },
      ];
      const { client, findMany } = makeClient(rows);
      if (stage !== "cold load") {
        await fetchPublishedSectorMap(client, 3);
        now += 60_000;
      }
      if (stage === "changed load") {
        rows[0] = {
          id: "3-2",
          sector: 3,
          version: 2,
          normalizedJson: makeMap(3, "new"),
        };
        findMany.mockImplementationOnce(async () => [
          { id: "3-2", sector: 3, version: 2 } as never,
        ]);
      }
      // The released rows stand in for whichever projection the paused query selected.
      let release: (rows: never[]) => void = () => {};
      const { promise: started, resolve: markStarted } = deferred<void>();
      findMany.mockImplementationOnce(() => {
        markStarted();
        return new Promise<never[]>((resolve) => {
          release = resolve;
        });
      });
      const pending = fetchPublishedSectorMap(client, 3);
      await started;
      invalidatePublishedMapCache(stage === "unchanged probe" ? undefined : 3);
      release([...rows] as never[]);
      await pending;
      const calls = findMany.mock.calls.length;
      rows[0] = {
        id: "3-3",
        sector: 3,
        version: 3,
        normalizedJson: makeMap(3, "after"),
      };
      expect((await fetchPublishedSectorMap(client, 3)).name).toBe("after");
      // The probe proves no decoded map survived; only then does the blob load.
      expect(findMany).toHaveBeenCalledTimes(calls + 2);
      expect(readsBlob(findMany, calls)).toBe(false);
      expect(readsBlob(findMany, -1)).toBe(true);
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
    expect(findMany).toHaveBeenCalledTimes(4);
    expect(readsBlob(findMany, 3)).toBe(false);
  });

  it("does not extend a slow version probe's snapshot beyond the TTL", async () => {
    const row = { id: "1-1", sector: 1, version: 1, normalizedJson: makeMap(1) };
    const { client, findMany } = makeClient([row]);
    await fetchPublishedSectorMap(client, 1);
    now += 60_000;
    findMany.mockImplementationOnce(async () => {
      now += 60_000;
      return [row];
    });
    await fetchPublishedSectorMap(client, 1);
    await fetchPublishedSectorMap(client, 1);
    expect(findMany).toHaveBeenCalledTimes(4);
    expect(readsBlob(findMany, 3)).toBe(false);
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
    expect(findMany).toHaveBeenCalledTimes(4);
    // The evicted sector returns from its shared entry after a metadata probe.
    await fetchPublishedSectorMap(client, 1);
    expect(findMany).toHaveBeenCalledTimes(5);
    expect(readsBlob(findMany, -1)).toBe(false);
    // Retention remains bounded even when entries are all expired.
    now += 60_000;
    await fetchPublishedSectorMap(client, 0);
    expect(findMany).toHaveBeenCalledTimes(6);
    await invalidateRuntimeCaches();
    invalidatePublishedMapCache();
    await fetchPublishedSectorMap(client, 2);
    expect(readsBlob(findMany, -1)).toBe(true);
  });

  it("validates single-sector IDs and skips database work for an empty batch", async () => {
    const { client, findMany } = makeClient([]);
    expect((await fetchPublishedSectorMaps(client, [])).size).toBe(0);
    await expect(fetchPublishedSectorMap(client, -1)).rejects.toThrow(
      "Sector must be between",
    );
    expect(findMany).not.toHaveBeenCalled();
  });

  it("sends no normalizedJson column over the wire unless a blob is missing", async () => {
    const json = JSON.stringify(makeMap(4));
    const { database, statements } = planetScaleFixture((query) => {
      const hasBlob = query.includes("normalizedJson");
      return {
        fields: [
          { name: "id", type: "VARCHAR" },
          { name: "sector", type: "INT32" },
          { name: "version", type: "INT32" },
          ...(hasBlob ? [{ name: "normalizedJson", type: "JSON" as const }] : []),
        ],
        rows: [hasBlob ? ["map-4", "4", "1", json] : ["map-4", "4", "1"]],
      };
    });
    const map = await fetchPublishedSectorMap(database, 4);
    now += 60_000;
    expect(await fetchPublishedSectorMap(database, 4)).toBe(map);
    invalidatePublishedMapCache(4);
    expect(await fetchPublishedSectorMap(database, 4)).toEqual(map);
    expect(statements).toHaveLength(4);
    expect(statements[0]).not.toContain("normalizedJson");
    expect(statements[1]).toContain("normalizedJson");
    for (const statement of statements.slice(2)) {
      expect(statement).not.toContain("normalizedJson");
      expect(statement).toContain("PUBLISHED");
    }
  });
});
