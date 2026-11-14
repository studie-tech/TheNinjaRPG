/**
 * Database access for gamesettings; authorization and transaction scopes stay in callers.
 */
import { and, eq, inArray, lt } from "drizzle-orm";
import { DMG_SETTING_NAMES } from "@/drizzle/constants";
import { gameSetting } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { createRuntimeCache } from "@/server/utils/runtimeCache";

// The listing feeds global and war boosts and staff toggles. Boost expiry is compared
// with the current time on every read; boost and toggle writes invalidate the cache, and
// the TTL bounds rows that timers and war rules write without it. Timers, damage config
// and war rules read their own rows directly.
const gameSettings = createRuntimeCache({
  name: "game-settings",
  ttlSeconds: 30,
  load: (client: Pick<DrizzleClient, "select">) => client.select().from(gameSetting),
});

/** Every game setting row, from the Runtime Cache. */
export const listCachedGameSettings = gameSettings.read;

/** Make every instance list game settings again; await after boost or toggle writes. */
export const invalidateGameSettings = gameSettings.invalidate;

/** Build the `gameSetting` update for `decayClansAndAnbu`, setting `time`, using predicates on `id` and `time`. */
export const updateGameSettingForDecayClansAndAnbu = (
  client: Pick<DrizzleClient, "update">,
  dayStart: Date,
  marker: { id: string },
) =>
  client
    .update(gameSetting)
    .set({ time: dayStart })
    .where(and(eq(gameSetting.id, marker.id), lt(gameSetting.time, dayStart)));

/** Build a game setting lookup by name. */
export const findGameSettingByName = (
  client: Pick<DrizzleClient, "query">,
  name: string,
) =>
  client.query.gameSetting.findFirst({
    where: eq(gameSetting.name, name),
  });

/** Build the `gameSetting` update for `updateGameSetting`, setting `value` and `time`, using predicates on `name`. */
export const updateGameSettingForUpdateGameSetting = (
  client: Pick<DrizzleClient, "update">,
  value: number,
  time: Date,
  setting: { name: string },
) =>
  client
    .update(gameSetting)
    .set({ value, time })
    .where(eq(gameSetting.name, setting.name));

/** Build a game-setting value/time update guarded by its ID and expected timestamp. */
export const updateGameSettingForUpdate = (
  client: Pick<DrizzleClient, "update">,
  value: number,
  time: Date,
  timer: { id: string },
  now: Date,
) =>
  client
    .update(gameSetting)
    .set({ value, time })
    .where(and(eq(gameSetting.id, timer.id), eq(gameSetting.time, now)));

/** Build the `gameSetting` selection for `fetchDmgConfig`, using predicates on `name`. */
export const selectGameSettingForFetchDmgConfig = (
  client: Pick<DrizzleClient, "select">,
) =>
  client.select().from(gameSetting).where(inArray(gameSetting.name, DMG_SETTING_NAMES));

/** Build insertion of game setting rows. */
export const insertGameSettings = (
  client: Pick<DrizzleClient, "insert">,
  settings: import("@/drizzle/schema").GameSetting[],
) => client.insert(gameSetting).values(settings);
