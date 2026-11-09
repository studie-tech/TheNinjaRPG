import type { GlobalMapData } from "@/libs/sector-map/world-types";
import { fetchWithRetry } from "@/utils/http";
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from "@/utils/storage";

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
