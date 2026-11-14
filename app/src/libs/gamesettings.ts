import * as Sentry from "@sentry/nextjs";
import { TRPCError } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";
import { nanoid } from "nanoid";
import {
  DMG_SETTING_DEFAULTS,
  DMG_SETTING_NAMES,
  type DmgSettingName,
  PET_ART_PROVIDER_SETTING,
  PetArtProviders,
} from "@/drizzle/constants";
import type { GameSetting } from "@/drizzle/schema";
import type { DmgConfig } from "@/libs/combat/constants";
import {
  findGameSettingByName,
  insertGameSettings,
  invalidateGameSettings,
  selectGameSettingForFetchDmgConfig,
  updateGameSettingForUpdate,
  updateGameSettingForUpdateGameSetting,
} from "@/queries/gamesettings";
import type { DrizzleClient } from "@/server/db";
import { addDays, getTimeLeftStr, isDifferentDay, periodStart } from "@/utils/time";

/**
 * Retrieves the game setting for the specified timer name.
 * If the setting does not exist, it creates a new one with default values.
 * @param client - The DrizzleClient instance used for querying the database.
 * @param name - The name of the timer.
 * @returns The game setting for the specified timer name.
 */
export const getGameSetting = async (client: DrizzleClient, name: string) => {
  let setting = await findGameSettingByName(client, name);
  if (!setting) {
    setting = { id: nanoid(), name: name, time: addDays(new Date(), -30), value: 0 };
    await insertGameSettings(client, [setting]);
  }
  return setting;
};

/**
 * Updates the value of a game setting in the database.
 *
 * @param settingName - The name of the setting to update.
 * @param value - The new value for the setting.
 * @param time - The timestamp for the setting.
 * @returns - A promise that resolves when the update is complete.
 */
export const updateGameSetting = async (
  client: DrizzleClient,
  settingName: string,
  value: number,
  time: Date,
) => {
  const setting = await getGameSetting(client, settingName);
  await updateGameSettingForUpdateGameSetting(client, value, time, setting);
  await invalidateGameSettings();
};

/**
 * Claim a named timer using the timestamp read for eligibility. Only the winner
 * may perform work or change the marker afterwards; a failed older run must not
 * release a claim taken in a later period.
 */
const claimGameTimer = async (
  client: DrizzleClient,
  name: string,
  isEligible: (previous: Date, now: Date) => boolean,
) => {
  const timer = await getGameSetting(client, name);
  const now = new Date();
  const claim = isEligible(timer.time, now)
    ? await updateGameSettingForUpdate(client, 0, now, timer, timer.time)
    : undefined;
  const isClaimed = claim?.rowsAffected === 1;
  let ownsClaim = isClaimed;

  // Completion values, resume markers and rollback all relinquish this claim.
  const update = async (value: number, time: Date) => {
    if (!ownsClaim) return false;
    const result = await updateGameSettingForUpdate(client, value, time, timer, now);
    ownsClaim = false;
    return result.rowsAffected === 1;
  };

  return {
    isClaimed,
    prevTime: timer.time,
    prevValue: timer.value,
    update,
    release: () => update(0, timer.time),
  };
};

/** Share of a rolling duration that must pass, so a scheduler firing early still claims it. */
const ROLLING_TIMER_TOLERANCE = 0.9999;

/** Atomically claim a rolling duration, retaining the persisted timer name. */
export const lockWithGameTimer = async (
  client: DrizzleClient,
  timerName: string,
  durationMs: number,
) => {
  const deltaTime = durationMs * ROLLING_TIMER_TOLERANCE;
  const claim = await claimGameTimer(
    client,
    timerName,
    (previous, now) => previous.getTime() <= now.getTime() - deltaTime,
  );
  if (claim.isClaimed) return false;
  return gameTimerWaitResponse(claim.prevTime, deltaTime);
};

/**
 * Atomically claim once per UTC calendar hour, so a minute-0 cron that fires slightly early
 * still gets its tick.
 */
export const lockWithHourlyTimer = async (client: DrizzleClient, name: string) => {
  const claim = await claimGameTimer(
    client,
    name,
    (previous, now) =>
      isDifferentDay(now, previous) || now.getUTCHours() !== previous.getUTCHours(),
  );
  return {
    ...claim,
    isNewHour: claim.isClaimed,
    response: periodWaitResponse(claim.isClaimed, "hour"),
  };
};

/** Atomically claim once per UTC calendar minute. */
export const lockWithMinuteTimer = async (client: DrizzleClient, name: string) => {
  const claim = await claimGameTimer(
    client,
    name,
    (previous, now) =>
      isDifferentDay(now, previous) ||
      now.getUTCHours() !== previous.getUTCHours() ||
      now.getUTCMinutes() !== previous.getUTCMinutes(),
  );
  return {
    ...claim,
    isNewMinute: claim.isClaimed,
    response: periodWaitResponse(claim.isClaimed, "minute"),
  };
};

/** Atomically claim once per UTC calendar day. */
export const lockWithDailyTimer = async (client: DrizzleClient, name: string) => {
  const claim = await claimGameTimer(client, name, startedSince("daily"));
  return {
    ...claim,
    isNewDay: claim.isClaimed,
    response: periodWaitResponse(claim.isClaimed, "day"),
  };
};

/** Atomically claim once per UTC calendar week, starting on Monday. */
export const lockWithWeeklyTimer = async (client: DrizzleClient, name: string) => {
  const claim = await claimGameTimer(client, name, startedSince("weekly"));
  return {
    ...claim,
    isNewWeek: claim.isClaimed,
    response: periodWaitResponse(claim.isClaimed, "week"),
  };
};

/** Atomically claim once per UTC calendar month. */
export const lockWithMonthlyTimer = async (client: DrizzleClient, name: string) => {
  const claim = await claimGameTimer(client, name, startedSince("monthly"));
  return {
    ...claim,
    isNewMonth: claim.isClaimed,
    response: periodWaitResponse(claim.isClaimed, "month"),
  };
};

/** A period lock's response: nothing for the winner, the wait message for everyone else. */
const periodWaitResponse = (isClaimed: boolean, period: string) =>
  Response.json(isClaimed ? null : `Wait until the next ${period} to run this again`);

/** Whether a new UTC calendar period began after the timer's last claim. */
const startedSince =
  (period: "daily" | "weekly" | "monthly") => (previous: Date, now: Date) =>
    periodStart(period, now) > previous;

/**
 * Run a cron's work under a period claim: answer with the wait response when another run
 * holds it, and hand the period back on failure so the next invocation retries.
 */
export const runClaimedCron = async (
  claim: {
    isClaimed: boolean;
    response: Response;
    release: () => Promise<boolean>;
  },
  endpoint: string,
  work: () => Promise<Response>,
) => {
  if (!claim.isClaimed) return claim.response;
  try {
    return await work();
  } catch (cause) {
    try {
      await claim.release();
    } catch (rollbackCause) {
      console.error(`Failed to release the ${endpoint} timer`, rollbackCause);
    }
    return handleEndpointError(cause, { endpoint });
  }
};

/** Describe the remaining claimed timer window without issuing another database query. */
const gameTimerWaitResponse = (previous: Date, durationMs: number) => {
  const remaining = previous.getTime() + durationMs - Date.now();
  if (remaining <= 0) return Response.json("Timer already claimed; try again later");
  return Response.json(`Wait ${getTimeLeftStr(remaining)} before running again`);
};

/**
 * Select the companion art provider from loaded settings. Its persistent index ignores
 * boost expiration; an absent or unknown value selects GPT.
 */
export const getPetArtProvider = (settings: Pick<GameSetting, "name" | "value">[]) => {
  const setting = settings.find((entry) => entry.name === PET_ART_PROVIDER_SETTING);
  return PetArtProviders[setting?.value ?? 0] ?? "GPT";
};

/**
 * Fetches the DMG config from the gameSetting table.
 * If any settings are missing, inserts them with their default values.
 * Returns a DmgConfig object ready for use in combat calculations.
 */
export const fetchDmgConfig = async (client: DrizzleClient): Promise<DmgConfig> => {
  const settings = await selectGameSettingForFetchDmgConfig(client);

  // Find which settings are missing and insert them with defaults
  const existingNames = new Set(settings.map((s) => s.name));
  const missing = DMG_SETTING_NAMES.filter((n) => !existingNames.has(n));
  if (missing.length > 0) {
    const newSettings = missing.map((name) => ({
      id: nanoid(),
      name,
      time: addDays(new Date(), -30),
      value: DMG_SETTING_DEFAULTS[name],
    }));
    await insertGameSettings(client, newSettings);
    settings.push(...newSettings);
  }

  // Missing settings were inserted above, so every name resolves to a row
  const get = (name: DmgSettingName) =>
    settings.find((s) => s.name === name)?.value ?? 0;

  return Object.fromEntries(
    dmgConfigSettings().map(([key, name]) => [key, get(name)]),
  ) as DmgConfig;
};

/** Saves every DMG config value to its gameSetting row. */
export const updateDmgConfig = (client: DrizzleClient, config: DmgConfig) =>
  Promise.all(
    dmgConfigSettings().map(([key, name]) =>
      updateGameSetting(client, name, config[key], new Date()),
    ),
  );

/** GameSetting row behind each DmgConfig field. */
const DMG_CONFIG_SETTINGS: Record<keyof DmgConfig, DmgSettingName> = {
  stats_scaling: "DMG_STATS_SCALING",
  base_hits: "DMG_BASE_HITS",
  curve: "DMG_CURVE",
  amplitude: "DMG_AMPLITUDE",
  ep_normalization: "DMG_EP_NORMALIZATION",
  gen_weight: "DMG_GEN_WEIGHT",
  advantage_min: "DMG_ADVANTAGE_MIN",
  advantage_max: "DMG_ADVANTAGE_MAX",
};

/** Keep config keys typed when enumerating their persisted setting names. */
const dmgConfigSettings = () =>
  Object.entries(DMG_CONFIG_SETTINGS) as [keyof DmgConfig, DmgSettingName][];

/**
 * Handles errors that occur during endpoint processing.
 * Logs the error to the console, captures it to Sentry, and returns an appropriate HTTP response.
 *
 * @param cause - The error that occurred. This can be of any type.
 * @param context - Optional context for the error (e.g., endpoint name).
 * @returns A JSON response with the error details and the appropriate HTTP status code.
 *          If the error is an instance of TRPCError, the response will contain the error details
 *          and the corresponding HTTP status code. Otherwise, it returns a generic "Internal server error"
 *          message with a 500 status code.
 */
export const handleEndpointError = async (
  cause: unknown,
  context?: { endpoint?: string },
) => {
  console.error(cause);

  // Capture to Sentry
  Sentry.captureException(cause, {
    extra: { endpoint: context?.endpoint },
    tags: { type: "api_route_error" },
  });

  // Flush for serverless - critical for Vercel Lambda environments
  try {
    await Sentry.flush(5000);
  } catch (e) {
    console.error("[handleEndpointError] Sentry flush failed:", e);
  }

  if (cause instanceof TRPCError) {
    // An error from tRPC occured
    const httpCode = getHTTPStatusCodeFromError(cause);
    return Response.json(cause, { status: httpCode });
  }
  // Another error occured
  return Response.json("Internal server error", { status: 500 });
};
