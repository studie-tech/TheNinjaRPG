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
 *   bun run scripts/publish-sector-maps.ts --missing # preserve published maps
 *   bun run scripts/publish-sector-maps.ts --seed v2  # reroll layouts
 */
import { createHash } from "node:crypto";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getFlagValue, parseIntList } from "./cli";
import {
  MAP_SECTOR_ID_MAX,
  MAP_SECTOR_ID_MIN,
  SECTOR_HEIGHT,
  SECTOR_WIDTH,
} from "@/drizzle/constants";
import { sectorMap, userData } from "@/drizzle/schema";
import { mergeTerrainSpecs } from "@/libs/sector-map/terrains";
import { normalizeTiledSectorMap } from "@/libs/sector-map/tiled";
import { drizzleDB } from "@/server/db";
import { chunkArray } from "@/utils/array";
import { buildTiledJson } from "./generate-sector-map";

const CONCURRENCY = 10;

/**
 * Parse CLI flags. When --sectors is omitted the default is the FULL sector id
 * range (MAP_SECTOR_ID_MIN..MAP_SECTOR_ID_MAX), i.e. republishing every
 * sector; --missing excludes sectors with a published map, and --seed defaults
 * to "v1".
 */
const parseArgs = (argv: string[]) => {
  const sectorsArg = getFlagValue(argv, "--sectors");
  const sectors = sectorsArg
    ? parseIntList(sectorsArg)
    : Array.from(
        { length: MAP_SECTOR_ID_MAX - MAP_SECTOR_ID_MIN + 1 },
        (_, i) => i + MAP_SECTOR_ID_MIN,
      );
  return {
    sectors,
    seed: getFlagValue(argv, "--seed") ?? "v1",
    missing: argv.includes("--missing"),
  };
};

/** CLI entry: regenerate and publish maps for the requested sectors against the DB */
const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  // Aggregate history and occupied coordinates per sector, with bounded
  // batches so the database API's result-row limit cannot truncate the globe.
  const sectorBatches = chunkArray(args.sectors, 500);

  const [userTiles, villages, structures, existingMaps] = await Promise.all([
    Promise.all(
      sectorBatches.map((sectors) => {
        const occupied = drizzleDB
          .selectDistinct({
            sector: userData.sector,
            x: userData.longitude,
            y: userData.latitude,
          })
          .from(userData)
          .where(inArray(userData.sector, sectors))
          .as("occupied");
        return drizzleDB
          .select({
            sector: occupied.sector,
            tiles: sql<
              [number, number][]
            >`JSON_ARRAYAGG(JSON_ARRAY(${occupied.x}, ${occupied.y}))`.mapWith(
              (value: string | [number, number][]) =>
                typeof value === "string"
                  ? (JSON.parse(value) as [number, number][])
                  : value,
            ),
          })
          .from(occupied)
          .groupBy(occupied.sector);
      }),
    ).then((batches) => batches.flat()),
    drizzleDB.query.village.findMany({
      columns: { id: true, sector: true, type: true },
    }),
    drizzleDB.query.villageStructure.findMany({
      columns: { villageId: true, longitude: true, latitude: true },
    }),
    Promise.all(
      sectorBatches.map((sectors) =>
        drizzleDB
          .select({
            sector: sectorMap.sector,
            version: sql<number>`MAX(${sectorMap.version})`.mapWith(Number),
            isPublished:
              sql<number>`MAX(CASE WHEN ${sectorMap.status} = 'PUBLISHED' THEN 1 ELSE 0 END)`.mapWith(
                Number,
              ),
          })
          .from(sectorMap)
          .where(inArray(sectorMap.sector, sectors))
          .groupBy(sectorMap.sector),
      ),
    ).then((batches) => batches.flat()),
  ]);

  const occupiedBySector = new Map<number, { x: number; y: number }[]>();
  for (const row of userTiles) {
    occupiedBySector.set(
      row.sector,
      row.tiles.map(([x, y]) => ({ x, y })),
    );
  }
  const villageBySector = new Map(villages.map((v) => [v.sector, v]));
  const structuresByVillage = new Map<string, { x: number; y: number }[]>();
  for (const structure of structures) {
    const list = structuresByVillage.get(structure.villageId) ?? [];
    list.push({ x: structure.longitude, y: structure.latitude });
    structuresByVillage.set(structure.villageId, list);
  }
  const latestVersion = new Map<number, number>();
  const publishedSectors = new Set<number>();
  for (const map of existingMaps) {
    if (map.isPublished) publishedSectors.add(map.sector);
    latestVersion.set(map.sector, map.version);
  }
  const sectors = args.sectors.filter(
    (sector) => !args.missing || !publishedSectors.has(sector),
  );

  let published = 0;
  const failures: string[] = [];

  /**
   * Generate, validate, and publish a single sector's map. The generated Tiled
   * JSON is round-tripped through normalizeTiledSectorMap so only known-good
   * maps are stored, with user-occupied and village-structure tiles forced
   * walkable. The new PUBLISHED row is inserted with a bumped version BEFORE
   * the prior published rows are archived, so a failed insert leaves the old
   * map live.
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
    const version = (latestVersion.get(sector) ?? 0) + 1;
    // Insert the new PUBLISHED version FIRST, then archive the sector's prior
    // published rows. If the insert fails the sector keeps its existing published
    // map instead of being left all-archived.
    await drizzleDB.insert(sectorMap).values({
      id,
      sector,
      name: `Sector ${sector}`,
      width: result.map.width,
      height: result.map.height,
      status: "PUBLISHED",
      version,
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
          lt(sectorMap.version, version),
        ),
      );
    published++;
    if (published % 50 === 0) console.log(`Published ${published} sectors...`);
  };

  for (let i = 0; i < sectors.length; i += CONCURRENCY) {
    await Promise.all(
      sectors.slice(i, i + CONCURRENCY).map((sector) =>
        publishSector(sector).catch((error) => {
          // Drizzle includes both map blobs in its wrapper message; report the
          // database cause without dumping an entire sector into the CLI log.
          const cause =
            error instanceof Error && error.cause instanceof Error
              ? error.cause
              : error;
          failures.push(
            `${sector}: ${cause instanceof Error ? cause.message.split("\n")[0] : String(cause)}`,
          );
        }),
      ),
    );
  }

  console.log(
    `Done. Published: ${published}/${sectors.length}. Preserved: ${args.sectors.length - sectors.length}`,
  );
  if (failures.length > 0) {
    console.error("Failures:", failures.slice(0, 20).join(" | "));
  }
  process.exit(failures.length > 0 ? 1 : 0);
};

if (import.meta.main) {
  void main();
}
