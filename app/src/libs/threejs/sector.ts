import { Grid, Orientation, rectangle } from "honeycomb-grid";
import { nanoid } from "nanoid";
import { createNoise2D } from "simplex-noise";
import {
  type BufferGeometry,
  EdgesGeometry,
  Group,
  Line,
  LinearFilter,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
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
  IMG_MAP_QUEST_ICON,
  IMG_SECTOR_ATTACK,
  IMG_SECTOR_INFO,
  IMG_SECTOR_USER_MARKER,
  IMG_SECTOR_USER_SPRITE_MASK,
  IMG_SECTOR_USERSPRITE_LEFT,
  IMG_SECTOR_USERSPRITE_RIGHT,
  IMG_SECTOR_VS_ICON,
  MEDNIN_MIN_RANK,
  RANKS_RESTRICTED_FROM_PVP,
  STATUS_LAYER,
  STRUCTURE_ADJACENTS,
  TILES_LAYER,
  USER_LAYER,
} from "@/drizzle/constants";
import type { VillageStructure } from "@/drizzle/schema";
import { pickSpriteAvatar } from "@/libs/overworldAi";
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
import {
  getVillageWallSpriteSpec,
  STONE_VILLAGE_WALL_KIT,
  type VillageWallPanelSpriteSpec,
  type VillageWallSpriteSpec,
} from "@/libs/sector-map/village-wall-assets";
import {
  getVillageWallDecorationClearanceKeys,
  getVillageWallFoundationKeys,
  planVillageWalls,
  selectVillageWallTowerVertices,
  usesVillageWalls,
  type VillageWallPlan,
} from "@/libs/sector-map/village-walls";
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
  _terrainRegistry: Map<string, TerrainSpec>,
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
      // The authored walk cost is authoritative. Standard water has the same
      // cost as ground because ninja can traverse it with chakra.
      tile.cost = mapTile.walkCost + 1;
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
        sprite.userData.mapX = object.x;
        sprite.userData.mapY = object.y;
        // Painter ordering follows the trunk/ground contact, not the visual
        // center of a tall tree sprite (which varies with renderScale).
        sprite.userData.assetSortY = y + h * (object.offsetY ?? 0);
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
      sprite.userData.assetSortY = y + h / 8;
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

// Hover-path highlight: the per-tile interaction meshes double as the
// highlight overlay. They stay not-rendered (material.visible = false, so no
// draw cost) until a tile joins the hovered path, when they light up - making
// it clear you can click anywhere on the map to walk there.
const TILE_HIGHLIGHT_COLOR = 0xffc23e;
const TILE_HIGHLIGHT_OPACITY = 0.4;

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
  villageType: string | null,
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
  const villageWallPlan = usesVillageWalls(villageType)
    ? planVillageWalls(sectorMap, allStructures)
    : null;
  const wallFoundationKeys = villageWallPlan
    ? getVillageWallFoundationKeys(villageWallPlan)
    : new Set<string>();
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
      // Effective path cost comes from the authored map. Standard water uses
      // the same walk cost as ground; explicit obstacles remain blocked below.
      const spec = resolveTerrainSpec(
        authoredTile?.terrain ?? baseBiome,
        terrainRegistry,
      );
      // Stash the resolved spec + authored tile so the geometry pass below reads
      // them off the hex instead of re-doing the lookup + resolve for all 676 tiles
      tile.spec = spec;
      tile.authored = authoredTile;
      tile.cost = (authoredTile ? authoredTile.walkCost : 1) + 1;
      tile.blocked = authoredTile?.blocked || authoredTile?.walkCost === 0;
      tile.zone = authoredTile?.zone;
      // Combat arena for battles on this tile: the authored per-tile override
      // wins, else the terrain's configured arena
      tile.battleBiome = authoredTile?.battleBiome ?? spec.battleBiome;

      const hasStructureFoundation = structureTileKeys.has(tileKey);
      // Structures and the village-facing tile below each wall segment use a
      // flat, biome-appropriate foundation. This keeps walls from floating on
      // recessed water/ice while leaving the exterior terrain untouched.
      if (hasStructureFoundation || wallFoundationKeys.has(tileKey)) {
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
        if (hasStructureFoundation) {
          tile.hasStructure = true;
          tile.blocked = false;
        }
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
    villageWallPlan,
  };
};

/**
 * User sprite, which loads the avatar image and displays the health bar as a js sprite
 */
export const createUserSprite = (userData: SectorUser, hex: TerrainHex) => {
  // Group is used to group components of the user Marker
  const group = new Group();
  const { height: h, width: w } = hex;

  // Players render as an alliance-coloured portrait inside a map pin. Overworld NPCs render
  // as a free-standing character standing on the tile instead, so they skip the pin entirely.
  if (!userData.isNpc) {
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
  }

  // Avatar Sprite. Players are cropped to a circular portrait via the sprite mask; NPCs use
  // the avatar's own transparency so the full character shows, sized up to read on the tile.
  const avatar = pickSpriteAvatar(userData);
  const map = loadTexture(avatar);
  map.generateMipmaps = false;
  map.minFilter = LinearFilter;
  const material = userData.isNpc
    ? new SpriteMaterial({ map: map, transparent: true })
    : new SpriteMaterial({
        map: map,
        alphaMap: loadTexture(IMG_SECTOR_USER_SPRITE_MASK),
      });
  const sprite = new Sprite(material);
  const avatarScale = userData.isNpc ? h * 1.3 : h * 0.8;
  Object.assign(sprite.scale, new Vector3(avatarScale, avatarScale, 1));
  Object.assign(sprite.position, new Vector3(w / 2, h * 1.0, USER_LAYER));
  group.add(sprite);

  if (userData.isNpc) {
    // NPC interaction sprite: "talk" for friendly, "attack" for hostile
    const isHostile = userData.npcInteractionType === "HOSTILE";
    const npcIcon = loadTexture(isHostile ? IMG_SECTOR_ATTACK : IMG_MAP_QUEST_ICON);
    const npcMat = new SpriteMaterial({ map: npcIcon, depthTest: false });
    const npcSprite = new Sprite(npcMat);
    npcSprite.visible = true;
    npcSprite.userData.userId = userData.userId;
    npcSprite.userData.npcPlacementId = userData.npcPlacementId;
    npcSprite.userData.npcPositionVersion = userData.npcPositionVersion;
    npcSprite.userData.type = isHostile ? "attack" : "talk";
    Object.assign(npcSprite.scale, new Vector3(h * 0.8, h * 0.8, 1));
    Object.assign(npcSprite.position, new Vector3(w * 0.9, h * 1.4, STATUS_LAYER));
    npcSprite.name = `${userData.npcPlacementId ?? userData.userId}-npc`;
    group.add(npcSprite);
  } else {
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
  }

  // Name
  group.name = userData.isNpc
    ? (userData.npcPlacementId ?? userData.userId)
    : userData.userId;
  group.userData.type = "user";
  group.userData.userId = userData.userId;
  group.userData.isNpc = userData.isNpc;
  group.userData.npcPlacementId = userData.npcPlacementId;
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
 * Raycast village structure sprites under the pointer. Returns the hovered
 * structure id (or null) so the sector UI can show a fixed HTML "Go to"
 * card that stays readable at every resolution and zoom level.
 */
export const intersectStructures = (info: {
  structureSprites: Sprite[];
  raycaster: Raycaster;
  pointerOnMap: boolean;
}): string | null => {
  const { structureSprites, raycaster, pointerOnMap } = info;
  if (!pointerOnMap || structureSprites.length === 0) return null;
  const intersects = raycaster.intersectObjects(structureSprites, false);
  const hovered = intersects[0]?.object as Sprite | undefined;
  const structureId = hovered?.userData.structureId;
  return typeof structureId === "string" ? structureId : null;
};

const WALL_CORNERS_BY_DIRECTION = [
  [2, 3],
  [5, 0],
  [3, 4],
  [1, 2],
  [4, 5],
  [0, 1],
] as const;

export const createVillageWallSprite = (
  spec: VillageWallSpriteSpec,
  point: { x: number; y: number },
  hexHeight: number,
  type: "village_wall_panel" | "village_wall_pier" | "village_wall_tower",
) => {
  const texture = loadTexture(spec.url, 256);
  texture.magFilter = NearestFilter;
  const material = new SpriteMaterial({
    map: texture,
    alphaTest: 0.2,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });
  const size = hexHeight * spec.scale;
  const sprite = new Sprite(material);
  sprite.scale.set(size, size, 1);
  // Keep position.y on the true ground contact so the existing painter sort
  // compares walls, posts and buildings by their common footpoint. Sprite
  // center uses bottom-origin texture coordinates, hence 1 - anchorY.
  sprite.center.set(0.5, 1 - spec.anchorY);
  sprite.position.set(point.x, point.y, ASSETS_LAYER);
  sprite.userData.type = type;
  sprite.userData.wallKit = STONE_VILLAGE_WALL_KIT.version;
  sprite.userData.assetSortY = point.y;
  return sprite;
};

/**
 * Fit a panel's authored connector points exactly onto one world-space wall
 * edge. Independent X/Y fitting is intentional: the perspective hex grid is
 * vertically compressed, while the source art lives on a square canvas.
 */
export const createVillageWallPanelSprite = (
  spec: VillageWallPanelSpriteSpec,
  first: { x: number; y: number },
  second: { x: number; y: number },
  hexHeight: number,
) => {
  const [connectorA, connectorB] = spec.connectors;
  const connectorDx = Math.abs(connectorB.x - connectorA.x);
  const connectorDy = Math.abs(connectorB.y - connectorA.y);
  const worldDx = Math.abs(second.x - first.x);
  const worldDy = Math.abs(second.y - first.y);
  const texture = loadTexture(spec.url, 256);
  texture.magFilter = NearestFilter;
  const material = new SpriteMaterial({
    map: texture,
    alphaTest: 0.2,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });
  const sprite = new Sprite(material);
  sprite.scale.set(
    connectorDx > 0.001 ? worldDx / connectorDx : hexHeight * spec.height,
    connectorDy > 0.001 ? worldDy / connectorDy : hexHeight * spec.height,
    1,
  );
  sprite.center.set(
    (connectorA.x + connectorB.x) / 2,
    1 - (connectorA.y + connectorB.y) / 2,
  );
  sprite.position.set((first.x + second.x) / 2, (first.y + second.y) / 2, ASSETS_LAYER);
  sprite.userData.type = "village_wall_panel";
  sprite.userData.wallKit = STONE_VILLAGE_WALL_KIT.version;
  sprite.userData.assetSortY = (first.y + second.y) / 2;
  return sprite;
};

/**
 * Sort transparent sector sprites back-to-front from their ground contact.
 * The renderer deliberately leaves object sorting disabled, so this child
 * order is what prevents trees, buildings and walls from painting over each other.
 */
export const sortSectorAssetsByGroundContact = (group: Group) => {
  group.children.sort((a, b) => {
    const aSortY =
      typeof a.userData.assetSortY === "number"
        ? (a.userData.assetSortY as number)
        : a.position.y;
    const bSortY =
      typeof b.userData.assetSortY === "number"
        ? (b.userData.assetSortY as number)
        : b.position.y;
    return bSortY - aSortY;
  });
};

const drawVillageWall = (
  group: Group,
  grid: Grid<TerrainHex>,
  plan: VillageWallPlan,
) => {
  if (plan.edges.length === 0) return;
  const decorationClearance = getVillageWallDecorationClearanceKeys(plan);
  group.children.forEach((child) => {
    if (child.userData.type !== "decoration") return;
    const mapX = child.userData.mapX;
    const mapY = child.userData.mapY;
    if (typeof mapX !== "number" || typeof mapY !== "number") return;
    if (decorationClearance.has(getSectorMapTileKey(mapX, mapY))) {
      // Keep the hidden sprite owned by the group so normal scene teardown
      // still disposes its material while avoiding a wall/tree collision.
      child.visible = false;
    }
  });
  const vertexPositions = new Map<string, { x: number; y: number; h: number }>();
  const gateVertices = new Set<string>();

  plan.edges.forEach((edge) => {
    const tile = grid.getHex({ col: edge.tile.x, row: edge.tile.y });
    const cornerIndices = WALL_CORNERS_BY_DIRECTION[edge.direction];
    if (!tile || !cornerIndices) return;
    const first = tile.corners[cornerIndices[0]];
    const second = tile.corners[cornerIndices[1]];
    if (!first || !second) return;
    const spec = getVillageWallSpriteSpec(STONE_VILLAGE_WALL_KIT, edge.kind, edge.axis);
    const sprite = createVillageWallPanelSprite(spec, first, second, tile.height);
    sprite.userData.wallKind = edge.kind;
    sprite.userData.wallAxis = edge.axis;
    group.add(sprite);
    vertexPositions.set(edge.vertices[0], {
      x: first.x,
      y: first.y,
      h: tile.height,
    });
    vertexPositions.set(edge.vertices[1], {
      x: second.x,
      y: second.y,
      h: tile.height,
    });
    if (edge.kind === "gate") {
      edge.vertices.forEach((vertex) => {
        gateVertices.add(vertex);
      });
    }
  });

  const towerVertices = new Set<string>();
  plan.contours.forEach((contour) => {
    selectVillageWallTowerVertices(
      contour,
      gateVertices,
      STONE_VILLAGE_WALL_KIT.maxTowers,
    ).forEach((vertex) => {
      towerVertices.add(vertex);
    });
  });

  plan.vertices.forEach((vertex) => {
    const point = vertexPositions.get(vertex.id);
    if (!point) return;
    const isTower = towerVertices.has(vertex.id) && !gateVertices.has(vertex.id);
    const sprite = createVillageWallSprite(
      isTower ? STONE_VILLAGE_WALL_KIT.tower : STONE_VILLAGE_WALL_KIT.pier,
      point,
      point.h,
      isTower ? "village_wall_tower" : "village_wall_pier",
    );
    group.add(sprite);
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
  wallPlan?: VillageWallPlan | null,
) => {
  // Structure-derived modular wall: a connected contour one clear hex beyond
  // every physical structure, with authored road crossings rendered as gates.
  if (usesVillageWalls(villageType)) {
    drawVillageWall(group, grid, wallPlan ?? planVillageWalls(sectorMap, structures));
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
      sprite.userData.assetSortY = y + h / 10;
      group.add(sprite);
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
      .filter((user) => user.isNpc || passesBracketFilter(user, info.minBracket))
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
          const cacheKey = user.isNpc
            ? (user.npcPlacementId ?? user.userId)
            : user.userId;
          let userMesh = userMeshCache.get(cacheKey);
          if (userMesh && userMesh.parent !== info.group_users) {
            userMesh = undefined;
          }

          if (!userMesh) {
            userMesh = createUserSprite(user, hex);
            info.group_users.add(userMesh);
            userMeshCache.set(cacheKey, userMesh);
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
            drawnIds.add(cacheKey);
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
        !g.isNpc &&
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
    // NPC groups have a different child layout, so skip the player index-based sprite logic
    // for them — but do NOT early-return: the tooltip-cleanup loop below must still run.
    if (locationUsers.length === 1 && userMesh && !userMesh.userData.isNpc) {
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
