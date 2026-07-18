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
import atlasMeta from "@/data/globeAtlas.json";
import {
  IMG_AVATAR_DEFAULT,
  IMG_MAP_HEXASPHERE,
  IMG_SECTOR_USER_SPRITE_MASK,
} from "@/drizzle/constants";
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from "@/hooks/localstorage";
import type { GlobalMapData, GlobalPoint, GlobalTile } from "@/libs/threejs/types";
import { createBorderTexture, loadTexture } from "@/libs/threejs/util";
import { fetchWithRetry } from "@/utils/http";

const MAP_CACHE_KEY = "hexasphere_map_cache";
const MAP_CACHE_VERSION = "v9"; // Increment to invalidate cache when map data changes

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

  // Fetch from the CDN. Generous per-attempt timeout: the topology is ~700KB
  // and slow mobile connections must not be aborted mid-download.
  const response = await fetchWithRetry(IMG_MAP_HEXASPHERE, {}, 60_000, {
    maxRetries: 3,
    baseDelayMs: 1000,
    deadlineMs: 240_000,
  });
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

/**
 * Atlas layout for the globe tileset (from src/data/globeAtlas.json). Columns
 * encode the water mask of the four [N, E, S, W] neighbors as N + 2E + 4S + 8W;
 * rows are terrains plus a final water row. The atlas image is a one-time bake
 * of the Kenney Map Pack, hosted on UploadThing (IMG_MAP_TILESET_ATLAS).
 */
const ATLAS_COLS = atlasMeta.cols;
const ATLAS_ROWS = atlasMeta.rows;
/** Globe tile terrain type (t) to atlas terrain row */
const ATLAS_TERRAIN_ROW: Record<number, number> = {
  1: atlasMeta.terrainRows.grass,
  2: atlasMeta.terrainRows.sand,
  3: atlasMeta.terrainRows.ice,
};
const WATER_COLS = atlasMeta.waterCols;
const WATER_ROW = atlasMeta.rows - 1;
/** Inset (in UV units) so texture filtering never bleeds across atlas cells */
const ATLAS_INSET_X = 1.5 / (ATLAS_COLS * atlasMeta.size);
const ATLAS_INSET_Y = 1.5 / (ATLAS_ROWS * atlasMeta.size);

type Point3 = { x: number; y: number; z: number };
type UV = { u: number; v: number };

/** UVs for one atlas cell in [NW, NE, SE, SW] corner order (inset to avoid bleed) */
const atlasCellUVs = (col: number, row: number): [UV, UV, UV, UV] => {
  const u0 = col / ATLAS_COLS + ATLAS_INSET_X;
  const u1 = (col + 1) / ATLAS_COLS - ATLAS_INSET_X;
  const vTop = 1 - row / ATLAS_ROWS - ATLAS_INSET_Y;
  const vBottom = 1 - (row + 1) / ATLAS_ROWS + ATLAS_INSET_Y;
  return [
    { u: u0, v: vTop },
    { u: u1, v: vTop },
    { u: u1, v: vBottom },
    { u: u0, v: vBottom },
  ];
};

/**
 * Geometry (positions + uvs) for one globe tile: a flat quad at sea level
 * textured through the Kenney coastline atlas. Ocean picks a random water cell;
 * land and ice pick their atlas cell by their WATER-neighbour mask (N=1, E=2,
 * S=4, W=8), so every coast gets the atlas's rounded silhouette and the tile
 * grid stops reading as blocky. Corners come from the generator in canonical
 * [NW, NE, SE, SW] order, matching the atlas cell corners so the coastline
 * rounds toward the correct sides.
 */
export const buildGlobeTileGeometry = (
  hexasphere: GlobalMapData,
  tile: GlobalTile,
  rand: number,
): { positions: Float32Array; uvs: Float32Array } | null => {
  if (tile.b.length !== 4) return null;
  const positions: number[] = [];
  const uvs: number[] = [];
  const base = tile.b.map((p) => ({ x: p.x / 3, y: p.y / 3, z: p.z / 3 }));
  /** Append one textured triangle (positions + per-vertex atlas UVs) to the buffers */
  const pushTri = (p0: Point3, p1: Point3, p2: Point3, a: UV, b: UV, c: UV) => {
    positions.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
    uvs.push(a.u, a.v, b.u, b.v, c.u, c.v);
  };

  // Coastline autotile mask: a bit is set where the neighbour on that side is
  // open ocean, so land and ice round their silhouette against the sea.
  let coastMask = 0;
  for (let k = 0; k < 4; k++) {
    const nb = tile.n?.[k] ?? -1;
    if (nb < 0 || (hexasphere.tiles[nb]?.t ?? 0) === 0) coastMask += 1 << k;
  }

  const uv =
    tile.t === 0
      ? atlasCellUVs(WATER_COLS[Math.floor(rand * WATER_COLS.length)] ?? 0, WATER_ROW)
      : atlasCellUVs(coastMask, ATLAS_TERRAIN_ROW[tile.t] ?? ATLAS_TERRAIN_ROW[1]!);
  pushTri(base[0]!, base[1]!, base[2]!, uv[0], uv[1], uv[2]);
  pushTri(base[0]!, base[2]!, base[3]!, uv[0], uv[2], uv[3]);
  return { positions: new Float32Array(positions), uvs: new Float32Array(uvs) };
};
