/**
 * Generate the world as a cylindrical longitude/latitude sector grid projected
 * onto a sphere. The logical grid is 72 columns by 27 rows (1,944 stable ids):
 * east/west wraps continuously, while north/south terminate at non-navigable
 * polar caps. Every real neighbor therefore uses the same unrotated local frame.
 *
 * Sector id = row * MAP_WORLD_COLUMNS + column, with row 0 in the north. Output
 * follows GlobalMapData (src/libs/sector-map/world-types.ts).
 *
 * Usage (from /app): bun run scripts/generate-globe.ts
 *   [--villages 271,296,...]   additional ids that must be on land
 *   [--out src/data/hexasphere.json]
 */
import { writeFileSync } from "node:fs";
import {
  MAP_NAVIGABLE_LATITUDE_LIMIT,
  MAP_TOTAL_SECTORS,
  MAP_WORLD_COLUMNS,
  MAP_WORLD_ROWS,
} from "@/drizzle/constants";
import {
  sectorGridEntryEdges,
  sectorGridNeighbors,
  sectorGridPosition,
} from "@/libs/sector-map/world-grid";
import {
  createSectorGridLandScore,
  globalBiomeType,
  globalElevation,
  globalFeature,
  globalMoisture,
  globalTemperature,
  sectorGeometry,
  smoothstep,
  sphericalPoint,
  tilePosition,
  type Vec3,
  WORLDGEN_LAND_THRESHOLD,
  WORLDGEN_RADIUS,
} from "@/libs/sector-map/worldgen";
import { getWorldProtectedLandSectors } from "@/libs/sector-map/landmarks";
import { getFlagValue, parseIntList } from "./cli";

const VISUAL_SCALE = 6;
const POLAR_CAP_VISUAL_COLUMNS = MAP_WORLD_COLUMNS * VISUAL_SCALE;
const POLAR_CAP_VISUAL_ROWS = Math.ceil(
  (90 - MAP_NAVIGABLE_LATITUDE_LIMIT) /
    ((MAP_NAVIGABLE_LATITUDE_LIMIT * 2) / MAP_WORLD_ROWS / VISUAL_SCALE),
);
const LAND_THRESHOLD = WORLDGEN_LAND_THRESHOLD;

interface RawTile {
  id: number;
  corners: [Vec3, Vec3, Vec3, Vec3];
  center: Vec3;
}

/** Spherical quads of every sector. */
const buildTiles = (): RawTile[] =>
  Array.from({ length: MAP_TOTAL_SECTORS }, (_, id) => ({ id, ...sectorGeometry(id) }));

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
  // Keep snow below display-white so relief survives the linear-to-sRGB
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

  const tiles = buildTiles();
  const protectedSectors = getWorldProtectedLandSectors(villageSectors);
  const landScore = createSectorGridLandScore(protectedSectors);
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
      const point = tilePosition(
        tile.corners,
        x + 0.5,
        y + 0.5,
        VISUAL_SCALE + 1,
        VISUAL_SCALE + 1,
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
      const point = tilePosition(tile.corners, x, y, VISUAL_SCALE + 1, VISUAL_SCALE + 1);
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
  const polarCap = (sign: 1 | -1) =>
    Array.from(
      { length: (POLAR_CAP_VISUAL_ROWS + 1) * (POLAR_CAP_VISUAL_COLUMNS + 1) },
      (_, index) => {
        const column = index % (POLAR_CAP_VISUAL_COLUMNS + 1);
        const ring = Math.floor(index / (POLAR_CAP_VISUAL_COLUMNS + 1));
        if (ring === 0) return polarBoundaryColor(column, sign === 1);
        const longitude = -180 + (column / POLAR_CAP_VISUAL_COLUMNS) * 360;
        const latitude =
          sign *
          (MAP_NAVIGABLE_LATITUDE_LIMIT +
            (ring / POLAR_CAP_VISUAL_ROWS) * (90 - MAP_NAVIGABLE_LATITUDE_LIMIT));
        const point = sphericalPoint(longitude, latitude);
        return visualColorAt(point, landScore(point));
      },
    );
  const polarCapColors = { north: polarCap(1), south: polarCap(-1) };

  const payload = JSON.stringify({
    radius: WORLDGEN_RADIUS,
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
      `terrain ${JSON.stringify(counts)}, ${MAP_WORLD_COLUMNS * 2} blocked polar edges`,
  );
  console.log("Commit the generated topology with the code that consumes it.");
};

if (import.meta.main) main();
