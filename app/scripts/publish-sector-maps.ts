/**
 * Generate and publish procedural Tiled maps for all sectors (or a subset).
 *
 * Safety guards: every tile currently occupied by a user, every village
 * structure tile, and the full map perimeter stay walkable, so publishing
 * over a live sector cannot strand anyone.
 *
 * Usage (from the /app directory):
 *   bun run scripts/publish-sector-maps.ts            # all sectors
 *   bun run scripts/publish-sector-maps.ts --sectors 105,106
 *   bun run scripts/publish-sector-maps.ts --seed v2  # reroll layouts
 */
import { createHash } from "node:crypto";
import { and, eq, ne, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getFlagValue, parseIntList } from "./cli";
import {
  MAP_SECTOR_ID_MAX,
  MAP_SECTOR_ID_MIN,
  SECTOR_HEIGHT,
  SECTOR_WIDTH,
} from "@/drizzle/constants";
import { sectorMap } from "@/drizzle/schema";
import { mergeTerrainSpecs } from "@/libs/sector-map/terrains";
import { normalizeTiledSectorMap } from "@/libs/sector-map/tiled";
import { drizzleDB } from "@/server/db";
import { buildTiledJson } from "./generate-sector-map";

const CONCURRENCY = 10;

/**
 * Parse CLI flags. When --sectors is omitted the default is the FULL sector id
 * range (MAP_SECTOR_ID_MIN..MAP_SECTOR_ID_MAX), i.e. republishing every
 * sector; --seed defaults to "v1".
 */
const parseArgs = (argv: string[]) => {
  const sectorsArg = getFlagValue(argv, "--sectors");
  const sectors = sectorsArg
    ? parseIntList(sectorsArg)
    : Array.from(
        { length: MAP_SECTOR_ID_MAX - MAP_SECTOR_ID_MIN + 1 },
        (_, i) => i + MAP_SECTOR_ID_MIN,
      );
  return { sectors, seed: getFlagValue(argv, "--seed") ?? "v1" };
};

/** CLI entry: regenerate and publish maps for the requested sectors against the DB */
const main = async () => {
  const args = parseArgs(process.argv.slice(2));

  const [userTiles, villages, structures, existingMaps] = await Promise.all([
    drizzleDB.execute(sql`SELECT DISTINCT sector, longitude, latitude FROM UserData`),
    drizzleDB.query.village.findMany({
      columns: { id: true, sector: true, type: true },
    }),
    drizzleDB.query.villageStructure.findMany({
      columns: { villageId: true, longitude: true, latitude: true },
    }),
    drizzleDB.query.sectorMap.findMany({ columns: { sector: true, version: true } }),
  ]);

  const occupiedBySector = new Map<number, { x: number; y: number }[]>();
  for (const row of userTiles.rows as {
    sector: number;
    longitude: number;
    latitude: number;
  }[]) {
    const list = occupiedBySector.get(Number(row.sector)) ?? [];
    list.push({ x: Number(row.longitude), y: Number(row.latitude) });
    occupiedBySector.set(Number(row.sector), list);
  }
  const villageBySector = new Map(villages.map((v) => [v.sector, v]));
  const structuresByVillage = new Map<string, { x: number; y: number }[]>();
  for (const structure of structures) {
    const list = structuresByVillage.get(structure.villageId) ?? [];
    list.push({ x: structure.longitude, y: structure.latitude });
    structuresByVillage.set(structure.villageId, list);
  }
  const latestVersion = new Map<number, number>();
  for (const map of existingMaps) {
    latestVersion.set(
      map.sector,
      Math.max(latestVersion.get(map.sector) ?? 0, map.version),
    );
  }

  let published = 0;
  const failures: string[] = [];

  /**
   * Generate, validate, and publish a single sector's map. The generated Tiled
   * JSON is round-tripped through normalizeTiledSectorMap so only known-good
   * maps are stored, with user-occupied and village-structure tiles forced
   * walkable. The new PUBLISHED row is inserted with a bumped version BEFORE
   * the prior published rows are archived - PlanetScale has no transactions,
   * so this ordering guarantees a failed insert leaves the old map live.
   */
  const publishSector = async (sector: number) => {
    const village = villageBySector.get(sector);
    const ensureWalkable = [
      ...(occupiedBySector.get(sector) ?? []),
      ...(village ? (structuresByVillage.get(village.id) ?? []) : []),
    ];
    const tiledJson = buildTiledJson({
      sector,
      width: SECTOR_WIDTH,
      height: SECTOR_HEIGHT,
      village: !!village,
      seed: args.seed,
      ensureWalkable,
    });
    const result = normalizeTiledSectorMap({
      sector,
      name: `Sector ${sector}`,
      sourceHash: createHash("sha256").update(JSON.stringify(tiledJson)).digest("hex"),
      tiledJson,
      terrainRegistry: mergeTerrainSpecs([]),
    });
    if (!result.map) throw new Error(result.errors.join("; "));

    const now = new Date();
    const id = nanoid();
    // Insert the new PUBLISHED version FIRST, then archive the sector's prior
    // published rows (PlanetScale has no transactions). If the insert fails the
    // sector keeps its existing published map instead of being left all-archived.
    await drizzleDB.insert(sectorMap).values({
      id,
      sector,
      name: `Sector ${sector}`,
      width: result.map.width,
      height: result.map.height,
      status: "PUBLISHED",
      version: (latestVersion.get(sector) ?? 0) + 1,
      sourceHash: result.map.metadata.sourceHash,
      rawTiledJson: tiledJson,
      normalizedJson: result.map,
      publishedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await drizzleDB
      .update(sectorMap)
      .set({ status: "ARCHIVED", updatedAt: now })
      .where(
        and(
          eq(sectorMap.sector, sector),
          eq(sectorMap.status, "PUBLISHED"),
          ne(sectorMap.id, id),
        ),
      );
    published++;
    if (published % 50 === 0) console.log(`Published ${published} sectors...`);
  };

  for (let i = 0; i < args.sectors.length; i += CONCURRENCY) {
    await Promise.all(
      args.sectors.slice(i, i + CONCURRENCY).map((sector) =>
        publishSector(sector).catch((error) => {
          failures.push(
            `${sector}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }),
      ),
    );
  }

  console.log(`Done. Published: ${published}/${args.sectors.length}`);
  if (failures.length > 0) {
    console.error("Failures:", failures.slice(0, 20).join(" | "));
  }
  process.exit(failures.length > 0 ? 1 : 0);
};

if (import.meta.main) {
  void main();
}
