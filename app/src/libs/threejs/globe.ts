import fetchRetry from "fetch-retry";
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
import {
  IMG_AVATAR_DEFAULT,
  IMG_MAP_HEXASPHERE,
  IMG_SECTOR_USER_SPRITE_MASK,
} from "@/drizzle/constants";
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from "@/hooks/localstorage";
import type { GlobalMapData, GlobalPoint } from "@/libs/threejs/types";
import { createBorderTexture, loadTexture } from "@/libs/threejs/util";

const MAP_CACHE_KEY = "hexasphere_map_cache";
const MAP_CACHE_VERSION = "v1"; // Increment to invalidate cache when map data changes

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

  // Fetch from server
  const fetch = fetchRetry(global.fetch);
  const response = await fetch(IMG_MAP_HEXASPHERE, {
    retries: 3,
    retryDelay: (attempt) => {
      return 2 ** attempt * 1000; // 1000, 2000, 4000
    },
  });
  // Clone response before reading body to prevent "body stream already read" errors.
  // fetch-retry may consume the original response body during retry logic (THENINJARPG-2GY).
  // response.clone() creates an independent body stream we can safely read.
  const hexasphere = await response
    .clone()
    .json()
    .then((data) => data as GlobalMapData);

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
    depthWrite: false,
    depthTest: false,
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
    depthWrite: false,
    depthTest: false,
  });
  const avatarSprite = new Sprite(avatarMaterial);
  avatarSprite.scale.set(1, 1, 1);
  avatarSprite.position.set(sector.x / d, sector.y / d, sector.z / d);
  group.add(avatarSprite);

  return group;
};
