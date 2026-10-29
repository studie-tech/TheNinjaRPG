import type { Grid } from "honeycomb-grid";
import { IMG_SECTOR_USER_MARKER } from "@/drizzle/constants";
import type { MapAsset, VillageStructure } from "@/drizzle/schema";
import type { TerrainHex } from "@/libs/hexgrid";
import { groupMapLocations } from "@/libs/mapLocations";
import {
  type DecorationAsset,
  resolveDecorationAsset,
} from "@/libs/sector-map/decorations";
import type { NormalizedSectorMap } from "@/libs/sector-map/types";
import {
  getVillageWallSpriteSpec,
  STONE_VILLAGE_WALL_KIT,
} from "@/libs/sector-map/village-wall-assets";
import {
  getVillageWallDecorationClearanceKeys,
  selectVillageWallTowerVertices,
  type VillageWallPlan,
} from "@/libs/sector-map/village-walls";
import type { MapLocation } from "@/validators/mapLocation";

/** Static scenery is described once, independently of its renderer and texture loading. */
export const sectorSpriteDescriptions = (options: {
  map: NormalizedSectorMap;
  grid: Grid<TerrainHex>;
  decorations: Map<string, DecorationAsset>;
  structures: VillageStructure[];
  wall: VillageWallPlan | null;
  lightLayout: boolean;
  locations?: MapLocation[];
  mapAssets?: Pick<MapAsset, "id" | "imageUrl" | "renderScale">[];
}) => {
  const { grid, map, decorations, structures, wall, lightLayout } = options;
  const sprites: WorldSpriteDescription[] = [];
  const placed = (options.locations ?? []).filter(
    (location) =>
      Number.isFinite(location.longitude) && Number.isFinite(location.latitude),
  );
  const occupied = new Set(
    placed.map((location) => `${location.longitude},${location.latitude}`),
  );
  const clearance = wall
    ? getVillageWallDecorationClearanceKeys(wall)
    : new Set<string>();
  for (const object of map.objects) {
    if (!object.assetKey) continue;
    const tile = grid.getHex({ col: object.x, row: object.y });
    if (!tile) continue;
    const h = tile.height;
    if (object.type === "decoration") {
      if (
        lightLayout ||
        tile.hasStructure ||
        occupied.has(`${object.x},${object.y}`) ||
        clearance.has(`${object.x},${object.y}`)
      )
        continue;
      const asset = resolveDecorationAsset(object, decorations);
      if (!asset) continue;
      const scale = object.scale ?? asset.renderScale ?? 1;
      const seed = ((object.x * 31 + object.y * 17) % 100) / 100;
      sprites.push({
        id: object.id,
        kind: "decoration",
        image: asset.filepath,
        size: h * scale,
        x: tile.x + tile.width * (object.offsetX ?? 0),
        y: tile.y + h * (scale / 2 - 0.5 + 0.1 * scale) + h * (object.offsetY ?? 0),
        groundY: tile.y + h * (object.offsetY ?? 0),
        small: asset.small === true,
        rendition: asset.small ? 50 : 128,
        nearest: true,
        wind: asset.windAffected ? (Math.floor(seed * 4) * Math.PI) / 2 : null,
        rotation: asset.randomRotation ? seed * Math.PI * 2 : 0,
      });
    } else {
      sprites.push({
        id: object.id,
        kind: object.type,
        image: object.assetKey,
        size:
          h * (object.type === "structure" || object.type === "landmark" ? 2.4 : 1.2),
        x: tile.x,
        y: tile.y + h / 8,
        groundY: tile.y + h / 8,
        rendition: 200,
      });
    }
  }
  if (wall) sprites.push(...villageWallDescriptions(grid, wall));
  for (const structure of structures) {
    if (structure.hasPage === 0) continue;
    const tile = grid.getHex({ col: structure.longitude, row: structure.latitude });
    if (!tile) continue;
    sprites.push({
      id: structure.id,
      kind: "structure",
      image: structure.image,
      size: tile.height * 3,
      x: tile.x,
      y: tile.y + tile.height / 10,
      groundY: tile.y + tile.height / 10,
      rendition: 200,
      structureId: structure.id,
    });
  }
  for (const entries of groupMapLocations(placed)) {
    const location = entries[0];
    if (!location) continue;
    const tile = grid.getHex({ col: location.longitude, row: location.latitude });
    if (!tile) continue;
    const asset = options.mapAssets?.find(
      (candidate) => candidate.id === location.assetId,
    );
    if (asset)
      sprites.push({
        id: `location:${location.id}`,
        kind: "questStructure",
        image: asset.imageUrl,
        size: tile.height * asset.renderScale * location.scale,
        preserveAspect: true,
        x: tile.x,
        y: tile.y + tile.height / 10,
        groundY: tile.y,
        anchorY: 0.85,
        rendition: 512,
        locationId: location.id,
      });
    sprites.push({
      id: `location-pin:${location.id}`,
      kind: "questStructure",
      image: IMG_SECTOR_USER_MARKER,
      mask: IMG_SECTOR_USER_MARKER,
      size: tile.height * 1.05,
      width: tile.height * 0.85,
      x: tile.x + tile.width * 0.45,
      y: tile.y,
      groundY: tile.y,
      locationId: location.id,
      tint: entries.some((entry) => entry.active) ? 0xffdf66 : 0x9acddd,
    });
  }
  return sprites.sort((a, b) => b.groundY - a.groundY);
};

const villageWallDescriptions = (grid: Grid<TerrainHex>, plan: VillageWallPlan) => {
  const sprites: WorldSpriteDescription[] = [];
  const vertices = new Map<string, { x: number; y: number; height: number }>();
  const gateVertices = new Set<string>();
  for (const edge of plan.edges) {
    const tile = grid.getHex({ col: edge.tile.x, row: edge.tile.y });
    const corners = WALL_CORNERS[edge.direction];
    if (!tile || !corners) continue;
    const first = tile.corners[corners[0]],
      second = tile.corners[corners[1]];
    if (!first || !second) continue;
    const spec = getVillageWallSpriteSpec(STONE_VILLAGE_WALL_KIT, edge.kind, edge.axis);
    const [a, b] = spec.connectors;
    const dx = Math.abs(a.x - b.x),
      dy = Math.abs(a.y - b.y);
    const height =
      dy > 0.001 ? Math.abs(second.y - first.y) / dy : tile.height * spec.height;
    sprites.push({
      id: `wall:${edge.vertices.join(":")}`,
      kind: "village_wall_panel",
      image: spec.url,
      size: height,
      width: dx > 0.001 ? Math.abs(second.x - first.x) / dx : tile.height * spec.height,
      anchorX: (a.x + b.x) / 2,
      anchorY: (a.y + b.y) / 2,
      x: (first.x + second.x) / 2,
      y: (first.y + second.y) / 2,
      groundY: (first.y + second.y) / 2,
      nearest: true,
      rendition: 256,
    });
    vertices.set(edge.vertices[0], { ...first, height: tile.height });
    vertices.set(edge.vertices[1], { ...second, height: tile.height });
    if (edge.kind === "gate")
      for (const vertex of edge.vertices) gateVertices.add(vertex);
  }
  const towerVertices = new Set(
    plan.contours.flatMap((contour) =>
      selectVillageWallTowerVertices(
        contour,
        gateVertices,
        STONE_VILLAGE_WALL_KIT.maxTowers,
      ),
    ),
  );
  for (const vertex of plan.vertices) {
    const point = vertices.get(vertex.id);
    if (!point) continue;
    const tower = towerVertices.has(vertex.id) && !gateVertices.has(vertex.id);
    const spec = tower ? STONE_VILLAGE_WALL_KIT.tower : STONE_VILLAGE_WALL_KIT.pier;
    sprites.push({
      id: `wall-vertex:${vertex.id}`,
      kind: tower ? "village_wall_tower" : "village_wall_pier",
      image: spec.url,
      size: point.height * spec.scale,
      x: point.x,
      y: point.y,
      groundY: point.y,
      anchorY: spec.anchorY,
      nearest: true,
      rendition: 256,
    });
  }
  return sprites;
};

const WALL_CORNERS = [
  [2, 3],
  [5, 0],
  [3, 4],
  [1, 2],
  [4, 5],
  [0, 1],
] as const;

/**
 * Placement/dimensions use Y-up world units; size is height and groundY orders depth.
 * Anchors are image fractions; rotation/wind phase are radians. rendition is a CDN pixel width.
 */
export type WorldSpriteDescription = {
  character?: import("@/validators/lpc").SpriteAppearance;
  id: string;
  kind: string;
  image: string;
  x: number;
  y: number;
  size: number;
  groundY: number;
  width?: number;
  anchorX?: number;
  anchorY?: number;
  preserveAspect?: boolean;
  rendition?: number;
  nearest?: boolean;
  mask?: string;
  tint?: number;
  small?: boolean;
  wind?: number | null;
  rotation?: number;
  structureId?: string;
  locationId?: string;
};
