/**
 * Generate the world as a cylindrical longitude/latitude sector grid projected
 * onto a sphere. The logical grid is 72 columns by 27 rows (1,944 stable ids):
 * east/west wraps continuously, while north/south terminate at non-navigable
 * polar caps. Every real neighbor therefore uses the same unrotated local frame.
 *
 * Sector id = row * MAP_WORLD_COLUMNS + column, with row 0 in the north. Output
 * keeps the existing { radius, tiles: [{ c, b[4], t, n, ne }] } schema so the
 * server, global map, authored sector maps and database sector references remain
 * compatible.
 *
 * Usage (from /app): bun run scripts/generate-globe.ts
 *   [--villages 271,296,...]   additional ids that must be on land
 *   [--out src/data/hexasphere.json]
 */
import { writeFileSync } from "node:fs";
import {
  MAP_NAVIGABLE_LATITUDE_LIMIT,
  MAP_RESERVED_SECTORS,
  MAP_SECTOR_ID_MAX,
  MAP_TOTAL_SECTORS,
  MAP_WAKE_ISLAND_SECTOR,
  MAP_WAR_TORN_BATTLEGROUND_SECTOR,
  MAP_WORLD_COLUMNS,
  MAP_WORLD_ROWS,
} from "@/drizzle/constants";
import {
  sectorGridEntryEdges,
  sectorGridNeighbors,
  sectorGridPosition,
} from "@/libs/sector-map/world-grid";
import {
  createWorldLandScore,
  globalBiomeType,
  globalElevation,
  globalFeature,
  globalMoisture,
  globalTemperature,
  WORLDGEN_LAND_THRESHOLD,
  WORLDGEN_WAKE_ISLAND_RADIUS_FACTOR,
} from "@/libs/sector-map/worldgen";
import { WORLD_PROTECTED_LAND_SECTORS } from "@/libs/sector-map/landmarks";
import { getFlagValue, parseIntList } from "./cli";

const RADIUS = 30;
const TILE_COUNT = MAP_WORLD_COLUMNS * MAP_WORLD_ROWS;
const VISUAL_SCALE = 6;
const POLAR_CAP_VISUAL_COLUMNS = MAP_WORLD_COLUMNS * VISUAL_SCALE;
const POLAR_CAP_VISUAL_ROWS = Math.ceil(
  (90 - MAP_NAVIGABLE_LATITUDE_LIMIT) /
    ((MAP_NAVIGABLE_LATITUDE_LIMIT * 2) / MAP_WORLD_ROWS / VISUAL_SCALE),
);
const LAND_THRESHOLD = WORLDGEN_LAND_THRESHOLD;

type Vec3 = { x: number; y: number; z: number };

interface RawTile {
  id: number;
  corners: [Vec3, Vec3, Vec3, Vec3];
  center: Vec3;
}

const degreesToRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** Spherical point with +Y as north and longitude rotating around the Y axis. */
const pointAt = (longitude: number, latitude: number): Vec3 => {
  const lon = degreesToRadians(longitude);
  const lat = degreesToRadians(latitude);
  const horizontal = Math.cos(lat) * RADIUS;
  return {
    x: Math.cos(lon) * horizontal,
    y: Math.sin(lat) * RADIUS,
    z: Math.sin(lon) * horizontal,
  };
};

/** Geographic bounds of one row-major sector. */
export const sectorGeographicBounds = (sector: number) => {
  const position = sectorGridPosition(sector);
  if (!position) throw new Error(`Invalid sector ${sector}`);
  const longitudeStep = 360 / MAP_WORLD_COLUMNS;
  const latitudeStep = (MAP_NAVIGABLE_LATITUDE_LIMIT * 2) / MAP_WORLD_ROWS;
  return {
    west: -180 + position.column * longitudeStep,
    east: -180 + (position.column + 1) * longitudeStep,
    north: MAP_NAVIGABLE_LATITUDE_LIMIT - position.row * latitudeStep,
    south: MAP_NAVIGABLE_LATITUDE_LIMIT - (position.row + 1) * latitudeStep,
  };
};

/** Build spherical quads in canonical [NW, NE, SE, SW] order. */
const buildTiles = (): RawTile[] =>
  Array.from({ length: TILE_COUNT }, (_, id) => {
    const bounds = sectorGeographicBounds(id);
    return {
      id,
      corners: [
        pointAt(bounds.west, bounds.north),
        pointAt(bounds.east, bounds.north),
        pointAt(bounds.east, bounds.south),
        pointAt(bounds.west, bounds.south),
      ],
      center: pointAt(
        (bounds.west + bounds.east) / 2,
        (bounds.north + bounds.south) / 2,
      ),
    };
  });

/** Bilinear sector position, normalized back onto the globe surface. */
const tilePointAt = (tile: RawTile, u: number, v: number): Vec3 => {
  const [nw, ne, se, sw] = tile.corners;
  const top = {
    x: nw.x + (ne.x - nw.x) * u,
    y: nw.y + (ne.y - nw.y) * u,
    z: nw.z + (ne.z - nw.z) * u,
  };
  const bottom = {
    x: sw.x + (se.x - sw.x) * u,
    y: sw.y + (se.y - sw.y) * u,
    z: sw.z + (se.z - sw.z) * u,
  };
  const point = {
    x: top.x + (bottom.x - top.x) * v,
    y: top.y + (bottom.y - top.y) * v,
    z: top.z + (bottom.z - top.z) * v,
  };
  const length = Math.hypot(point.x, point.y, point.z) || 1;
  return {
    x: (point.x / length) * RADIUS,
    y: (point.y / length) * RADIUS,
    z: (point.z / length) * RADIUS,
  };
};

/**
 * Deterministic hierarchical continental field sampled in 3D, so the east/west
 * antimeridian has no noise discontinuity. Protected and supplied village ids
 * receive smooth land influence around their centers. Wake Island remains
 * isolated.
 */
const createLandScore = (tiles: RawTile[], protectedSectors: number[]) => {
  const protectedCenters = protectedSectors
    .filter((sector) => sector !== MAP_WAKE_ISLAND_SECTOR)
    .map((sector) => tiles[sector]?.center)
    .filter((center): center is Vec3 => center !== undefined);
  const wakeNeighbors = new Set(
    sectorGridNeighbors(MAP_WAKE_ISLAND_SECTOR).filter((sector) => sector >= 0),
  );
  const wakeCenter = tiles[MAP_WAKE_ISLAND_SECTOR]!.center;
  const wakeIslandRadius =
    Math.min(
      ...[...wakeNeighbors].map((sector) => {
        const center = tiles[sector]!.center;
        return Math.hypot(
          wakeCenter.x - center.x,
          wakeCenter.y - center.y,
          wakeCenter.z - center.z,
        );
      }),
    ) * WORLDGEN_WAKE_ISLAND_RADIUS_FACTOR;
  const wakeMoatRadius = Math.max(
    ...[...wakeNeighbors].flatMap((sector) =>
      tiles[sector]!.corners.map((corner) =>
        Math.hypot(
          wakeCenter.x - corner.x,
          wakeCenter.y - corner.y,
          wakeCenter.z - corner.z,
        ),
      ),
    ),
  );

  return createWorldLandScore({
    protectedCenters,
    wakeIslandCenter: wakeCenter,
    wakeIslandRadius,
    wakeMoatRadius,
  });
};

const smoothstep = (low: number, high: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
};

type Rgb = [number, number, number];
const mixColor = (a: Rgb, b: Rgb, amount: number): Rgb => [
  a[0] + (b[0] - a[0]) * amount,
  a[1] + (b[1] - a[1]) * amount,
  a[2] + (b[2] - a[2]) * amount,
];
const packColor = (color: Rgb) =>
  (Math.round(color[0]) << 16) | (Math.round(color[1]) << 8) | Math.round(color[2]);

const shadeColor = (color: Rgb, amount: number): Rgb =>
  color.map((channel) => Math.max(0, Math.min(255, channel * (1 + amount)))) as Rgb;

/** Continuous display color; gameplay terrain remains categorical in `t`/`v`. */
const visualColorAt = (point: Vec3, landScore: number): number => {
  const elevation = globalElevation(point);
  const temperature = globalTemperature(point, elevation);
  const moisture = globalMoisture(point, elevation);
  const water: Rgb = [63, 158, 217];
  const grass: Rgb = [60, 193, 100];
  const desert: Rgb = [231, 205, 137];
  // Keep snow below display-white so relief survives three.js' linear-to-sRGB
  // conversion instead of clipping into a featureless white surface.
  const ice: Rgb = [218, 235, 240];
  const desertWeight =
    smoothstep(0.02, 0.25, temperature) * (1 - smoothstep(-0.2, 0.05, moisture));
  const iceWeight = 1 - smoothstep(-0.24, -0.02, temperature);
  const land = mixColor(mixColor(grass, desert, desertWeight), ice, iceWeight);
  const terrainColor = mixColor(water, land, smoothstep(-0.035, 0.035, landScore));
  // Deterministic relief keeps large single-biome regions (especially polar
  // snow) visually legible. The same shading is applied to sectors and caps.
  const relief = elevation * 0.14 + globalFeature(point) * 0.055 - 0.045;
  return packColor(shadeColor(terrainColor, relief));
};

const main = () => {
  const argv = process.argv.slice(2);
  const out = getFlagValue(argv, "--out") ?? "src/data/hexasphere.json";
  const villageSectors = parseIntList(getFlagValue(argv, "--villages"));

  if (MAP_TOTAL_SECTORS !== TILE_COUNT || MAP_SECTOR_ID_MAX !== TILE_COUNT - 1) {
    throw new Error("World-grid dimensions must match the configured sector-id range");
  }

  const tiles = buildTiles();
  const protectedSectors = [
    ...new Set([
      ...MAP_RESERVED_SECTORS,
      ...WORLD_PROTECTED_LAND_SECTORS,
      ...villageSectors,
      MAP_WAKE_ISLAND_SECTOR,
      MAP_WAR_TORN_BATTLEGROUND_SECTOR,
    ]),
  ];
  const landScore = createLandScore(tiles, protectedSectors);
  const land = tiles.map((tile) => landScore(tile.center) > 0);

  const outTiles = tiles.map((tile) => ({
    c: tile.center,
    b: tile.corners.map((point) => ({
      x: point.x.toFixed(3),
      y: point.y.toFixed(3),
      z: point.z.toFixed(3),
    })),
    t: globalBiomeType(tile.center, land[tile.id]!, globalElevation(tile.center)),
    v: Array.from({ length: VISUAL_SCALE * VISUAL_SCALE }, (_, index) => {
      const x = index % VISUAL_SCALE;
      const y = Math.floor(index / VISUAL_SCALE);
      const point = tilePointAt(
        tile,
        (x + 0.5) / VISUAL_SCALE,
        (y + 0.5) / VISUAL_SCALE,
      );
      return globalBiomeType(
        point,
        landScore(point) > 0,
        globalElevation(point),
      );
    }),
    vc: Array.from({ length: (VISUAL_SCALE + 1) ** 2 }, (_, index) => {
      const x = index % (VISUAL_SCALE + 1);
      const y = Math.floor(index / (VISUAL_SCALE + 1));
      const point = tilePointAt(tile, x / VISUAL_SCALE, y / VISUAL_SCALE);
      return visualColorAt(point, landScore(point));
    }),
    n: sectorGridNeighbors(tile.id),
    ne: sectorGridEntryEdges(tile.id),
  }));

  // Smooth, non-interactive polar caps use the same continuous climate colors
  // as the navigable world. Ring 0 is exactly the +/-latitudeLimit boundary,
  // so its colors match the first/last sector rows without adding polar edges.
  const sectorStride = VISUAL_SCALE + 1;
  const polarBoundaryColor = (column: number, north: boolean) => {
    const sectorColumn = Math.min(
      MAP_WORLD_COLUMNS - 1,
      Math.floor(column / VISUAL_SCALE),
    );
    const localColumn = column - sectorColumn * VISUAL_SCALE;
    const sector = north
      ? sectorColumn
      : (MAP_WORLD_ROWS - 1) * MAP_WORLD_COLUMNS + sectorColumn;
    const rowOffset = north ? 0 : VISUAL_SCALE * sectorStride;
    return outTiles[sector]!.vc[rowOffset + localColumn]!;
  };
  const polarCapColors = {
    north: Array.from(
      { length: (POLAR_CAP_VISUAL_ROWS + 1) * (POLAR_CAP_VISUAL_COLUMNS + 1) },
      (_, index) => {
        const column = index % (POLAR_CAP_VISUAL_COLUMNS + 1);
        const ring = Math.floor(index / (POLAR_CAP_VISUAL_COLUMNS + 1));
        if (ring === 0) return polarBoundaryColor(column, true);
        const longitude = -180 + (column / POLAR_CAP_VISUAL_COLUMNS) * 360;
        const latitude =
          MAP_NAVIGABLE_LATITUDE_LIMIT +
          (ring / POLAR_CAP_VISUAL_ROWS) * (90 - MAP_NAVIGABLE_LATITUDE_LIMIT);
        const point = pointAt(longitude, latitude);
        return visualColorAt(point, landScore(point));
      },
    ),
    south: Array.from(
      { length: (POLAR_CAP_VISUAL_ROWS + 1) * (POLAR_CAP_VISUAL_COLUMNS + 1) },
      (_, index) => {
        const column = index % (POLAR_CAP_VISUAL_COLUMNS + 1);
        const ring = Math.floor(index / (POLAR_CAP_VISUAL_COLUMNS + 1));
        if (ring === 0) return polarBoundaryColor(column, false);
        const longitude = -180 + (column / POLAR_CAP_VISUAL_COLUMNS) * 360;
        const latitude =
          -MAP_NAVIGABLE_LATITUDE_LIMIT -
          (ring / POLAR_CAP_VISUAL_ROWS) * (90 - MAP_NAVIGABLE_LATITUDE_LIMIT);
        const point = pointAt(longitude, latitude);
        return visualColorAt(point, landScore(point));
      },
    ),
  };

  let missing = 0;
  let nonReciprocal = 0;
  let rotated = 0;
  for (let id = 0; id < TILE_COUNT; id++) {
    for (let edge = 0; edge < 4; edge++) {
      const neighbor = outTiles[id]!.n[edge]!;
      const entryEdge = outTiles[id]!.ne[edge]!;
      if (neighbor < 0) {
        missing++;
        if (entryEdge !== -1) nonReciprocal++;
        continue;
      }
      if (entryEdge !== (edge + 2) % 4) rotated++;
      if (
        outTiles[neighbor]?.n[entryEdge] !== id ||
        outTiles[neighbor]?.ne[entryEdge] !== edge
      ) {
        nonReciprocal++;
      }
    }
  }
  const expectedMissing = MAP_WORLD_COLUMNS * 2;
  if (missing !== expectedMissing || nonReciprocal !== 0 || rotated !== 0) {
    throw new Error(
      `Invalid cylindrical topology: ${missing} missing, ${nonReciprocal} non-reciprocal, ${rotated} rotated`,
    );
  }

  const payload = JSON.stringify({
    radius: RADIUS,
    projection: "cylindrical",
    generation: "hierarchical-climate-v7-continuous-protection",
    visualScale: VISUAL_SCALE,
    polarCapColumns: POLAR_CAP_VISUAL_COLUMNS,
    polarCapRows: POLAR_CAP_VISUAL_ROWS,
    polarCapColors,
    landThreshold: LAND_THRESHOLD,
    protectedLandSectors: protectedSectors,
    columns: MAP_WORLD_COLUMNS,
    rows: MAP_WORLD_ROWS,
    latitudeLimit: MAP_NAVIGABLE_LATITUDE_LIMIT,
    tiles: outTiles,
  });
  writeFileSync(out, payload);

  const counts = outTiles.reduce<Record<number, number>>((acc, tile) => {
    acc[tile.t] = (acc[tile.t] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `Wrote ${out}: ${MAP_WORLD_COLUMNS}x${MAP_WORLD_ROWS} cylindrical sectors, ` +
      `terrain ${JSON.stringify(counts)}, ${missing} blocked polar edges`,
  );
  console.log("Commit the generated topology with the code that consumes it.");
};

if (import.meta.main) main();
