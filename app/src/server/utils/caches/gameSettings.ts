import { selectGameSettings } from "@/queries/gamesettings";
import { createRuntimeCache } from "@/server/utils/caches/runtimeCache";

// The listing feeds global and war boosts and staff toggles. Boost expiry is compared
// with the current time on every read; boost and toggle writes invalidate the cache, and
// the TTL bounds rows that timers and war rules write without it. Timers, damage config
// and war rules read their own rows directly.
const gameSettings = createRuntimeCache({
  name: "game-settings",
  ttlSeconds: 30,
  load: selectGameSettings,
});

/** Every game setting row, from the Runtime Cache. */
export const fetchGameSettings = gameSettings.read;

/** Make every instance list game settings again; await after boost or toggle writes. */
export const invalidateGameSettings = gameSettings.invalidate;
