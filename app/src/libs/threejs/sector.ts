import { Grid, Orientation, rectangle } from "honeycomb-grid";
import { nanoid } from "nanoid";
import { createNoise2D } from "simplex-noise";
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  EdgesGeometry,
  Group,
  Line,
  LinearFilter,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  type Raycaster,
  Sprite,
  SpriteMaterial,
  Vector3,
} from "three";
import {
  ASSETS_LAYER,
  DIRT_LAYER,
  HEX_ASPECT_RATIO,
  HEX_STACKING_DISPLACEMENT,
  IMG_AVATAR_DEFAULT,
  IMG_ICON_HEAL,
  IMG_SECTOR_ATTACK,
  IMG_SECTOR_INFO,
  IMG_SECTOR_USER_MARKER,
  IMG_SECTOR_USER_SPRITE_MASK,
  IMG_SECTOR_USERSPRITE_LEFT,
  IMG_SECTOR_USERSPRITE_RIGHT,
  IMG_SECTOR_VS_ICON,
  IMG_SECTOR_WALL_STONE_TOWER,
  MEDNIN_MIN_RANK,
  RANKS_RESTRICTED_FROM_PVP,
  STATUS_LAYER,
  STRUCTURE_ADJACENTS,
  TILES_LAYER,
  USER_LAYER,
} from "@/drizzle/constants";
import type { VillageStructure } from "@/drizzle/schema";
import { passesBracketFilter } from "@/libs/profile";
import { getActiveObjectives } from "@/libs/quest";
import {
  type DecorationAsset,
  resolveDecorationAsset,
} from "@/libs/sector-map/decorations";
import {
  resolveStructureTerrainSpec,
  resolveTerrainSpec,
  type TerrainSpec,
} from "@/libs/sector-map/terrains";
import type {
  NormalizedSectorMap,
  NormalizedSectorTile,
} from "@/libs/sector-map/types";
import { getNeighborCoordinates } from "@/libs/sector-map/validation";
import {
  getAuthoredTileMaterial,
  getDirtMaterial,
  loadSectorAsset,
  roadMats,
  roadMatsLight,
  shoreMats,
  shoreMatsLight,
} from "@/libs/threejs/biome";
import {
  calculateHexUVCoordinates,
  calculateTileOffset,
  createGroundCorners,
  createGroundEdges,
  createGroundGeometry,
  createTileGeometry,
  getHexPoints,
  mergeBufferGeometries,
} from "@/libs/threejs/hexgrid";
import { applyWaveShader } from "@/libs/threejs/shaders";
import type { SectorUser } from "@/libs/threejs/types";
import { createTexture, loadTexture, profiler } from "@/libs/threejs/util";
import { hasRequiredRank } from "@/libs/train";
import { getBiomeFromTileType } from "@/libs/travel";
import type { UserWithRelations } from "@/routers/profile";
import { findVillageUserRelationship } from "@/utils/alliance";
import { groupBy } from "@/utils/grouping";
import type { ComplexObjectiveFields } from "@/validators/objectives";
import type { TerrainHex } from "../hexgrid";
import { defineHex, findHex, PathCalculator } from "../hexgrid";

// Cache for meshes to avoid getObjectByName every frame
const meshCache = new Map<string, Group>();

/** Canonical "x,y" key for authored-map tile lookups within one sector */
const getSectorMapTileKey = (x: number, y: number) => `${x},${y}`;

export interface WindowNavEntry {
  dx: number;
  dy: number;
  map: NormalizedSectorMap;
}

/**
 * A single logical hex grid spanning the whole 3x3 sector window, so paths,
 * hover highlights and continuous walks cross sector borders as if the world
 * were one map. Walkability/cost are composed from the 9 authored maps; the
 * center sector sits at unified offset (W, H). This grid is used for
 * PATHFINDING and adjacency only - rendering still uses the per-sector grids,
 * so the returned tiles are mapped back to (dx, dy, local col/row).
 */
export interface WindowNav {
  pathFinder: PathCalculator;
  toUnified: (
    dx: number,
    dy: number,
    col: number,
    row: number,
  ) => TerrainHex | undefined;
  fromUnified: (tile: TerrainHex) => {
    dx: number;
    dy: number;
    col: number;
    row: number;
  };
}

/**
 * Composes up to 9 authored sector maps into one unified 3W x 3H hex grid for
 * cross-border pathfinding (rendering stays per-sector); the center sector
 * occupies unified offset (W, H). Rotated cube-edge-seam neighbors and missing
 * (polar) neighbors are marked impassable (blocked, cost 9999) so paths stop
 * cleanly at those borders, and water tiles carry a +5 cost weighting so
 * routes prefer dry land. Returns null when no center map is provided.
 */
export const buildWindowNav = (
  entries: WindowNavEntry[],
  hexsize: number,
  terrainRegistry: Map<string, TerrainSpec>,
): WindowNav | null => {
  const first = entries[0]?.map;
  if (!first) return null;
  const W = first.width;
  const H = first.height;
  // Per-window-offset tile lookups for O(1) walkability composition
  const tilesByOffset = new Map<string, Map<string, NormalizedSectorTile>>();
  for (const entry of entries) {
    const lookup = new Map<string, NormalizedSectorTile>();
    for (const tile of entry.map.tiles) {
      lookup.set(getSectorMapTileKey(tile.x, tile.y), tile);
    }
    tilesByOffset.set(`${entry.dx},${entry.dy}`, lookup);
  }
  const Tile = defineHex({
    dimensions: { width: hexsize, height: hexsize * HEX_ASPECT_RATIO },
    origin: { x: -hexsize * 0.5, y: -hexsize * 0.5 },
    orientation: Orientation.FLAT,
  });
  const grid = new Grid(Tile, rectangle({ width: 3 * W, height: 3 * H }))
    .filter((tile) => {
      try {
        return tile.width !== 0;
      } catch (_e) {
        return false;
      }
    })
    .map((tile) => {
      const dx = Math.floor(tile.col / W) - 1;
      const dy = Math.floor(tile.row / H) - 1;
      const localCol = tile.col - (dx + 1) * W;
      const localRow = tile.row - (dy + 1) * H;
      const offsetKey = `${dx},${dy}`;
      const lookup = tilesByOffset.get(offsetKey);
      const mapTile = lookup?.get(getSectorMapTileKey(localCol, localRow));
      if (!mapTile) {
        // Sector missing from the window (polar edge) is an impassable wall
        tile.blocked = true;
        tile.cost = 9999;
        return tile;
      }
      tile.blocked = mapTile.blocked || mapTile.walkCost <= 0;
      // Water carries a heavier path weighting so routes prefer dry land
      const spec = resolveTerrainSpec(mapTile.terrain, terrainRegistry);
      tile.cost = mapTile.walkCost + (spec.isWater ? 5 : 1);
      return tile;
    });
  return {
    pathFinder: new PathCalculator(grid),
    toUnified: (dx, dy, col, row) =>
      grid.getHex({ col: (dx + 1) * W + col, row: (dy + 1) * H + row }),
    fromUnified: (tile) => {
      const dx = Math.floor(tile.col / W) - 1;
      const dy = Math.floor(tile.row / H) - 1;
      return { dx, dy, col: tile.col - (dx + 1) * W, row: tile.row - (dy + 1) * H };
    },
  };
};

/**
 * Renders the authored map objects onto the sector's asset group. Decoration
 * objects become wind/rotation-capable sprites resolved through the decoration
 * registry, seeded deterministically from their tile coordinates so re-renders
 * look identical; they are skipped in lightLayout and on structure tiles.
 * Structure/landmark objects render as plain sprites at 2.4x tile height,
 * other object types at 1.2x. Objects without an assetKey or with off-grid
 * coordinates are ignored.
 */
const drawSectorMapObjects = (
  group: Group,
  grid: Grid<TerrainHex>,
  sectorMap: NormalizedSectorMap,
  lightLayout: boolean,
  decorationAssets: Map<string, DecorationAsset>,
) => {
  sectorMap.objects
    .filter((object) => object.assetKey)
    .forEach((object) => {
      const pos = grid.getHex({ col: object.x, row: object.y });
      if (!pos || !object.assetKey) return;

      // Authored scenery: every tree and rock is a map object the content
      // team can edit in Tiled; structures suppress overlapping scenery
      if (object.type === "decoration") {
        if (lightLayout || pos.hasStructure) return;
        const asset = resolveDecorationAsset(object, decorationAssets);
        if (!asset) return;
        const { height: h, width: w, x, y } = pos;
        // The object's own size wins (authored/resized in Tiled, in hex-height
        // units); the asset library's renderScale is only the default for
        // objects without an explicit size
        const scale = object.scale ?? asset.renderScale ?? 1;
        const seed = ((object.x * 31 + object.y * 17) % 100) / 100;
        const sprite = loadSectorAsset(
          asset.filepath,
          seed,
          asset.windAffected,
          asset.randomRotation,
        );
        sprite.scale.set(scale * h, scale * h, 1);
        sprite.position.set(
          x + w * (object.offsetX ?? 0),
          // offsetY is authored in Tiled screen space (positive = down), and the
          // grid's y axis also grows downward, so it adds directly
          y + h * (scale / 2 - 0.5 + 0.1 * scale) + h * (object.offsetY ?? 0),
          ASSETS_LAYER,
        );
        sprite.userData.small = asset.small === true;
        sprite.userData.type = object.type;
        sprite.userData.objectId = object.id;
        group.add(sprite);
        return;
      }

      const { height: h, x, y } = pos;
      const texture = loadTexture(object.assetKey, 200);
      const material = new SpriteMaterial({
        map: texture,
        depthWrite: false,
        depthTest: false,
      });
      const sprite = new Sprite(material);
      const scale =
        object.type === "structure" || object.type === "landmark" ? 2.4 : 1.2;
      sprite.scale.set(h * scale, h * scale, 1);
      sprite.position.set(x, y + h / 8, ASSETS_LAYER);
      sprite.userData.type = object.type;
      sprite.userData.objectId = object.id;
      group.add(sprite);
    });
};

export const drawQuest = (info: {
  group_quest: Group;
  grid: Grid<TerrainHex>;
  user: NonNullable<UserWithRelations>;
}) => {
  const endMark = profiler.mark("drawQuest");
  const { user, grid, group_quest } = info;
  const activeObjectives = getActiveObjectives(user);
  const drawnIds = new Set<string>();

  activeObjectives
    .filter((o) => "sector" in o && Number(o.sector) === user.sector)
    .forEach((objective) => {
      let mesh = meshCache.get(objective.id);
      if (mesh && mesh.parent !== group_quest) {
        mesh = undefined; // Force recreate if parent changed
      }

      const { latitude: y, longitude: x } = objective as ComplexObjectiveFields;
      const hex = findHex(grid, { x, y });
      if (!hex) return;

      if (!mesh) {
        // Check if should be drawn
        if (!("image" in objective) || !objective.image) return;
        const { height: h, width: w } = hex;
        mesh = new Group();
        mesh.name = objective.id;
        // Marker
        const marker = loadTexture(IMG_SECTOR_USER_MARKER);
        const markerMat = new SpriteMaterial({ map: marker, alphaMap: marker });
        const markerSprite = new Sprite(markerMat);
        markerSprite.userData.type = "marker";
        if (objective.task === "move_to_location") {
          markerSprite.material.color.setHex(0xf4e365);
        } else if (
          objective.task === "collect_item" ||
          objective.task === "deliver_item"
        ) {
          markerSprite.material.color.setHex(0x6666a3);
        } else if (objective.task === "defeat_opponents") {
          markerSprite.material.color.setHex(0x9c273a);
        } else if (objective.task === "dialog") {
          markerSprite.material.color.setHex(0x6666a3);
        }
        const s = 1.5;
        Object.assign(markerSprite.scale, new Vector3(h * s, h * 1.2 * s, 1));
        Object.assign(
          markerSprite.position,
          new Vector3(w / 2, h * 0.9 * s, USER_LAYER),
        );
        mesh.add(markerSprite);
        // White background for items
        const alphaMap = loadTexture(IMG_SECTOR_USER_SPRITE_MASK);
        const alphaMaterial = new SpriteMaterial({ map: alphaMap, alphaMap: alphaMap });
        const alphaSprite = new Sprite(alphaMaterial);
        alphaSprite.material.color.setHex(0xd3d9ea);
        Object.assign(alphaSprite.scale, new Vector3(h * 0.8 * s, h * 0.8 * s, 1));
        Object.assign(
          alphaSprite.position,
          new Vector3(w / 2, h * 1.0 * s, USER_LAYER),
        );
        mesh.add(alphaSprite);
        // Image Sprite
        const map = loadTexture(
          objective.image ? `${objective.image}?1=1` : IMG_AVATAR_DEFAULT,
        );
        map.generateMipmaps = false;
        map.minFilter = LinearFilter;
        const material = new SpriteMaterial({ map: map, alphaMap: alphaMap });
        const sprite = new Sprite(material);
        Object.assign(sprite.scale, new Vector3(h * 0.8 * s, h * 0.8 * s, 1));
        Object.assign(sprite.position, new Vector3(w / 2, h * 1.0 * s, USER_LAYER));
        mesh.add(sprite);
        group_quest.add(mesh);
        meshCache.set(objective.id, mesh);
      }
      mesh.visible = true;
      mesh.position.set(-hex.center.x, -hex.center.y, 0);
      drawnIds.add(objective.id);
    });

  // Wobble animation: horizontal sway every 2 seconds
  const t = Date.now() / 1000;
  const cycle = t % 2;
  const wobbleX = cycle < 1 ? Math.sin(cycle * Math.PI * 4) * (1 - cycle) : 0;
  group_quest.children.forEach((object) => {
    if (!drawnIds.has(object.name)) {
      object.visible = false;
    } else {
      object.position.x += wobbleX * 2;
    }
  });
  profiler.reportCount("sector_quests", drawnIds.size);
  endMark();
};

// Sector-boundary line: the same slate tone as the tile grid but drawn as a
// real filled ribbon (WebGL ignores LineBasicMaterial.linewidth), so it reads
// clearly thicker and marks every transition between sectors.
const SECTOR_BOUNDARY_COLOR = 0x4a4a4a;
/** Ribbon half-width as a fraction of the hex size (~1x the tile grid line) */
const SECTOR_BOUNDARY_THICKNESS = 0.011;

// Hover-path highlight: the per-tile interaction meshes double as the
// highlight overlay. They stay not-rendered (material.visible = false, so no
// draw cost) until a tile joins the hovered path, when they light up - making
// it clear you can click anywhere on the map to walk there.
const TILE_HIGHLIGHT_COLOR = 0xffc23e;
const TILE_HIGHLIGHT_OPACITY = 0.4;

/**
 * Build a thick outline around the sector's rectangular hex block. An edge is
 * on the perimeter when exactly one tile owns it (interior edges are shared by
 * two tiles), so this traces the true zig-zag boundary. Each perimeter edge
 * becomes a quad ribbon; ends are extended by the half-width so consecutive
 * segments overlap at the corners instead of leaving gaps.
 */
const buildSectorBoundary = (grid: Grid<TerrainHex>, hexsize: number) => {
  const round = (value: number) => Math.round(value * 100) / 100;
  const edges = new Map<
    string,
    { a: { x: number; y: number }; b: { x: number; y: number }; count: number }
  >();
  grid.forEach((tile) => {
    const corners = tile.corners;
    for (let i = 0; i < corners.length; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % corners.length];
      if (!a || !b) continue;
      const ka = `${round(a.x)},${round(a.y)}`;
      const kb = `${round(b.x)},${round(b.y)}`;
      const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const existing = edges.get(key);
      if (existing) existing.count++;
      else edges.set(key, { a, b, count: 1 });
    }
  });

  const half = hexsize * SECTOR_BOUNDARY_THICKNESS;
  const z = TILES_LAYER + 1;
  const positions: number[] = [];
  edges.forEach(({ a, b, count }) => {
    if (count !== 1) return; // interior edge shared by two tiles
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    const length = Math.hypot(dx, dy) || 1;
    dx /= length;
    dy /= length;
    const nx = -dy * half;
    const ny = dx * half;
    const ax = a.x - dx * half;
    const ay = a.y - dy * half;
    const bx = b.x + dx * half;
    const by = b.y + dy * half;
    positions.push(
      ax + nx,
      ay + ny,
      z,
      ax - nx,
      ay - ny,
      z,
      bx - nx,
      by - ny,
      z,
      ax + nx,
      ay + ny,
      z,
      bx - nx,
      by - ny,
      z,
      bx + nx,
      by + ny,
      z,
    );
  });
  if (positions.length === 0) return null;

  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array(positions), 3),
  );
  // Opaque so it renders in the opaque pass, before the decoration/structure
  // group - the boundary then sits at the tile level, under every object,
  // rather than on top of them (a transparent mesh would draw after all the
  // opaque scenery). It is drawn just above the tile faces (z here) so it
  // reads clearly over the terrain while trees and buildings still occlude it.
  const material = new MeshBasicMaterial({
    color: SECTOR_BOUNDARY_COLOR,
    side: DoubleSide,
  });
  const mesh = new Mesh(geometry, material);
  mesh.matrixAutoUpdate = false;
  mesh.userData.type = "sector_boundary";
  return mesh;
};

/**
 * Creates heaxognal grid & draw it using js. Return groups of objects drawn
 */
export const drawSector = (
  width: number,
  prng: () => number,
  globalTileType: number,
  lightLayout = false,
  structures: VillageStructure[] | undefined,
  sectorMap: NormalizedSectorMap,
  decorationAssets: Map<string, DecorationAsset>,
  terrainRegistry: Map<string, TerrainSpec>,
) => {
  const endMark = profiler.mark("drawSector");
  const { width: sectorWidth, height: sectorHeight } = sectorMap;
  const authoredTiles = new Map(
    sectorMap.tiles.map((tile) => [getSectorMapTileKey(tile.x, tile.y), tile]),
  );
  // Calculate hex size
  const hexsize = width / (sectorWidth - HEX_STACKING_DISPLACEMENT * (sectorWidth - 1));

  // Noise drives color variation within terrain bands
  const noiseGen = createNoise2D(prng);

  const allStructures = structures ?? [];
  // The sector's own biome on the globe: drives the fallback material for
  // un-authored tiles and the flattened ground level under structures, so a
  // sector renders identically no matter which window it is viewed from
  const baseBiome = getBiomeFromTileType(globalTileType);

  // Create the grid first
  const Tile = defineHex({
    dimensions: { width: hexsize, height: hexsize * HEX_ASPECT_RATIO },
    origin: { x: -hexsize * 0.5, y: -hexsize * 0.5 },
    orientation: Orientation.FLAT,
  });
  // Precompute the tiles occupied by (or adjacent to) a structure once, so the
  // per-tile check below is an O(1) Set lookup rather than scanning every
  // structure x 12 adjacents for all 676 tiles (a village sector redraw is
  // otherwise O(tiles x structures x 12)).
  const structureTileKeys = new Set<string>();
  for (const s of allStructures) {
    structureTileKeys.add(getSectorMapTileKey(s.longitude, s.latitude));
    for (const { dCol, dRow } of STRUCTURE_ADJACENTS) {
      structureTileKeys.add(getSectorMapTileKey(s.longitude + dCol, s.latitude + dRow));
    }
  }
  const grid = new Grid(Tile, rectangle({ width: sectorWidth, height: sectorHeight }))
    .filter((tile) => {
      try {
        return tile.width !== 0;
      } catch (_e) {
        return false;
      }
    })
    .map((tile) => {
      const tileKey = getSectorMapTileKey(tile.col, tile.row);
      const authoredTile = authoredTiles.get(tileKey);
      // Noise drives which of the terrain's shades a tile gets
      const nx = tile.col / sectorWidth - 0.5;
      const ny = tile.row / sectorHeight - 0.5;
      tile.level = noiseGen(nx, ny) / 2 + 0.5;
      tile.assetStrength = 0;
      // Effective path cost: authored walk cost plus the terrain weighting
      // (water routes are heavily de-prioritized)
      const spec = resolveTerrainSpec(
        authoredTile?.terrain ?? baseBiome,
        terrainRegistry,
      );
      // Stash the resolved spec + authored tile so the geometry pass below reads
      // them off the hex instead of re-doing the lookup + resolve for all 676 tiles
      tile.spec = spec;
      tile.authored = authoredTile;
      tile.cost = (authoredTile ? authoredTile.walkCost : 1) + (spec.isWater ? 5 : 1);
      tile.blocked = authoredTile?.blocked || authoredTile?.walkCost === 0;
      tile.zone = authoredTile?.zone;
      // Combat arena for battles on this tile: the authored per-tile override
      // wins, else the terrain's configured arena
      tile.battleBiome = authoredTile?.battleBiome ?? spec.battleBiome;

      // Structure tiles stay flat and walkable (includes shrines and other
      // added structures)
      if (structureTileKeys.has(tileKey)) {
        // Preserve authored land beneath structures. Water becomes a small
        // land island and blue ice becomes snow; repainting every footprint
        // from the globe's centre biome caused white patches on Horizon's
        // legacy desert map when the topology and published map disagreed.
        const groundSpec = resolveStructureTerrainSpec({
          authoredTerrain: authoredTile?.terrain,
          authoredBattleBiome: authoredTile?.battleBiome,
          baseBiome,
          registry: terrainRegistry,
        });
        tile.spec = groundSpec;
        tile.battleBiome = authoredTile?.battleBiome ?? groundSpec.battleBiome;
        tile.cost = 2;
        if (groundSpec.key !== spec.key) {
          // A consistent mid shade makes replacement terrain read as one
          // intentional foundation instead of noisy fragments.
          tile.level = 0.5;
        }
        tile.hasStructure = true;
        tile.blocked = false;
      }
      return tile;
    });

  // Groups for organizing objects
  const group_dirt = new Group();
  const group_tiles = new Group();
  const group_edges = new Group();
  const group_assets = new Group();
  const group_interaction = new Group();

  // Get hex points for geometry construction
  const { points, groundPoints, groundEdges } = getHexPoints();

  // Calculate UV coordinates once for ground geometry using first tile's shape
  const firstTile = grid.toArray()[0];
  const { groundUVArray, tileUVArray } = calculateHexUVCoordinates(
    firstTile,
    points,
    groundPoints,
  );

  // Subtle grid so the painterly tiles read as terrain, not a board game
  const lineMaterial = new LineBasicMaterial({
    color: 0x555555,
    transparent: true,
    opacity: 0.25,
  });

  // Arrays to collect geometries for merging (major performance optimization)
  const groundGeometries: BufferGeometry[] = [];
  const groundEdgeGeometries: BufferGeometry[] = [];
  const tileEdgeGeometries: BufferGeometry[] = [];

  // Track shared materials to reduce draw calls
  const materialGroups = new Map<MeshBasicMaterial, BufferGeometry[]>();

  // Per-source-material wave pools (allow batching while desynchronizing
  // waves; separate water terrains keep separate pools)
  const waveMaterialPools = new Map<MeshBasicMaterial, MeshBasicMaterial[]>();
  const numWaveVariants = 8;

  // Track animated materials for efficient uniform updates
  const animatedMaterials = new Set<MeshBasicMaterial>();

  // Draw the tiles
  grid.forEach((tile) => {
    if (tile) {
      // Reuse the spec + authored tile stashed on the hex by the first pass
      // above, and the blocked flag it already computed onto the tile
      const authoredTile = tile.authored;
      const spec = tile.spec ?? resolveTerrainSpec(baseBiome, terrainRegistry);
      const blocked = tile.blocked ?? false;
      const tileInfo = getAuthoredTileMaterial(tile, spec, blocked, lightLayout);
      let { material } = tileInfo;
      const asset = tileInfo.asset;
      tile.asset = asset;

      // Authored roads render as dirt paths without decorations
      const isRoad = authoredTile?.zone === "road" && !spec.isWater;
      if (isRoad) {
        const roadPalette = lightLayout ? roadMatsLight : roadMats;
        const variant = tile.level < 0.4 ? 0 : tile.level < 0.6 ? 1 : 2;
        material = roadPalette[variant] ?? material;
      }

      // Shorelines (sand with decorations disabled) get a mottled beach
      // palette with more contrast than the flat desert tones
      const isShore =
        authoredTile?.terrain === "dessert" && authoredTile.decoration === false;
      if (isShore) {
        const shorePalette = lightLayout ? shoreMatsLight : shoreMats;
        const variant = tile.level < 0.4 ? 0 : tile.level < 0.7 ? 1 : 2;
        material = shorePalette[variant] ?? material;
      }

      // Corners of the tile and the below ground
      const corners = tile.corners;

      // Depressed tile faces (water, ice sheets) get a depth-effect recess;
      // roads always sit flat
      const depression = isRoad ? 0 : spec.depression;
      const { length, offsetLength, offsetLayer } = calculateTileOffset(
        corners,
        depression,
        lightLayout,
      );

      // Create the corners of the ground below
      const groundCorners = createGroundCorners(corners, offsetLength, length);

      // Top face of the tile
      const geometry = createTileGeometry({
        corners,
        points,
        tileUVArray,
        offsetLength,
        offsetLayer,
        layer: TILES_LAYER,
      });

      // Assign to material group for merging
      if (material) {
        let materialToUse = material;

        // Water animates: swap in a wave-shader clone of the tile material
        // (pooled per source material so batching still applies)
        if (spec.isWater && !isRoad && !lightLayout) {
          let pool = waveMaterialPools.get(material);
          if (!pool) {
            pool = [];
            waveMaterialPools.set(material, pool);
          }
          const variantIndex = Math.floor(prng() * numWaveVariants);
          if (!pool[variantIndex]) {
            const variantMaterial = material.clone();
            // The clone belongs to this sector alone; it must not inherit
            // the shared tag from the pooled base material
            variantMaterial.userData.shared = false;
            const randomOffset = (variantIndex / numWaveVariants) * Math.PI * 2;
            applyWaveShader(variantMaterial, randomOffset);
            pool[variantIndex] = variantMaterial;
            animatedMaterials.add(variantMaterial);
          }
          materialToUse = pool[variantIndex] ?? material;
        }

        const group = materialGroups.get(materialToUse) || [];
        group.push(geometry);
        materialGroups.set(materialToUse, group);
      }

      // Collect tile edge geometry for merging (performance optimization)
      const edgeGeometry = new EdgesGeometry(geometry);
      tileEdgeGeometries.push(edgeGeometry);

      // Interaction mesh: raycast target for mouse detection AND the hover
      // path highlight. It is not drawn (material.visible = false) until a
      // tile joins the hovered path, so idle cost is just raycasting.
      const interactionGeometry = createTileGeometry({
        corners,
        points,
        tileUVArray: null,
        offsetLength,
        offsetLayer,
        layer: TILES_LAYER,
      });
      const interactionMaterial = new MeshBasicMaterial({
        color: TILE_HIGHLIGHT_COLOR,
        transparent: true,
        opacity: TILE_HIGHLIGHT_OPACITY,
        // Depth-test so opaque scenery (which writes depth) occludes the
        // highlight - the lit path sits on the ground, under trees and rocks,
        // instead of painting over them
        depthTest: true,
        depthWrite: false,
        visible: false,
      });
      const interactionMesh = new Mesh(interactionGeometry, interactionMaterial);
      interactionMesh.name = `${tile.row},${tile.col}`;
      interactionMesh.userData.type = "tile";
      interactionMesh.userData.tile = tile;
      interactionMesh.userData.highlight = false;
      interactionMesh.matrixAutoUpdate = false;
      group_interaction.add(interactionMesh);

      // Ground part of the tile
      if (!lightLayout) {
        const groundGeometry = createGroundGeometry({
          groundCorners,
          groundPoints,
          groundUVArray,
          layer: DIRT_LAYER,
        });

        // Instead of creating individual meshes, collect geometries for merging
        groundGeometries.push(groundGeometry);

        // Collect edge geometries
        const edgeMeshes = createGroundEdges({
          groundCorners,
          groundEdges,
          lineMaterial,
          layer: DIRT_LAYER,
        });
        edgeMeshes.forEach((edgeMesh) => {
          if (edgeMesh.geometry) {
            groundEdgeGeometries.push(edgeMesh.geometry);
          }
        });
      }
    }
  });

  // Create merged meshes for each material group (huge performance gain!)
  materialGroups.forEach((geometries, material) => {
    const mergedGeometry = mergeBufferGeometries(geometries);
    const mesh = new Mesh(mergedGeometry, material);
    mesh.userData.type = "tiles_merged";
    mesh.matrixAutoUpdate = false;
    group_tiles.add(mesh);
  });

  // Merge all ground geometries into a single mesh (huge performance gain)
  if (!lightLayout && groundGeometries.length > 0) {
    const mergedGroundGeometry = mergeBufferGeometries(groundGeometries);
    const mergedGroundMesh = new Mesh(mergedGroundGeometry, getDirtMaterial());
    mergedGroundMesh.userData.type = "ground_merged";
    mergedGroundMesh.matrixAutoUpdate = false;
    group_dirt.add(mergedGroundMesh);

    // Merge all ground edge geometries into a single line mesh
    if (groundEdgeGeometries.length > 0) {
      const mergedEdgeGeometry = mergeBufferGeometries(groundEdgeGeometries);
      const mergedEdgeMesh = new Line(mergedEdgeGeometry, lineMaterial);
      mergedEdgeMesh.matrixAutoUpdate = false;
      group_dirt.add(mergedEdgeMesh);
    }
  }

  drawSectorMapObjects(group_assets, grid, sectorMap, lightLayout, decorationAssets);

  // Merge all tile edge geometries into a single mesh (performance optimization)
  if (tileEdgeGeometries.length > 0) {
    const mergedTileEdgeGeometry = mergeBufferGeometries(tileEdgeGeometries);
    const mergedTileEdgeMesh = new LineSegments(mergedTileEdgeGeometry, lineMaterial);
    mergedTileEdgeMesh.matrixAutoUpdate = false;
    group_edges.add(mergedTileEdgeMesh);
  }

  // Thicker outline marking this sector's borders with its neighbors
  const boundaryMesh = buildSectorBoundary(grid, hexsize);
  if (boundaryMesh) group_edges.add(boundaryMesh);

  profiler.reportCount("sector_tiles", grid.size);
  profiler.reportCount("sector_draw_calls_tiles", materialGroups.size);
  endMark();
  return {
    group_dirt,
    group_tiles,
    group_edges,
    group_assets,
    group_interaction,
    animatedMaterials: Array.from(animatedMaterials),
    honeycombGrid: grid,
  };
};

/**
 * User sprite, which loads the avatar image and displays the health bar as a js sprite
 */
export const createUserSprite = (userData: SectorUser, hex: TerrainHex) => {
  // Group is used to group components of the user Marker
  const group = new Group();
  const { height: h, width: w } = hex;

  // Highlight sprite
  const highlightTexture = loadTexture(IMG_SECTOR_USER_MARKER);
  const highlightMaterial = new SpriteMaterial({
    map: highlightTexture,
    alphaMap: highlightTexture,
  });
  const highlightColor =
    userData.allianceStatus === "ALLY"
      ? 0x008000
      : userData.allianceStatus === "NEUTRAL"
        ? 0x2986cc
        : 0xff0000;
  const highlightSprite = new Sprite(highlightMaterial);
  highlightSprite.userData.type = "marker";
  highlightSprite.scale.set(h * 1.1, h * 1.3, 1);
  highlightSprite.position.set(w / 2, h * 0.9, USER_LAYER);
  highlightSprite.userData.type = "userMarker";
  highlightSprite.userData.userId = userData.userId;
  highlightSprite.material.color.setHex(highlightColor);
  group.add(highlightSprite);

  // Marker
  const marker = loadTexture(IMG_SECTOR_USER_MARKER);
  const markerMat = new SpriteMaterial({ map: marker, alphaMap: marker });
  const markerSprite = new Sprite(markerMat);
  markerSprite.userData.type = "marker";
  Object.assign(markerSprite.scale, new Vector3(h, h * 1.2, 1));
  Object.assign(markerSprite.position, new Vector3(w / 2, h * 0.9, USER_LAYER));
  group.add(markerSprite);

  // Avatar Sprite
  const alphaMap = loadTexture(IMG_SECTOR_USER_SPRITE_MASK);
  const avatar = userData?.avatarLight || userData?.avatar || IMG_AVATAR_DEFAULT;
  const map = loadTexture(avatar);
  map.generateMipmaps = false;
  map.minFilter = LinearFilter;
  const material = new SpriteMaterial({ map: map, alphaMap: alphaMap });
  const sprite = new Sprite(material);
  Object.assign(sprite.scale, new Vector3(h * 0.8, h * 0.8, 1));
  Object.assign(sprite.position, new Vector3(w / 2, h * 1.0, USER_LAYER));
  group.add(sprite);

  // Attack button
  if (!RANKS_RESTRICTED_FROM_PVP.includes(userData.rank)) {
    const attack = loadTexture(IMG_SECTOR_ATTACK);
    const attackMat = new SpriteMaterial({ map: attack, depthTest: false });
    const attackSprite = new Sprite(attackMat);
    attackSprite.visible = false;
    attackSprite.userData.userId = userData.userId;
    attackSprite.userData.type = "attack";
    Object.assign(attackSprite.scale, new Vector3(h * 0.8, h * 0.8, 1));
    Object.assign(attackSprite.position, new Vector3(w * 0.9, h * 1.4, STATUS_LAYER));
    attackSprite.name = `${userData.userId}-attack`;
    group.add(attackSprite);
  }

  // Heal button
  const heal = loadTexture(IMG_ICON_HEAL);
  const healMat = new SpriteMaterial({ map: heal, depthTest: false });
  const healSprite = new Sprite(healMat);
  healSprite.visible = false;
  healSprite.userData.userId = userData.userId;
  healSprite.userData.type = "heal";
  Object.assign(healSprite.scale, new Vector3(h * 0.7, h * 0.7, 1));
  Object.assign(healSprite.position, new Vector3(w, h * 0.5, STATUS_LAYER));
  healSprite.name = `${userData.userId}-heal`;
  group.add(healSprite);

  // Info button
  const info = loadTexture(IMG_SECTOR_INFO);
  const infoMat = new SpriteMaterial({ map: info, depthTest: false });
  const infoSprite = new Sprite(infoMat);
  infoSprite.visible = false;
  infoSprite.userData.userId = userData.userId;
  infoSprite.userData.type = "info";
  Object.assign(infoSprite.scale, new Vector3(h * 0.7, h * 0.7, 1));
  Object.assign(infoSprite.position, new Vector3(w * 0.1, h * 1.4, STATUS_LAYER));
  infoSprite.name = `${userData.userId}-info`;
  group.add(infoSprite);

  // Name
  group.name = userData.userId;
  group.userData.type = "user";
  group.userData.userId = userData.userId;
  group.userData.hex = hex;

  return group;
};

/**
 * User sprite, which loads the avatar image and displays the health bar as a js sprite
 */
export const createCombatSprite = (
  firstUser: SectorUser,
  secondUser: SectorUser,
  battleId: string,
  hex: TerrainHex,
) => {
  // Group is used to group components of the user Marker
  const group = new Group();
  const { height: h, width: w } = hex;

  // Highlight sprite
  const highlightTexture = loadTexture(IMG_SECTOR_USER_MARKER);
  const highlightMaterial = new SpriteMaterial({
    map: highlightTexture,
    alphaMap: highlightTexture,
  });
  const highlightColor = 0xff0000;
  const highlightSprite = new Sprite(highlightMaterial);
  highlightSprite.userData.type = "marker";
  highlightSprite.scale.set(h * 1.1, h * 1.3, 1);
  highlightSprite.position.set(w / 2, h * 0.9, USER_LAYER);
  highlightSprite.userData.type = "battleMarker";
  highlightSprite.userData.battleId = battleId;
  highlightSprite.material.color.setHex(highlightColor);
  group.add(highlightSprite);

  // Marker
  const marker = loadTexture(IMG_SECTOR_USER_MARKER);
  const markerMat = new SpriteMaterial({ map: marker, alphaMap: marker });
  const markerSprite = new Sprite(markerMat);
  markerSprite.userData.type = "marker";
  Object.assign(markerSprite.scale, new Vector3(h, h * 1.2, 1));
  Object.assign(markerSprite.position, new Vector3(w / 2, h * 0.9, USER_LAYER));
  group.add(markerSprite);

  // User 1: Avatar Sprite
  const alphaMap1 = loadTexture(IMG_SECTOR_USERSPRITE_LEFT);
  const map1 = loadTexture(
    firstUser.avatar ? `${firstUser.avatar}?1=1` : IMG_AVATAR_DEFAULT,
  );
  map1.generateMipmaps = false;
  map1.minFilter = LinearFilter;
  const material1 = new SpriteMaterial({ map: map1, alphaMap: alphaMap1 });
  const sprite1 = new Sprite(material1);
  Object.assign(sprite1.scale, new Vector3(h * 0.8, h * 0.8, 1));
  Object.assign(sprite1.position, new Vector3(w / 2, h * 1.0, USER_LAYER));
  group.add(sprite1);

  // User 2: Avatar Sprite
  const alphaMap2 = loadTexture(IMG_SECTOR_USERSPRITE_RIGHT);
  const map2 = loadTexture(
    secondUser.avatar ? `${secondUser.avatar}?1=1` : IMG_AVATAR_DEFAULT,
  );
  map2.generateMipmaps = false;
  map2.minFilter = LinearFilter;
  const material2 = new SpriteMaterial({ map: map2, alphaMap: alphaMap2 });
  const sprite2 = new Sprite(material2);
  Object.assign(sprite2.scale, new Vector3(h * 0.8, h * 0.8, 1));
  Object.assign(sprite2.position, new Vector3(w / 2, h * 1.0, USER_LAYER));
  group.add(sprite2);

  const map = loadTexture(IMG_SECTOR_VS_ICON);
  map.generateMipmaps = false;
  map.minFilter = LinearFilter;
  const material = new SpriteMaterial({ map: map });
  const sprite = new Sprite(material);
  Object.assign(sprite.scale, new Vector3(h * 0.6, h * 0.6, 1));
  Object.assign(sprite.position, new Vector3(w / 2, h * 0.5, USER_LAYER));
  group.add(sprite);

  // Name
  group.name = battleId;
  group.userData.type = "user";
  group.userData.battleId = battleId;
  group.userData.hex = hex;

  return group;
};

/**
 * User sprite, which loads the avatar image and displays the health bar as a js sprite
 */
export const createMultipleUserSprite = (
  nUsers: number,
  location: string,
  dimensions: { height: number; width: number },
) => {
  // Group is used to group components of the user Marker
  const group = new Group();
  const { height: h, width: w } = dimensions;

  // Avatar Sprite
  const canvas = document.createElement("canvas");
  const r = 3;
  canvas.width = r * h;
  canvas.height = r * h;
  const context = canvas.getContext("2d");
  if (context) {
    context.font = `bold ${(r * h) / 2}px Serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    // NOTE: drawing a circle here there is a bug with alphaMap and userSprite sorting
    //       Therefore doing a square for now
    // const centerX = canvas.width / 2;
    // const centerY = canvas.height / 2;
    // const radius = ((r - 0.1) * h) / 2;
    // context.beginPath();
    // context.arc(centerX, centerY, radius, 0, 2 * Math.PI, false);
    // context.fillStyle = "darkorange";
    // context.fill();
    // context.lineWidth = 1;
    // context.strokeStyle = "#003300";
    // context.stroke();
    context.fillStyle = "firebrick";
    context.fillRect(0, 0, r * h, r * h);
    context.lineWidth = h / 2;
    context.strokeStyle = "maroon";
    context.strokeRect(0, 0, r * h, r * h);
    context.fillStyle = "white";
    context.fillText(`${nUsers}`, (r * h) / 2, (r * h) / 2);
  }
  const texture = createTexture(canvas);
  texture.generateMipmaps = false;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  const material = new SpriteMaterial({ map: texture });
  const sprite = new Sprite(material);
  sprite.position.set(w * 0.8, h * 1.3, STATUS_LAYER);
  sprite.scale.set(h * 0.5, h * 0.5, 0.00000001);
  group.add(sprite);

  // Name
  group.name = location;
  group.userData.type = "users";

  return group;
};

/**
 * Floating name label for a village structure, rendered to a canvas so the
 * whole label is a single sprite; starts hidden and is toggled by
 * intersectStructures.
 */
export const createStructureLabel = (structure: VillageStructure, h: number) => {
  const canvasWidth = 512;
  const canvasHeight = 84;
  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const context = canvas.getContext("2d");
  if (context) {
    // Building name, shrunk to fit the canvas width
    let fontSize = 64;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = `bold ${fontSize}px Serif`;
    while (
      fontSize > 24 &&
      context.measureText(structure.name).width > canvasWidth - 16
    ) {
      fontSize -= 2;
      context.font = `bold ${fontSize}px Serif`;
    }
    context.lineJoin = "round";
    context.strokeStyle = "black";
    context.lineWidth = 9;
    context.strokeText(structure.name, canvasWidth / 2, canvasHeight / 2);
    context.fillStyle = "white";
    context.fillText(structure.name, canvasWidth / 2, canvasHeight / 2);
  }
  const texture = createTexture(canvas);
  texture.generateMipmaps = false;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  const material = new SpriteMaterial({
    map: texture,
    depthWrite: false,
    depthTest: false,
  });
  // Signal to disposeGroupPreservingShared that this texture is not shared
  // and must be disposed together with the material to avoid leaking GPU memory
  material.userData.ownsMap = true;
  const sprite = new Sprite(material);
  sprite.scale.set(h * 3.0, h * 3.0 * (canvasHeight / canvasWidth), 1);
  // Anchor at the bottom edge so zoom compensation grows the label upwards,
  // away from the building, instead of over it
  sprite.center.set(0.5, 0);
  sprite.renderOrder = 10;
  sprite.name = `structure-label-${structure.id}`;
  sprite.userData.type = "structureLabel";
  sprite.userData.baseWidth = h * 3.0;
  sprite.userData.baseHeight = h * 3.0 * (canvasHeight / canvasWidth);
  sprite.visible = false;
  return sprite;
};

/** Camera zoom at which structure labels render at their authored world size */
const STRUCTURE_LABEL_REFERENCE_ZOOM = 2;

/**
 * Toggle building labels each frame: all visible when showAll is set,
 * otherwise only the label of the structure sprite under the pointer.
 * Visible labels are counter-scaled by the camera zoom so they keep a
 * constant, readable on-screen size at every zoom level.
 */
export const intersectStructures = (info: {
  structureSprites: Sprite[];
  raycaster: Raycaster;
  showAll: boolean;
  pointerOnMap: boolean;
  cameraZoom: number;
}) => {
  const { structureSprites, raycaster, showAll, pointerOnMap, cameraZoom } = info;
  let hovered: Sprite | null = null;
  if (!showAll && pointerOnMap && structureSprites.length > 0) {
    const intersects = raycaster.intersectObjects(structureSprites, false);
    hovered = (intersects[0]?.object as Sprite) ?? null;
  }
  const zoomComp = Math.min(
    3,
    Math.max(0.6, STRUCTURE_LABEL_REFERENCE_ZOOM / Math.max(0.1, cameraZoom)),
  );
  structureSprites.forEach((sprite) => {
    const label = sprite.userData.labelSprite as Sprite | undefined;
    if (!label) return;
    label.visible = showAll || sprite === hovered;
    if (label.visible) {
      const width = (label.userData.baseWidth as number) * zoomComp;
      if (Math.abs(label.scale.x - width) > 0.001) {
        label.scale.set(width, (label.userData.baseHeight as number) * zoomComp, 1);
      }
    }
  });
};

/**
 * Draw village on map
 */
export const drawVillage = (
  group: Group,
  structures: VillageStructure[],
  grid: Grid<TerrainHex>,
  sectorMap: NormalizedSectorMap,
  villageType: string | null,
) => {
  // Village wall: towers along the village-zone boundary; roads crossing
  // the boundary are left open and read as gates
  if (villageType === "VILLAGE" || villageType === "TOWN") {
    const tilesByKey = new Map(
      sectorMap.tiles.map((tile) => [getSectorMapTileKey(tile.x, tile.y), tile]),
    );
    const wallTexture = loadTexture(IMG_SECTOR_WALL_STONE_TOWER);
    const wallMaterial = new SpriteMaterial({ map: wallTexture });
    sectorMap.tiles.forEach((tile) => {
      if (tile.zone !== "village") return;
      const isBoundary = getNeighborCoordinates(tile).some((coordinate) => {
        const neighbor = tilesByKey.get(
          getSectorMapTileKey(coordinate.x, coordinate.y),
        );
        return (
          !neighbor ||
          (neighbor.zone !== "village" &&
            neighbor.zone !== "road" &&
            neighbor.zone !== "structure" &&
            neighbor.zone !== "shrine")
        );
      });
      if (!isBoundary) return;
      const pos = grid.getHex({ col: tile.x, row: tile.y });
      if (!pos) return;
      const { height: h, x, y } = pos;
      const sprite = new Sprite(wallMaterial);
      sprite.scale.set(h * 0.8, h * 1.2, 1);
      sprite.position.set(x, y + h / 3, ASSETS_LAYER);
      group.add(sprite);
    });
  }
  // Village structures
  for (const structure of structures.filter((s) => s.hasPage !== 0)) {
    const pos = grid.getHex({ col: structure.longitude, row: structure.latitude });
    if (pos) {
      // Add a structure group
      const { height: h, x, y } = pos;
      // Structure sprite; cast shadows are baked into the structure art
      // (sun upper-right, shadow lower-left, matching decoration sprites)
      const texture = loadTexture(structure.image, 200);
      const material = new SpriteMaterial({
        map: texture,
        depthWrite: false,
        depthTest: false,
      });
      const sprite = new Sprite(material);
      sprite.scale.set(h * 3.0, h * 3.0, 1);
      sprite.position.set(x, y + h / 10, ASSETS_LAYER);
      // Identify the building on raycasts (e.g. the editor's drag-to-relocate)
      sprite.userData.type = "structure";
      sprite.userData.structureId = structure.id;
      sprite.userData.structureName = structure.name;
      group.add(sprite);
      // Floating name label, revealed on hover or via the travel page's
      // label toggle (see intersectStructures). Bottom-anchored just above
      // the building sprite's top edge.
      const label = createStructureLabel(structure, h);
      label.position.set(x, y + h / 10 + h * 1.55, STATUS_LAYER);
      sprite.userData.labelSprite = label;
      group.add(label);
    }
  }
};

// Cache for user/battle meshes to avoid getObjectByName every frame
const userMeshCache = new Map<string, Group>();

/**
 * Draw/update the users on the map. Should be called on every render
 */
export const drawUsers = (info: {
  group_users: Group;
  users: SectorUser[];
  grid: Grid<TerrainHex>;
  lastTime: number;
  angle: number;
  minBracket: number;
}) => {
  const endMark = profiler.mark("drawUsers");
  // Group the users by their location
  const groups = groupBy(
    info.users
      .filter((user) => passesBracketFilter(user, info.minBracket))
      .map((user) => ({
        ...user,
        group: `${user.latitude},${user.longitude}`,
      })),
    "group",
  );

  // Calculate new angle, which is used for rotating users placed on same location
  const dt = Date.now() - info.lastTime;
  const phi = info.angle + (1 * Math.PI) / (5000 / dt);

  // Draw the users
  const drawnIds = new Set<string>();
  groups.forEach((tileUsers) => {
    if (tileUsers[0]) {
      // Determine the location
      const firstUser = tileUsers[0];
      const awakeUsers = tileUsers.filter((u) => u.status === "AWAKE");
      const combatUsers = tileUsers.filter((u) => u.status === "BATTLE");
      const nUsers = awakeUsers.length;
      const hex = findHex(info.grid, {
        x: firstUser.longitude,
        y: firstUser.latitude,
      });
      if (hex) {
        // Loop through the users in the group who are awake
        awakeUsers.forEach((user, i) => {
          let userMesh = userMeshCache.get(user.userId);
          if (userMesh && userMesh.parent !== info.group_users) {
            userMesh = undefined;
          }

          if (!userMesh) {
            userMesh = createUserSprite(user, hex);
            info.group_users.add(userMesh);
            userMeshCache.set(user.userId, userMesh);
          }
          // Get location
          if (userMesh) {
            userMesh.visible = true;
            userMesh.userData.tile = hex;
            let { x, y } = hex.center;
            const spread = 0.1;
            if (nUsers > 1) {
              const angleChange = (i / tileUsers.length) * 2 * Math.PI + phi;
              x += spread * hex.width * Math.sin(angleChange);
              y -= spread * hex.height * Math.cos(angleChange);
            }
            userMesh.position.set(-x, -y, 0);
            drawnIds.add(user.userId);
          }
        });
        // Loop through the users in the group who are awake
        const battleGroups = groupBy(combatUsers, "battleId");
        let i = 0;
        battleGroups.forEach((tileCombatUsers, battleId) => {
          i += 1;
          const firstUser = tileCombatUsers[0];
          const secondUser = tileCombatUsers[1];
          if (firstUser && secondUser && battleId) {
            let userMesh = userMeshCache.get(battleId);
            if (userMesh && userMesh.parent !== info.group_users) {
              userMesh = undefined;
            }

            if (!userMesh) {
              userMesh = createCombatSprite(firstUser, secondUser, battleId, hex);
              info.group_users.add(userMesh);
              userMeshCache.set(battleId, userMesh);
            }
            if (userMesh) {
              userMesh.visible = true;
              userMesh.userData.tile = hex;
              let { x, y } = hex.center;
              const spread = 0.1;
              if (battleGroups.size > 1) {
                const angleChange = (i / tileUsers.length) * 2 * Math.PI + phi;
                x += spread * hex.width * Math.sin(angleChange);
                y -= spread * hex.height * Math.cos(angleChange);
              }
              userMesh.position.set(-x, -y, 0);
              drawnIds.add(battleId);
            }
          }
        });
        // Add indicator of how many users are there if more than 1
        if (nUsers > 2 && awakeUsers) {
          const indicatorName = `${hex.col}-${hex.row}-${nUsers}`;
          let indicatorMesh = userMeshCache.get(indicatorName);
          if (indicatorMesh && indicatorMesh.parent !== info.group_users) {
            indicatorMesh = undefined;
          }

          if (!indicatorMesh) {
            indicatorMesh = createMultipleUserSprite(nUsers, "test", hex);
            indicatorMesh.name = indicatorName;
            indicatorMesh.position.set(-hex.center.x, -hex.center.y, 0);
            info.group_users.add(indicatorMesh);
            userMeshCache.set(indicatorName, indicatorMesh);
          }
          if (indicatorMesh) {
            indicatorMesh.visible = true;
          }
          drawnIds.add(indicatorName);
        }
      }
    }
  });
  info.group_users.children.sort((a, b) => b.position.y - a.position.y);
  // Hide all user counters which are not used anymore
  info.group_users.children.forEach((object) => {
    if (!drawnIds.has(object.name)) {
      object.visible = false;
    }
  });

  profiler.reportCount("sector_users", info.users.length);
  profiler.reportCount("sector_visible_users", drawnIds.size);
  endMark();
  // Return new counters + angle
  return phi;
};

/**
 * Get intersections with user sprites, and show info/attack buttons if needed.
   If more than one user intersected, do not show
 */
export const intersectUsers = (info: {
  group_users: Group;
  raycaster: Raycaster;
  allyAttack: boolean;
  users: SectorUser[];
  userData: NonNullable<UserWithRelations>;
  currentTooltips: Set<string>;
}) => {
  const endMark = profiler.mark("intersectUsers");
  const { group_users, allyAttack, raycaster, users, userData, currentTooltips } = info;
  const intersects = raycaster.intersectObjects(group_users.children);
  const newUserTooltips = new Set<string>();
  const userMesh = intersects.find(
    (i) =>
      i.object.parent?.userData.type === "user" &&
      i.object.parent?.userData.userId !== userData.userId,
  )?.object.parent;
  if (users && userMesh && intersects.length > 0) {
    const userHex = userMesh.userData.tile as TerrainHex;
    const locationUsers = users.filter(
      (g) =>
        g.latitude === userHex.row &&
        g.longitude === userHex.col &&
        g.userId !== userData.userId,
    );
    if (userMesh.userData.battleId) {
      if (document.body.style.cursor !== "wait") {
        document.body.style.cursor = "pointer";
        newUserTooltips.add(userMesh.name);
      }
    }
    if (locationUsers.length === 1 && userMesh) {
      const userId = userMesh.userData.userId as string | undefined;
      if (userId) {
        const user = users.filter(Boolean).find((u) => u.userId === userId);
        if (user) {
          const attack = userMesh?.children[3] as Sprite;
          const heal = userMesh?.children[4] as Sprite;
          const details = userMesh?.children[5] as Sprite;
          const relationship =
            userData.village &&
            findVillageUserRelationship(userData.village, user.villageId);
          const isAlly =
            user.villageId === userData.villageId || relationship?.status === "ALLY";
          const showAttack =
            !RANKS_RESTRICTED_FROM_PVP.includes(user.rank) && (allyAttack || !isAlly);
          const showHeal =
            user.curHealth < user.maxHealth &&
            hasRequiredRank(userData.rank, MEDNIN_MIN_RANK);

          if (attack && userData.userId !== userId && showAttack) {
            attack.visible = true;
          }
          if (heal && userData.userId !== userId && showHeal) {
            heal.visible = true;
          }
          if (details) details.visible = true;
          if (document.body.style.cursor !== "wait") {
            document.body.style.cursor = "pointer";
          }
          newUserTooltips.add(userMesh.name);
        }
      }
    }
  }

  currentTooltips.forEach((userId) => {
    if (!newUserTooltips.has(userId)) {
      const attackSprite = group_users.getObjectByName(`${userId}-attack`);
      if (attackSprite) attackSprite.visible = false;
      const healSprite = group_users.getObjectByName(`${userId}-heal`);
      if (healSprite) healSprite.visible = false;
      const infoSprite = group_users.getObjectByName(`${userId}-info`);
      if (infoSprite) infoSprite.visible = false;
    }
  });

  if (currentTooltips.size === 0 && document.body.style.cursor !== "wait") {
    document.body.style.cursor = "default";
  }

  endMark();
  return newUserTooltips;
};

// Track the last intersected tile to avoid redundant pathfinding
let lastIntersectedTileName: string | null = null;

/** Interaction-layer tile mesh: type/tile/highlight are set by drawSector,
 * sector is stamped afterwards by the window renderer (Sector.tsx) */
type TileMesh = Mesh<BufferGeometry, MeshBasicMaterial> & {
  userData: { type?: string; sector?: number; tile?: TerrainHex; highlight?: boolean };
};

/**
 * Hover highlight across the whole 3x3 window: raycasts every sector's
 * interaction meshes, then lights up the A* path from the character to the
 * hovered tile, following it across sector borders via the unified window
 * pathfinder. Highlight keys are `dx,dy,row,col` so tiles in different
 * sectors' interaction groups are tracked together. Returns the new
 * highlight-key set; clears all highlights when `active` is false or the
 * hovered tile is blocked/unmapped.
 */
export const intersectWindowTiles = (info: {
  raycaster: Raycaster;
  interactionGroups: Group[];
  nav: WindowNav;
  origin: { dx: number; dy: number; col: number; row: number };
  offsetOfSector: (sector: number) => { dx: number; dy: number } | null;
  groupOfOffset: (dx: number, dy: number) => Group | null;
  currentHighlights: Set<string>;
  /** False when the pointer is off the map - clear everything and stop */
  active: boolean;
}) => {
  const endMark = profiler.mark("intersectTiles");
  const { raycaster, interactionGroups, nav, origin, active } = info;
  const { offsetOfSector, groupOfOffset, currentHighlights } = info;
  const newHighlights = new Set<string>();

  /** The interaction mesh for a tile addressed by window offset + row/col */
  const meshAt = (dx: number, dy: number, row: number, col: number) =>
    groupOfOffset(dx, dy)?.getObjectByName(`${row},${col}`) as TileMesh | undefined;
  /** Toggle a tile's highlight material visibility and bookkeeping flag */
  const setLit = (mesh: TileMesh | undefined, lit: boolean) => {
    if (!mesh) return;
    mesh.userData.highlight = lit;
    mesh.material.visible = lit;
  };
  /** Un-light a previously highlighted tile from its "dx,dy,row,col" key */
  const clearHighlight = (key: string) => {
    const [dx, dy, row, col] = key.split(",").map(Number);
    if (dx === undefined || dy === undefined || row === undefined || col === undefined)
      return;
    setLit(meshAt(dx, dy, row, col), false);
  };

  // Pointer off the map: clear every lit tile and stop (no raycast overhead)
  if (!active) {
    lastIntersectedTileName = null;
    currentHighlights.forEach(clearHighlight);
    endMark();
    return newHighlights;
  }

  const intersects = raycaster.intersectObjects(interactionGroups);
  const hit = intersects.find((i) => (i.object as TileMesh).userData?.type === "tile")
    ?.object as TileMesh | undefined;

  if (hit?.userData.tile) {
    const target = hit.userData.tile;
    const offset = offsetOfSector(hit.userData.sector ?? -1);
    if (target.blocked || !offset) {
      lastIntersectedTileName = null;
      currentHighlights.forEach(clearHighlight);
      endMark();
      return newHighlights;
    }
    const key = `${offset.dx},${offset.dy},${target.row},${target.col}`;

    // PERFORMANCE OPTIMIZATION: Only recalculate path if the tile changed
    if (key === lastIntersectedTileName) {
      endMark();
      return currentHighlights;
    }
    lastIntersectedTileName = key;

    const start = nav.toUnified(origin.dx, origin.dy, origin.col, origin.row);
    const goal = nav.toUnified(offset.dx, offset.dy, target.col, target.row);
    const path =
      start && goal ? nav.pathFinder.getShortestPath(start, goal) : undefined;
    void path?.forEach((unifiedTile) => {
      const local = nav.fromUnified(unifiedTile);
      const mesh = meshAt(local.dx, local.dy, local.row, local.col);
      if (!mesh) return;
      setLit(mesh, true);
      newHighlights.add(`${local.dx},${local.dy},${local.row},${local.col}`);
    });
  } else {
    lastIntersectedTileName = null;
  }

  // Turn off tiles that are no longer part of the hovered path
  currentHighlights.forEach((key) => {
    if (!newHighlights.has(key)) clearHighlight(key);
  });
  endMark();
  return newHighlights;
};

/**
 * Create a generic structure, useful for e.g. showing structure on the map
 * @param name - The name of the structure
 * @param route - The route of the structure
 * @param image - The image of the structure
 * @param latitude - The latitude of the structure
 * @param longitude - The longitude of the structure
 * @returns The structure
 */
export const createGenericStructure = (info: {
  name: string;
  route: string;
  image: string;
  latitude: number;
  longitude: number;
}): VillageStructure => {
  return {
    id: nanoid(),
    name: info.name,
    route: info.route,
    image: info.image,
    villageId: "unknown",
    longitude: info.longitude,
    latitude: info.latitude,
    hasPage: 1,
    showInVillagePage: false,
    curSp: 100,
    maxSp: 100,
    allyAccess: 1,
    level: 1,
    maxLevel: 1,
    lastUpgradedAt: new Date(),
    anbuSquadsPerLvl: 0,
    arenaRewardPerLvl: 0,
    bankInterestPerLvl: 0,
    blackDiscountPerLvl: 0,
    clansPerLvl: 0,
    hospitalSpeedupPerLvl: 0,
    itemDiscountPerLvl: 0,
    missionRewardPerLvl: 0,
    patrolsPerLvl: 0,
    ramenDiscountPerLvl: 0,
    regenIncreasePerLvl: 0,
    sleepRegenPerLvl: 0,
    structureDiscountPerLvl: 0,
    trainBoostPerLvl: 0,
    villageDefencePerLvl: 0,
    temporaryLevelBonus: 0,
    temporaryLevelBonusExpiresAt: null,
  };
};
