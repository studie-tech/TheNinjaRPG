import {
  BufferGeometry,
  Group,
  LinearFilter,
  LineBasicMaterial,
  LineSegments,
  Sprite,
  SpriteMaterial,
  Vector3,
} from "three";
import { IMG_AVATAR_DEFAULT, IMG_SECTOR_USER_SPRITE_MASK } from "@/drizzle/constants";
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from "@/hooks/localstorage";
import type { GlobalMapData, GlobalPoint, GlobalTile } from "@/libs/threejs/types";
import { createBorderTexture, loadTexture } from "@/libs/threejs/util";
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
  const avatar = userData?.avatarLight || userData?.avatar || IMG_AVATAR_DEFAULT;
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

/**
 * Geometry for one logical sector, subdivided and colored at its climate-field
 * vertices. Three.js interpolates those colors across each triangle, producing
 * gradual coast and biome transitions without changing sector interaction.
 */
export const buildGlobeTileGeometry = (
  hexasphere: GlobalMapData,
  tile: GlobalTile,
): { positions: Float32Array; colors: Float32Array } | null => {
  if (tile.b.length !== 4) return null;
  const positions: number[] = [];
  const colors: number[] = [];
  const visualScale =
    hexasphere.visualScale && tile.vc?.length === (hexasphere.visualScale + 1) ** 2
      ? hexasphere.visualScale
      : 1;

  const fallbackColors: Record<number, number> = {
    0: 0x3f9ed9,
    1: 0x3cc164,
    2: 0xe7cd89,
    3: 0xe8f6f8,
  };
  const colorAt = (x: number, y: number): Point3 => {
    const packed =
      tile.vc?.[y * (visualScale + 1) + x] ?? fallbackColors[tile.t] ?? 0x3cc164;
    return {
      x: ((packed >> 16) & 0xff) / 255,
      y: ((packed >> 8) & 0xff) / 255,
      z: (packed & 0xff) / 255,
    };
  };

  /** Curved bilinear point for a subdivision corner on the globe surface. */
  const pointAt = (u: number, v: number): Point3 => {
    const [nw, ne, se, sw] = tile.b as [
      GlobalPoint,
      GlobalPoint,
      GlobalPoint,
      GlobalPoint,
    ];
    const top = {
      x: Number(nw.x) + (Number(ne.x) - Number(nw.x)) * u,
      y: Number(nw.y) + (Number(ne.y) - Number(nw.y)) * u,
      z: Number(nw.z) + (Number(ne.z) - Number(nw.z)) * u,
    };
    const bottom = {
      x: Number(sw.x) + (Number(se.x) - Number(sw.x)) * u,
      y: Number(sw.y) + (Number(se.y) - Number(sw.y)) * u,
      z: Number(sw.z) + (Number(se.z) - Number(sw.z)) * u,
    };
    const point = {
      x: top.x + (bottom.x - top.x) * v,
      y: top.y + (bottom.y - top.y) * v,
      z: top.z + (bottom.z - top.z) * v,
    };
    const length = Math.hypot(point.x, point.y, point.z) || 1;
    const radius = hexasphere.radius / 3;
    return {
      x: (point.x / length) * radius,
      y: (point.y / length) * radius,
      z: (point.z / length) * radius,
    };
  };
  const pushTri = (
    p0: Point3,
    p1: Point3,
    p2: Point3,
    c0: Point3,
    c1: Point3,
    c2: Point3,
  ) => {
    positions.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
    colors.push(c0.x, c0.y, c0.z, c1.x, c1.y, c1.z, c2.x, c2.y, c2.z);
  };

  for (let y = 0; y < visualScale; y++) {
    for (let x = 0; x < visualScale; x++) {
      const u0 = x / visualScale;
      const u1 = (x + 1) / visualScale;
      const v0 = y / visualScale;
      const v1 = (y + 1) / visualScale;
      const nw = pointAt(u0, v0);
      const ne = pointAt(u1, v0);
      const se = pointAt(u1, v1);
      const sw = pointAt(u0, v1);
      const nwColor = colorAt(x, y);
      const neColor = colorAt(x + 1, y);
      const seColor = colorAt(x + 1, y + 1);
      const swColor = colorAt(x, y + 1);
      pushTri(nw, ne, se, nwColor, neColor, seColor);
      pushTri(nw, se, sw, nwColor, seColor, swColor);
    }
  }
  return { positions: new Float32Array(positions), colors: new Float32Array(colors) };
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
