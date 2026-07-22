/**
 * Procedurally generate authored sector maps as Tiled JSON files.
 *
 * The output matches the format consumed by `normalizeTiledSectorMap`
 * (hexagonal orientation, flat-top hexes, odd-q stagger) and can be
 * uploaded directly on /manual/travel/sector-maps or imported via the
 * worldMap.saveTiledSectorMap endpoint.
 *
 * Usage (from the /app directory):
 *   bun run scripts/generate-sector-map.ts --sectors 105,106 --village
 *   bun run scripts/generate-sector-map.ts --sectors 300 --out generated-maps
 *
 * Options:
 *   --sectors          Comma-separated sector ids (required)
 *   --village          Village sector: village zone everywhere, roads and
 *                      structure anchors, only light scenery accents
 *   --ensure-walkable  Semicolon-separated "x,y" tiles that must stay walkable
 *                      (use for tiles occupied by users/structures when
 *                      publishing to a live sector)
 *   --out              Output directory (default: generated-maps)
 *   --width            Map width in tiles (default: SECTOR_WIDTH)
 *   --height           Map height in tiles (default: SECTOR_HEIGHT)
 *   --seed             Extra seed string mixed into the per-sector RNG
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import alea from "alea";
import { createNoise2D } from "simplex-noise";
import * as globalMapData from "@/data/hexasphere.json";
import {
  MAP_RESERVED_SECTORS,
  MAP_WAKE_ISLAND_SECTOR,
  MAP_WAR_TORN_BATTLEGROUND_SECTOR,
  SECTOR_HEIGHT,
  SECTOR_MAP_MAX_DIMENSION,
  SECTOR_WIDTH,
} from "@/drizzle/constants";
import { generateDecorationPlacements } from "@/libs/sector-map/decorations";
import { BUILTIN_TERRAINS_BY_KEY, mergeTerrainSpecs } from "@/libs/sector-map/terrains";
import { isValidSectorId } from "@/libs/sector-map/sector-ids";
import {
  hexTileToPixel,
  TILED_HEX_SIDE_LENGTH,
  TILED_TILE_HEIGHT,
  TILED_TILE_WIDTH,
} from "@/libs/sector-map/tiled";
import { getNeighborCoordinates } from "@/libs/sector-map/validation";
import { getBiomeFromTileType } from "@/libs/travel";
import { getSectorTileType } from "@/server/utils/sectorMap";
import { getFlagValue, parseIntList } from "./cli";
import {
  createWorldLandScore,
  globalBiomeType,
  globalElevation,
  globalFeature,
  tilePosition,
  WORLDGEN_WAKE_ISLAND_RADIUS_FACTOR,
  type Vec3,
} from "@/libs/sector-map/worldgen";
import { WORLD_PROTECTED_LAND_SECTORS } from "@/libs/sector-map/landmarks";
import { normalizeTiledSectorMap } from "@/libs/sector-map/tiled";
import type { SectorMapZone } from "@/libs/sector-map/types";
import type { GlobalMapData } from "@/libs/threejs/types";

const globalMap = globalMapData as unknown as GlobalMapData;

interface CellSpec {
  terrain: string;
  zone: SectorMapZone;
  blocked: boolean;
  walkCost: number;
  battleBiome?: string;
  decoration?: boolean;
}

export interface GeneratorOptions {
  sector: number;
  width: number;
  height: number;
  village: boolean;
  seed: string;
  ensureWalkable: { x: number; y: number }[];
}

interface AnchorSpec {
  key: string;
  x: number;
  y: number;
}

/** Base biome of the sector on the global hexasphere map */
const getBaseTerrain = (sector: number): string =>
  getBiomeFromTileType(getSectorTileType(sector));

/**
 * The sector's four 3D corner points in [NW, NE, SE, SW] order - the order
 * tilePosition's bilinear interpolation relies on. hexasphere.json stores
 * corner coordinates as strings, so the unary + coerces them to numbers.
 */
const cornerVecs = (sector: number): [Vec3, Vec3, Vec3, Vec3] => {
  const b = globalMap.tiles[sector]!.b;
  return b.map((p) => ({ x: +p.x, y: +p.y, z: +p.z })) as [Vec3, Vec3, Vec3, Vec3];
};

/** The sector's 3D center point on the globe */
const centerVec = (sector: number): Vec3 => {
  const c = globalMap.tiles[sector]!.c;
  return { x: c.x, y: c.y, z: c.z };
};

const protectedLandSectors =
  globalMap.protectedLandSectors ??
  [
    ...MAP_RESERVED_SECTORS,
    ...WORLD_PROTECTED_LAND_SECTORS,
    MAP_WAKE_ISLAND_SECTOR,
    MAP_WAR_TORN_BATTLEGROUND_SECTOR,
  ];
const wakeIslandCenter = centerVec(MAP_WAKE_ISLAND_SECTOR);
const wakeIslandNeighborSectors = new Set(
  (globalMap.tiles[MAP_WAKE_ISLAND_SECTOR]?.n ?? []).filter((sector) => sector >= 0),
);
const wakeIslandRadius =
  Math.min(
    ...[...wakeIslandNeighborSectors].map((sector) => {
      const center = centerVec(sector);
      return Math.hypot(
        wakeIslandCenter.x - center.x,
        wakeIslandCenter.y - center.y,
        wakeIslandCenter.z - center.z,
      );
    }),
  ) * WORLDGEN_WAKE_ISLAND_RADIUS_FACTOR;
const wakeMoatRadius = Math.max(
  ...[...wakeIslandNeighborSectors].flatMap((sector) =>
    globalMap.tiles[sector]!.b.map((corner) =>
      Math.hypot(
        wakeIslandCenter.x - +corner.x,
        wakeIslandCenter.y - +corner.y,
        wakeIslandCenter.z - +corner.z,
      ),
    ),
  ),
);
const worldLandScore = createWorldLandScore({
  protectedCenters: protectedLandSectors
    .filter((sector) => sector !== MAP_WAKE_ISLAND_SECTOR)
    .map(centerVec),
  wakeIslandCenter,
  wakeIslandRadius,
  wakeMoatRadius,
});

/** Anchor keys mirror the legacy sector anchor layout so downstream lookups keep working */
const buildAnchors = (options: GeneratorOptions): AnchorSpec[] => {
  const { width, height, village } = options;
  const spawnX = Math.floor(width / 2);
  const spawnY = Math.max(1, Math.round(height * 0.27));
  const midY = Math.floor(height / 2);
  const anchors: AnchorSpec[] = [
    { key: "spawn.default", x: spawnX, y: spawnY },
    { key: "shrine.default", x: spawnX, y: Math.max(1, spawnY - 2) },
    { key: "exit.north", x: spawnX, y: 0 },
    { key: "exit.south", x: spawnX, y: height - 1 },
    { key: "exit.west", x: 0, y: midY },
    { key: "exit.east", x: width - 1, y: midY },
  ];
  if (village) {
    anchors.push(
      { key: "spawn.village", x: spawnX, y: spawnY },
      { key: "structure.alliancehall", x: spawnX, y: spawnY },
      {
        key: "structure.hospital",
        x: Math.min(width - 2, spawnX + 3),
        y: Math.min(height - 2, spawnY + 1),
      },
    );
  }
  return anchors;
};

/**
 * Generate the sector's cell grid and anchors, deterministic per sector+seed
 * (alea RNG). Worldgen fields are sampled at each tile's true 3D globe
 * position so terrain and biomes line up with neighbouring sectors across
 * every shared edge. Walkability is guaranteed for the full perimeter, the
 * road spine, all anchors, and the ensureWalkable tiles; a flood fill from
 * spawn then blocks any walkable pockets that cannot be reached. A final pass
 * turns walkable grass shorelines into sand.
 */
const generateCells = (options: GeneratorOptions) => {
  const { sector, width, height, village, seed } = options;
  const baseTerrain = getBaseTerrain(sector);
  const prng = alea(`sector-${sector}-${seed}`);
  const roadNoise = createNoise2D(prng);

  const anchors = buildAnchors(options);
  const spawn = anchors.find((anchor) => anchor.key === "spawn.default");
  if (!spawn) throw new Error("Missing spawn anchor");
  const midY = Math.floor(height / 2);

  // Coherent world fields, sampled at each tile's true 3D position so features
  // and biomes line up with neighbouring sectors along every shared edge.
  const corners = cornerVecs(sector);
  // Authored/rendered map y increases northward, whereas tilePosition follows
  // the globe corner order with y=0 at geographic north. Reflect exactly once
  // here, matching resolveSectorMapEdgeCrossing's coordinate adapter.
  const worldPositionAt = (x: number, y: number) =>
    tilePosition(corners, x, height - 1 - y, width, height);

  const cells: CellSpec[][] = [];
  // Per-tile helpers used when forcing perimeter/road/anchor tiles walkable:
  // the land biome a tile should show if drained, and whether it is genuine
  // open sea (which remains water when a road or anchor crosses it).
  const intendedLand: string[][] = [];
  const isSea: boolean[][] = [];
  for (let y = 0; y < height; y++) {
    const row: CellSpec[] = [];
    const landRow: string[] = [];
    const seaRow: boolean[] = [];
    for (let x = 0; x < width; x++) {
      const position = worldPositionAt(x, y);
      const elevation = globalElevation(position);
      const feature = globalFeature(position);
      const voteTerrain = getBiomeFromTileType(
        globalBiomeType(position, worldLandScore(position) > 0, elevation),
      );
      const landTerrain = getBiomeFromTileType(globalBiomeType(position, true, elevation));
      let cell: CellSpec = {
        terrain: landTerrain,
        zone: "wilderness",
        blocked: false,
        walkCost: 1,
      };
      let sea = false;
      if (village) {
        // A village changes gameplay zones and guarantees its paths/anchors,
        // but does not repaint the underlying global biome. Coastal villages
        // and Wake Island therefore retain the water visible on the globe.
        if (voteTerrain === "ocean") {
          cell = { terrain: "ocean", zone: "water", blocked: false, walkCost: 1 };
          sea = true;
        } else {
          cell = { terrain: voteTerrain, zone: "village", blocked: false, walkCost: 1 };
          if (elevation > 0.68) {
            cell = {
              terrain: voteTerrain,
              zone: "village",
              blocked: true,
              walkCost: 0,
            };
          }
        }
        landRow.push(landTerrain);
      } else if (voteTerrain === "ocean") {
        // Open sea with scattered islands where the elevation field rises
        cell = { terrain: "ocean", zone: "wilderness", blocked: false, walkCost: 1 };
        sea = true;
        if (elevation > 0.42) {
          cell = { terrain: landTerrain, zone: "wilderness", blocked: false, walkCost: 1 };
          sea = false;
        }
        landRow.push(landTerrain);
      } else {
        // Walkable lakes in low ground (rare in deserts), impassable rocks in
        // high ground. Ninja traverse standard water with chakra at land speed.
        const lakeLevel = voteTerrain === "dessert" ? -0.72 : -0.52;
        if (elevation < lakeLevel) {
          cell = { terrain: "ocean", zone: "water", blocked: false, walkCost: 1 };
        } else if (elevation > (voteTerrain === "dessert" ? 0.55 : 0.58)) {
          cell = { terrain: voteTerrain, zone: "wilderness", blocked: true, walkCost: 0 };
        } else if (voteTerrain === "ice" && feature > 0.35) {
          cell = { terrain: "snow", zone: "wilderness", blocked: false, walkCost: 2 };
        }
        landRow.push(voteTerrain);
      }
      row.push(cell);
      seaRow.push(sea);
    }
    cells.push(row);
    intendedLand.push(landRow);
    isSea.push(seaRow);
  }

  // Carve a cell walkable (unblock + restore a sane walk/swim cost),
  // optionally reassigning its zone
  const setWalkable = (x: number, y: number, zone?: SectorMapZone) => {
    const cell = cells[y]?.[x];
    if (!cell) return;
    cell.blocked = false;
    if (isSea[y]?.[x]) {
      // Genuine open sea stays water so the coastline is not broken by a ring
      // of forced land along the perimeter.
      if (cell.walkCost <= 0) cell.walkCost = 1;
    } else {
      if (cell.walkCost <= 0) cell.walkCost = 1;
      if (cell.terrain === "ocean") cell.terrain = intendedLand[y]?.[x] ?? baseTerrain;
      if (cell.zone === "water") cell.zone = village ? "village" : "wilderness";
    }
    if (zone) cell.zone = zone;
  };

  // Carve connecting paths between spawn and the four edge exits. The
  // walkable spine stays straight (so anchors/occupied tiles connect
  // deterministically) while the painted road wanders a little so it does
  // not look ruler-drawn. Roads only get the road zone inside villages.
  const roadZone = (x: number, y: number): SectorMapZone | undefined => {
    return village && cells[y]?.[x]?.zone !== "water" ? "road" : undefined;
  };
  // Single-tile winding roads: adjacent hex columns/rows share edges even on
  // diagonal steps, so a one-tile-wide wander stays visually connected
  const jitterAt = (t: number, tMax: number, phase: number) => {
    const edgeDistance = Math.min(t, tMax - t);
    const amplitude = Math.min(1, Math.floor(edgeDistance / 2));
    return Math.round(roadNoise(t * 0.18, phase) * amplitude);
  };
  for (let y = 0; y < height; y++) {
    setWalkable(spawn.x, y);
    // Straighten near the crossroads so the junction stays a clean plus shape
    const roadX =
      Math.abs(y - midY) <= 1 ? spawn.x : spawn.x + jitterAt(y, height - 1, 7.3);
    setWalkable(roadX, y, roadZone(roadX, y));
  }
  for (let x = 0; x < width; x++) {
    setWalkable(x, midY);
    const roadY =
      Math.abs(x - spawn.x) <= 1 ? midY : midY + jitterAt(x, width - 1, 13.7);
    setWalkable(x, roadY, roadZone(x, roadY));
  }

  // Force anchor tiles walkable and connect them to the vertical carve
  anchors.forEach((anchor) => {
    setWalkable(anchor.x, anchor.y);
    const step = anchor.x > spawn.x ? -1 : 1;
    for (let x = anchor.x; x !== spawn.x; x += step) {
      setWalkable(x, anchor.y);
    }
  });

  // The full perimeter stays walkable: global travel drops players on the
  // edge coordinates they left the previous sector from, so any border tile
  // can become an arrival point
  for (let x = 0; x < width; x++) {
    setWalkable(x, 0);
    setWalkable(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    setWalkable(0, y);
    setWalkable(width - 1, y);
  }

  // Occupied tiles (users/structures) must stay walkable and connected
  options.ensureWalkable
    .filter((tile) => tile.x >= 0 && tile.y >= 0 && tile.x < width && tile.y < height)
    .forEach((tile) => {
      setWalkable(tile.x, tile.y);
      const step = tile.x > spawn.x ? -1 : 1;
      for (let x = tile.x; x !== spawn.x; x += step) {
        setWalkable(x, tile.y);
      }
    });

  // Flood fill from spawn; block walkable pockets that cannot be reached so
  // the stored map never reports tiles the server would reject anyway.
  const reachable = new Set<string>([`${spawn.x},${spawn.y}`]);
  const queue = [{ x: spawn.x, y: spawn.y }];
  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) break;
    for (const neighbor of getNeighborCoordinates(current)) {
      const key = `${neighbor.x},${neighbor.y}`;
      const cell = cells[neighbor.y]?.[neighbor.x];
      if (!cell || cell.blocked || cell.walkCost <= 0 || reachable.has(key)) continue;
      reachable.add(key);
      queue.push(neighbor);
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = cells[y]![x]!;
      if (!cell.blocked && !reachable.has(`${x},${y}`)) {
        cell.blocked = true;
        cell.walkCost = 0;
      }
    }
  }

  // Sandy shorelines: walkable grass tiles bordering water become sand,
  // keeping their original battle biome and without sprite decorations so
  // beaches stay clear of cacti. Single-tile ponds skip the ring (a full
  // beach donut would outweigh the pond) and larger shores get noise-eroded
  // edges so beaches sit organically in the grass. Runs for every sector so
  // beaches form wherever grass meets water, coastlines and biome borders too.
  const waterBodySize = new Map<string, number>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const key = `${x},${y}`;
      if (cells[y]![x]!.terrain !== "ocean" || waterBodySize.has(key)) continue;
      const body: { x: number; y: number }[] = [{ x, y }];
      const seen = new Set([key]);
      for (let i = 0; i < body.length; i++) {
        for (const n of getNeighborCoordinates(body[i]!)) {
          const nKey = `${n.x},${n.y}`;
          if (seen.has(nKey) || cells[n.y]?.[n.x]?.terrain !== "ocean") continue;
          seen.add(nKey);
          body.push(n);
        }
      }
      body.forEach((tile) => waterBodySize.set(`${tile.x},${tile.y}`, body.length));
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = cells[y]![x]!;
      // A boundary cell is shared with another independently generated map.
      // Its base terrain already matches exactly; shoreline conversion depends
      // on interior-only neighbors and could otherwise repaint just one side.
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) continue;
      if (cell.blocked || cell.terrain !== "ground" || cell.zone === "road") {
        continue;
      }
      const bordersLargeWater = getNeighborCoordinates({ x, y }).some(
        (n) => (waterBodySize.get(`${n.x},${n.y}`) ?? 0) >= 2,
      );
      const erode = globalFeature(worldPositionAt(x, y)) < -0.55;
      if (bordersLargeWater && !erode) {
        cell.terrain = "dessert";
        cell.battleBiome = "ground";
        cell.decoration = false;
      }
    }
  }

  return { cells, anchors };
};

/** Battle biome for a terrain key, falling back to "ground" for keys not in the built-in registry */
const getBattleBiome = (terrain: string) =>
  BUILTIN_TERRAINS_BY_KEY.get(terrain)?.battleBiome ?? "ground";

/**
 * Dedup key for the embedded tileset: cells with identical
 * terrain/zone/blocked/walkCost/battleBiome/decoration share a single tileset
 * tile in buildTiledJson.
 */
const cellSignature = (cell: CellSpec) => {
  return [
    cell.terrain,
    cell.zone,
    cell.blocked,
    cell.walkCost,
    cell.battleBiome ?? "",
    cell.decoration ?? "",
  ].join("|");
};

/**
 * Emit a Tiled 1.10 hexagonal map (flat-top, odd-q stagger via staggeraxis
 * "x") in the exact shape normalizeTiledSectorMap consumes. The embedded
 * tileset is deduped by cell signature, and layer data gids are tileId + 1
 * (Tiled reserves gid 0 for empty). Anchors and decorations are point objects
 * whose gridX/gridY properties pin the exact tile for the importer.
 */
export const buildTiledJson = (options: GeneratorOptions) => {
  const { width, height } = options;
  const { cells, anchors } = generateCells(options);

  // Build an embedded tileset with one tile per unique cell signature
  const tileIdBySignature = new Map<string, number>();
  const tilesetTiles: {
    id: number;
    type: string;
    properties: { name: string; type: string; value: string | number | boolean }[];
  }[] = [];
  const data: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = cells[y]![x]!;
      const signature = cellSignature(cell);
      let tileId = tileIdBySignature.get(signature);
      if (tileId === undefined) {
        tileId = tilesetTiles.length;
        tileIdBySignature.set(signature, tileId);
        const properties: { name: string; type: string; value: string | number | boolean }[] = [
          { name: "terrain", type: "string", value: cell.terrain },
          { name: "zone", type: "string", value: cell.zone },
          { name: "blocked", type: "bool", value: cell.blocked },
          { name: "walkCost", type: "float", value: cell.walkCost },
          {
            name: "battleBiome",
            type: "string",
            value: cell.battleBiome ?? getBattleBiome(cell.terrain),
          },
        ];
        if (cell.decoration !== undefined) {
          properties.push({ name: "decoration", type: "bool", value: cell.decoration });
        }
        tilesetTiles.push({
          id: tileId,
          type: cell.terrain,
          properties,
        });
      }
      data.push(tileId + 1);
    }
  }

  // Anchor point objects; pixel coordinates use the odd-q stagger layout,
  // and gridX/gridY properties pin the exact tile for the importer.

  const anchorObjects = anchors.map((anchor, index) => ({
    id: index + 1,
    name: anchor.key,
    type: "anchor",
    point: true,
    visible: true,
    rotation: 0,
    width: 0,
    height: 0,
    ...hexTileToPixel(anchor.x, anchor.y),
    properties: [
      { name: "gridX", type: "int", value: anchor.x },
      { name: "gridY", type: "int", value: anchor.y },
    ],
  }));

  // Scenery baked as first-class Tiled objects so the content team can add,
  // move or delete every tree and rock directly in the map editor
  const decorationPrng = alea(`sector-${options.sector}-${options.seed}-decorations`);
  const decorationTiles = cells.flatMap((row, y) =>
    row.map((cell, x) => ({
      x,
      y,
      terrain: cell.terrain,
      zone: cell.zone,
      blocked: cell.blocked,
      walkCost: cell.walkCost,
      decoration: cell.decoration,
    })),
  );
  const decorationObjects = generateDecorationPlacements(
    decorationPrng,
    decorationTiles,
  ).map((placement, index) => ({
    id: anchorObjects.length + index + 1,
    name: placement.assetKey,
    type: "decoration",
    point: true,
    visible: true,
    rotation: 0,
    width: 0,
    height: 0,
    ...hexTileToPixel(placement.x, placement.y),
    properties: [
      { name: "gridX", type: "int", value: placement.x },
      { name: "gridY", type: "int", value: placement.y },
      { name: "assetKey", type: "string", value: placement.assetKey },
      { name: "scale", type: "float", value: placement.scale },
      { name: "offsetX", type: "float", value: placement.offsetX },
    ],
  }));
  const objects = [...anchorObjects, ...decorationObjects];

  return {
    type: "map",
    version: "1.10",
    tiledversion: "1.11.0",
    orientation: "hexagonal",
    renderorder: "right-down",
    infinite: false,
    width,
    height,
    tilewidth: TILED_TILE_WIDTH,
    tileheight: TILED_TILE_HEIGHT,
    hexsidelength: TILED_HEX_SIDE_LENGTH,
    staggeraxis: "x",
    staggerindex: "odd",
    nextlayerid: 3,
    nextobjectid: objects.length + 1,
    layers: [
      {
        id: 1,
        name: "terrain",
        type: "tilelayer",
        visible: true,
        opacity: 1,
        x: 0,
        y: 0,
        width,
        height,
        data,
      },
      {
        id: 2,
        name: "objects",
        type: "objectgroup",
        visible: true,
        opacity: 1,
        x: 0,
        y: 0,
        draworder: "topdown",
        objects,
      },
    ],
    tilesets: [
      {
        firstgid: 1,
        name: "terrain",
        tilewidth: TILED_TILE_WIDTH,
        tileheight: TILED_TILE_HEIGHT,
        tilecount: tilesetTiles.length,
        columns: 0,
        margin: 0,
        spacing: 0,
        tiles: tilesetTiles,
      },
    ],
  };
};

/**
 * Parse CLI flags. Accepts --sectors or the legacy --sector alias. The
 * --ensure-walkable format is semicolon-separated "x,y" pairs (e.g.
 * "3,4;5,6"); malformed pairs are silently dropped. Width/height default to
 * SECTOR_WIDTH/SECTOR_HEIGHT and seed to "v1".
 */
const parseArgs = (argv: string[]) => {
  const getValue = (flag: string) => getFlagValue(argv, flag);
  const sectors = parseIntList(getValue("--sectors") ?? getValue("--sector"));
  const ensureWalkable = (getValue("--ensure-walkable") ?? "")
    .split(";")
    .map((pair) => pair.split(",").map((value) => Number(value.trim())))
    .filter((pair) => pair.length === 2 && pair.every((v) => Number.isInteger(v)))
    .map(([x, y]) => ({ x: x!, y: y! }));
  return {
    sectors,
    village: argv.includes("--village"),
    out: getValue("--out") ?? "generated-maps",
    width: Number(getValue("--width") ?? SECTOR_WIDTH),
    height: Number(getValue("--height") ?? SECTOR_HEIGHT),
    seed: getValue("--seed") ?? "v1",
    ensureWalkable,
  };
};

/** CLI entry: parse flags, generate each requested sector's Tiled JSON, write to disk */
const main = () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.sectors.length === 0) {
    console.error("Usage: bun run scripts/generate-sector-map.ts --sectors 105,106");
    process.exit(1);
  }
  if (
    Number.isNaN(args.width) ||
    Number.isNaN(args.height) ||
    args.width < 4 ||
    args.height < 4 ||
    args.width > SECTOR_MAP_MAX_DIMENSION ||
    args.height > SECTOR_MAP_MAX_DIMENSION
  ) {
    console.error(`Dimensions must be 4-${SECTOR_MAP_MAX_DIMENSION}`);
    process.exit(1);
  }

  mkdirSync(args.out, { recursive: true });
  let hasErrors = false;
  for (const sector of args.sectors) {
    if (!isValidSectorId(sector)) {
      console.error(`Skipping invalid sector id ${sector}`);
      hasErrors = true;
      continue;
    }
    const tiledJson = buildTiledJson({
      sector,
      width: args.width,
      height: args.height,
      village: args.village,
      seed: args.seed,
      ensureWalkable: args.ensureWalkable,
    });

    // Round-trip through the real importer so files are known-good
    const result = normalizeTiledSectorMap({
      sector,
      name: `Sector ${sector}`,
      tiledJson,
      terrainRegistry: mergeTerrainSpecs([]),
    });
    if (result.errors.length > 0 || !result.map) {
      console.error(`Sector ${sector}: FAILED validation`, result.errors);
      hasErrors = true;
      continue;
    }

    const filePath = join(args.out, `sector-${sector}.json`);
    writeFileSync(filePath, JSON.stringify(tiledJson, null, 2));
    const blockedCount = result.map.tiles.filter((tile) => tile.blocked).length;
    console.log(
      `Sector ${sector}: wrote ${filePath} (${result.map.width}x${result.map.height}, ` +
        `${blockedCount} blocked tiles, ${result.map.anchors.length} anchors)` +
        (result.warnings.length > 0 ? ` warnings: ${result.warnings.join("; ")}` : ""),
    );
  }
  process.exit(hasErrors ? 1 : 0);
};

if (import.meta.main) {
  main();
}
