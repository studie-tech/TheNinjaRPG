import {
  BufferAttribute,
  BufferGeometry,
  type Color,
  Group,
  LinearFilter,
  LineBasicMaterial,
  LineSegments,
  type Raycaster,
  Sphere,
  Sprite,
  SpriteMaterial,
  Vector3,
} from "three";
import { IMG_SECTOR_USER_SPRITE_MASK } from "@/drizzle/constants";
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from "@/hooks/localstorage";
import { sectorAtGeographic } from "@/libs/sector-map/world-grid";
import type { GlobalMapData, GlobalPoint, GlobalTile } from "@/libs/threejs/types";
import {
  createBorderTexture,
  loadTexture,
  pickSpriteAvatar,
} from "@/libs/threejs/util";
import { fetchWithRetry } from "@/utils/http";

const MAP_CACHE_KEY = "hexasphere_map_cache";
const MAP_CACHE_VERSION = "v21-horizon-near-wake";

/**
 * Fetches the map data from the server, with localStorage caching.
 */
export const fetchMap = async () => {
  // Try to get from localStorage first
  const cached = safeLocalStorageGetItem(MAP_CACHE_KEY);
  if (cached) {
    try {
      const { version, data } = JSON.parse(cached) as {
        version: string;
        data: GlobalMapData;
      };
      if (version === MAP_CACHE_VERSION) {
        return data;
      }
    } catch {
      // Parse error, continue to fetch
    }
  }

  // Fetch from this deployment so the browser and server always use the exact
  // same committed topology; a CDN copy could otherwise drift independently.
  const response = await fetchWithRetry(
    `/api/map/topology?v=${MAP_CACHE_VERSION}`,
    {},
    60_000,
    {
      maxRetries: 3,
      baseDelayMs: 1000,
      deadlineMs: 240_000,
    },
  );
  const hexasphere = (await response.json()) as GlobalMapData;

  // Cache in localStorage for future use
  safeLocalStorageSetItem(
    MAP_CACHE_KEY,
    JSON.stringify({ version: MAP_CACHE_VERSION, data: hexasphere }),
  );

  return hexasphere;
};

/**
 * Create a user avatar sprite for the global map
 *
 * MEMORY OPTIMIZATION: Border textures are cached in util.ts to prevent memory leaks.
 * Previously, each call created a new canvas, causing OOM errors on Firefox (THENINJARPG-2HY).
 * Now border textures are cached by color and disposed during component cleanup.
 */
export const createUserAvatarSprite = (info: {
  userData: {
    userId: string;
    sector: number;
    avatar: string | null;
    avatarLight: string | null;
  };
  sector: GlobalPoint;
  showLine: boolean;
  borderColor: string;
  distance: number;
}) => {
  const { userData, sector, borderColor = "white", distance } = info;
  if (!userData) return new Group();

  const group = new Group();
  // three.js resets its group sort-order at every nested Group, so this group
  // does NOT inherit the parent group_highlights order. Without an explicit
  // renderOrder the sprites tie with the translucent sector grid and fall back
  // to distance sorting, which they lose near the globe's limb — letting grid
  // lines draw over the marker. depthTest still occludes far-side markers.
  group.renderOrder = 2;

  // Distance from the surface
  const d = 3 - distance;

  // Create the line connecting to the surface
  if (info.showLine) {
    const points = [];
    points.push(new Vector3(sector.x / 3, sector.y / 3, sector.z / 3));
    points.push(new Vector3(sector.x / d, sector.y / d, sector.z / d));
    const lineMaterial = new LineBasicMaterial({
      color: "#000000",
      linewidth: 1,
    });
    const geometry = new BufferGeometry().setFromPoints(points);
    const line = new LineSegments(geometry, lineMaterial);
    group.add(line);
  }

  // Create circular border sprite using cached texture
  const borderTexture = createBorderTexture(borderColor, 64);

  const borderMaterial = new SpriteMaterial({
    map: borderTexture,
    // The border ring is alpha-cut; without this the sprite renders in the
    // OPAQUE pass, which draws before the translucent sector grid and so lets
    // the grid lines paint over the marker (and squares off its corners)
    transparent: true,
    depthWrite: false,
    // depthTest so the opaque globe hides markers that are on its far side; the
    // sprite floats just above the surface (see distance) so the near side shows
    depthTest: true,
  });
  const borderSprite = new Sprite(borderMaterial);
  borderSprite.scale.set(1.2, 1.2, 1.2); // Slightly larger than avatar
  borderSprite.position.set(sector.x / d, sector.y / d, sector.z / d);
  group.add(borderSprite);

  // User avatar sprite
  const alphaMap = loadTexture(IMG_SECTOR_USER_SPRITE_MASK);
  const avatar = pickSpriteAvatar(userData);
  const avatarTexture = loadTexture(avatar);
  avatarTexture.generateMipmaps = false;
  avatarTexture.minFilter = LinearFilter;
  const avatarMaterial = new SpriteMaterial({
    map: avatarTexture,
    alphaMap: alphaMap,
    // Required for the circular alphaMap mask to blend at all, and to keep the
    // sprite out of the opaque pass (see borderMaterial above)
    transparent: true,
    depthWrite: false,
    depthTest: true,
  });
  const avatarSprite = new Sprite(avatarMaterial);
  avatarSprite.scale.set(1, 1, 1);
  avatarSprite.position.set(sector.x / d, sector.y / d, sector.z / d);
  group.add(avatarSprite);

  return group;
};

type Point3 = { x: number; y: number; z: number };

/** Quads per sector edge, falling back to a flat quad without a color field. */
const sectorVisualScale = (hexasphere: GlobalMapData, tile: GlobalTile) =>
  hexasphere.visualScale && tile.vc?.length === (hexasphere.visualScale + 1) ** 2
    ? hexasphere.visualScale
    : 1;

const FALLBACK_TERRAIN_COLORS: Record<number, number> = {
  0: 0x3f9ed9,
  1: 0x3cc164,
  2: 0xe7cd89,
  3: 0xe8f6f8,
};

export interface GlobeSurface {
  /** Every navigable sector merged into one indexed geometry. */
  geometry: BufferGeometry;
  /** Vertex [start, count] pairs per sector id, for recoloring a single tile. */
  vertexRanges: Int32Array;
}

/** Evenly spaced points along one sector edge, as flat xyz triples. */
const interpolateEdge = (
  from: GlobalPoint,
  to: GlobalPoint,
  stride: number,
  scale: number,
) => {
  const points = new Float64Array(stride * 3);
  for (let step = 0; step < stride; step++) {
    const amount = step / scale;
    points[step * 3] = Number(from.x) + (Number(to.x) - Number(from.x)) * amount;
    points[step * 3 + 1] = Number(from.y) + (Number(to.y) - Number(from.y)) * amount;
    points[step * 3 + 2] = Number(from.z) + (Number(to.z) - Number(from.z)) * amount;
  }
  return points;
};

/**
 * One indexed geometry for the whole navigable globe, subdivided and colored at
 * each sector's climate-field vertices. Three.js interpolates those colors
 * across the triangles, producing gradual coast and biome transitions.
 *
 * Merging matters: a mesh per sector meant ~1,950 draw calls every frame, which
 * is what made the map crawl on mobile. Sector identity survives as the
 * vertexRanges lookup, and picking is arithmetic (see pickGlobeSector) rather
 * than a raycast, so nothing needs the tiles to stay separate objects.
 */
export const buildGlobeSurface = (
  hexasphere: GlobalMapData,
  sectorTint?: (sector: number) => Color | null,
): GlobeSurface => {
  const tiles = hexasphere.tiles;
  const radius = hexasphere.radius / 3;

  // Size the buffers up front: a sector contributes (scale + 1)^2 vertices and
  // scale^2 quads, and sectors without a proper quad boundary contribute none.
  const scales = new Int32Array(tiles.length);
  let vertexTotal = 0;
  let indexTotal = 0;
  for (let sector = 0; sector < tiles.length; sector++) {
    const tile = tiles[sector];
    if (!tile || tile.b.length !== 4) continue;
    const scale = sectorVisualScale(hexasphere, tile);
    scales[sector] = scale;
    vertexTotal += (scale + 1) ** 2;
    indexTotal += scale * scale * 6;
  }

  const positions = new Float32Array(vertexTotal * 3);
  const colors = new Float32Array(vertexTotal * 3);
  const indices = new Uint32Array(indexTotal);
  const vertexRanges = new Int32Array(tiles.length * 2).fill(-1);
  let vertexCursor = 0;
  let indexCursor = 0;

  for (let sector = 0; sector < tiles.length; sector++) {
    const scale = scales[sector];
    const tile = tiles[sector];
    if (!scale || !tile) continue;
    const [nw, ne, se, sw] = tile.b as [
      GlobalPoint,
      GlobalPoint,
      GlobalPoint,
      GlobalPoint,
    ];
    const stride = scale + 1;
    const base = vertexCursor;
    const tint = sectorTint?.(sector) ?? null;

    // Bilinear interpolation over the quad, evaluated as a north edge and a
    // south edge that the row loop then blends between.
    const north = interpolateEdge(nw, ne, stride, scale);
    const south = interpolateEdge(sw, se, stride, scale);

    for (let y = 0; y < stride; y++) {
      const v = y / scale;
      for (let x = 0; x < stride; x++) {
        // Blended point pushed back onto the sphere, so the surface stays
        // curved rather than faceted.
        const edge = x * 3;
        const nx = north[edge] ?? 0;
        const ny = north[edge + 1] ?? 0;
        const nz = north[edge + 2] ?? 0;
        const px = nx + ((south[edge] ?? 0) - nx) * v;
        const py = ny + ((south[edge + 1] ?? 0) - ny) * v;
        const pz = nz + ((south[edge + 2] ?? 0) - nz) * v;
        const length = Math.hypot(px, py, pz) || 1;
        const offset = (base + y * stride + x) * 3;
        positions[offset] = (px / length) * radius;
        positions[offset + 1] = (py / length) * radius;
        positions[offset + 2] = (pz / length) * radius;

        const packed =
          tile.vc?.[y * stride + x] ?? FALLBACK_TERRAIN_COLORS[tile.t] ?? 0x3cc164;
        const red = ((packed >> 16) & 0xff) / 255;
        const green = ((packed >> 8) & 0xff) / 255;
        const blue = (packed & 0xff) / 255;
        colors[offset] = tint ? red * tint.r : red;
        colors[offset + 1] = tint ? green * tint.g : green;
        colors[offset + 2] = tint ? blue * tint.b : blue;
      }
    }

    for (let y = 0; y < scale; y++) {
      for (let x = 0; x < scale; x++) {
        const topLeft = base + y * stride + x;
        const topRight = topLeft + 1;
        const bottomLeft = topLeft + stride;
        const bottomRight = bottomLeft + 1;
        indices[indexCursor++] = topLeft;
        indices[indexCursor++] = topRight;
        indices[indexCursor++] = bottomRight;
        indices[indexCursor++] = topLeft;
        indices[indexCursor++] = bottomRight;
        indices[indexCursor++] = bottomLeft;
      }
    }

    vertexRanges[sector * 2] = base;
    vertexRanges[sector * 2 + 1] = stride * stride;
    vertexCursor += stride * stride;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  return { geometry, vertexRanges };
};

// Reused across picks so hover testing allocates nothing per frame.
const pickSphere = new Sphere(new Vector3(0, 0, 0), 1);
const pickPoint = new Vector3();

/**
 * Sector under a ray, or null off the globe and over the non-navigable polar
 * caps. The sector grid is a uniform longitude/latitude layout, so the surface
 * hit resolves arithmetically - no per-triangle raycast, and no dependency on
 * how the terrain happens to be split into meshes.
 */
export const pickGlobeSector = (
  raycaster: Raycaster,
  hexasphere: GlobalMapData,
): number | null => {
  pickSphere.radius = hexasphere.radius / 3;
  if (!raycaster.ray.intersectSphere(pickSphere, pickPoint)) return null;
  const length = pickPoint.length() || 1;
  const latitude = (Math.asin(pickPoint.y / length) * 180) / Math.PI;
  const longitude = (Math.atan2(pickPoint.z, pickPoint.x) * 180) / Math.PI;
  const sector = sectorAtGeographic(latitude, longitude);
  return sector < 0 || sector >= hexasphere.tiles.length ? null : sector;
};

/**
 * Sample the deterministic climate field baked for the non-navigable polar
 * caps. This is used to color a continuous sphere underlay: the underlay hides
 * far-side objects, while its exposed poles show terrain without sector edges.
 */
export const samplePolarCapColor = (
  hexasphere: GlobalMapData,
  point: Point3,
): Point3 | null => {
  const rows = hexasphere.polarCapRows;
  const columns = hexasphere.polarCapColumns;
  const latitudeLimit = hexasphere.latitudeLimit;
  const packedCaps = hexasphere.polarCapColors;
  if (!rows || !columns || latitudeLimit === undefined || !packedCaps) return null;
  const expectedLength = (rows + 1) * (columns + 1);
  if (
    packedCaps.north.length !== expectedLength ||
    packedCaps.south.length !== expectedLength
  ) {
    return null;
  }

  const length = Math.hypot(point.x, point.y, point.z) || 1;
  const latitude = (Math.asin(point.y / length) * 180) / Math.PI;
  const absoluteLatitude = Math.abs(latitude);
  if (absoluteLatitude < latitudeLimit) return null;

  const packed = latitude >= 0 ? packedCaps.north : packedCaps.south;
  const ring = Math.min(
    rows,
    ((absoluteLatitude - latitudeLimit) / (90 - latitudeLimit)) * rows,
  );
  const longitude = Math.atan2(point.z, point.x);
  const column = ((longitude + Math.PI) / (Math.PI * 2)) * columns;
  const ring0 = Math.floor(ring);
  const ring1 = Math.min(rows, ring0 + 1);
  const column0 = Math.min(columns, Math.floor(column));
  const column1 = column0 === columns ? columns : column0 + 1;
  const ringMix = ring - ring0;
  const columnMix = column - column0;
  const stride = columns + 1;
  const unpack = (value: number): Point3 => ({
    x: ((value >> 16) & 0xff) / 255,
    y: ((value >> 8) & 0xff) / 255,
    z: (value & 0xff) / 255,
  });
  const mix = (a: Point3, b: Point3, amount: number): Point3 => ({
    x: a.x + (b.x - a.x) * amount,
    y: a.y + (b.y - a.y) * amount,
    z: a.z + (b.z - a.z) * amount,
  });
  const at = (sampleRing: number, sampleColumn: number) => {
    return unpack(packed[sampleRing * stride + sampleColumn] ?? 0xe8f6f8);
  };
  const upper = mix(at(ring0, column0), at(ring0, column1), columnMix);
  const lower = mix(at(ring1, column0), at(ring1, column1), columnMix);
  return mix(upper, lower, ringMix);
};
