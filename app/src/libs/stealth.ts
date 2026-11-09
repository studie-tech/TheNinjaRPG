import {
  getTerritoryWarPeriodBoost,
  type TerritoryBoostUser,
} from "@/libs/territoryWar";
/**
 * Stealth and Sensory System
 *
 * This module provides utility functions for the stealth and sensory mechanics.
 *
 * Stealth: Players can go undetected in enemy territory to perform actions like
 * healing, scouting, or attacking. Actions may break stealth based on the
 * player's stealth stat.
 *
 * Sensory: Players can detect stealthed enemies with a chance based on their
 * sensory stat.
 */

import {
  SENSORY_BASE_COOLDOWN_SECONDS,
  SENSORY_BASE_DETECT_CHANCE_PERC,
  SENSORY_COOLDOWN_REDUCTION_PER_1000_POINTS,
  SENSORY_DETECT_CHANCE_PER_1000_POINTS,
  SENSORY_MAX_DETECT_CHANCE_PERC,
  SENSORY_MIN_COOLDOWN_SECONDS,
  STEALTH_BASE_DURATION_SECONDS,
  STEALTH_BASE_KEEP_CHANCE_PERC,
  STEALTH_DURATION_PER_1000_POINTS,
  STEALTH_KEEP_CHANCE_PER_1000_POINTS,
  STEALTH_MAX_DURATION_SECONDS,
  STEALTH_SENSORY_CAP,
  STEALTH_SENSORY_DEFAULT,
} from "@/drizzle/constants";
import { boostPvpGain } from "@/libs/pvpExperience";

/**
 * Calculate the maximum stealth duration in seconds based on stealth stat:
 * STEALTH_BASE_DURATION_SECONDS plus STEALTH_DURATION_PER_1000_POINTS per 1000 points
 * above STEALTH_SENSORY_DEFAULT, capped at STEALTH_MAX_DURATION_SECONDS
 */
export const calcStealthDuration = (stealthStat: number): number => {
  const duration =
    STEALTH_BASE_DURATION_SECONDS +
    intervalsAboveDefault(stealthStat) * STEALTH_DURATION_PER_1000_POINTS;
  return Math.min(duration, STEALTH_MAX_DURATION_SECONDS);
};

/**
 * Calculate the chance to maintain stealth when performing an action:
 * STEALTH_BASE_KEEP_CHANCE_PERC plus STEALTH_KEEP_CHANCE_PER_1000_POINTS per 1000 points
 * above STEALTH_SENSORY_DEFAULT
 * Returns a percentage (0-100)
 */
export const calcStealthKeepChance = (stealthStat: number): number =>
  STEALTH_BASE_KEEP_CHANCE_PERC +
  intervalsAboveDefault(stealthStat) * STEALTH_KEEP_CHANCE_PER_1000_POINTS;

/**
 * Calculate the chance to detect a stealthed player:
 * SENSORY_BASE_DETECT_CHANCE_PERC plus SENSORY_DETECT_CHANCE_PER_1000_POINTS per 1000
 * points above STEALTH_SENSORY_DEFAULT, capped at SENSORY_MAX_DETECT_CHANCE_PERC
 * Returns a percentage (0-100)
 */
export const calcSensoryDetectChance = (sensoryStat: number): number => {
  const chance =
    SENSORY_BASE_DETECT_CHANCE_PERC +
    intervalsAboveDefault(sensoryStat) * SENSORY_DETECT_CHANCE_PER_1000_POINTS;
  return Math.min(chance, SENSORY_MAX_DETECT_CHANCE_PERC);
};

/**
 * Calculate the cooldown between sensory uses in seconds:
 * SENSORY_BASE_COOLDOWN_SECONDS minus SENSORY_COOLDOWN_REDUCTION_PER_1000_POINTS per 1000
 * points above STEALTH_SENSORY_DEFAULT, never below SENSORY_MIN_COOLDOWN_SECONDS
 */
export const calcSensoryCooldown = (sensoryStat: number): number => {
  const cooldown =
    SENSORY_BASE_COOLDOWN_SECONDS -
    intervalsAboveDefault(sensoryStat) * SENSORY_COOLDOWN_REDUCTION_PER_1000_POINTS;
  return Math.max(cooldown, SENSORY_MIN_COOLDOWN_SECONDS);
};

/**
 * Check if stealth has expired based on activation time and stat
 * @param timeDiff - Optional time difference between server and client clocks
 */
export const isStealthExpired = (
  stealthActivatedAt: Date | null,
  stealthStat: number,
  timeDiff: number = 0,
): boolean =>
  getRemainingStealthDuration(stealthActivatedAt, stealthStat, timeDiff) === 0;

/**
 * Roll to determine if stealth should be broken when performing an action
 * Returns true if stealth is maintained, false if broken
 */
export const rollStealthKeep = (stealthStat: number): boolean => {
  const keepChance = calcStealthKeepChance(stealthStat);
  const roll = Math.random() * 100;
  return roll < keepChance;
};

/**
 * Roll to determine if a stealthed player is detected by sensory
 * Returns true if detected, false if not
 */
export const rollSensoryDetection = (sensoryStat: number): boolean => {
  const detectChance = calcSensoryDetectChance(sensoryStat);
  const roll = Math.random() * 100;
  return roll < detectChance;
};

/**
 * Check if sensory is off cooldown
 * @param timeDiff - Optional time difference between server and client clocks
 */
export const isSensoryReady = (
  lastSensoryAt: Date | null,
  sensoryStat: number,
  timeDiff: number = 0,
): boolean => getRemainingSensoryCooldown(lastSensoryAt, sensoryStat, timeDiff) === 0;

/**
 * Check if stealth cooldown has expired (after combat)
 * @param timeDiff - Optional time difference between server and client clocks
 */
export const isStealthCooldownExpired = (
  stealthCooldownAt: Date | null,
  timeDiff: number = 0,
): boolean => getRemainingStealthCooldown(stealthCooldownAt, timeDiff) === 0;

/**
 * Get remaining stealth duration in seconds
 * @param timeDiff - Optional time difference between server and client clocks
 */
export const getRemainingStealthDuration = (
  stealthActivatedAt: Date | null,
  stealthStat: number,
  timeDiff: number = 0,
): number => {
  if (!stealthActivatedAt) return 0;

  const maxDuration = calcStealthDuration(stealthStat);
  const syncedNow = Date.now() - timeDiff;
  const elapsedSeconds = (syncedNow - stealthActivatedAt.getTime()) / 1000;
  const remaining = maxDuration - elapsedSeconds;

  return Math.max(remaining, 0);
};

/**
 * Get remaining sensory cooldown in seconds
 * @param timeDiff - Optional time difference between server and client clocks
 */
export const getRemainingSensoryCooldown = (
  lastSensoryAt: Date | null,
  sensoryStat: number,
  timeDiff: number = 0,
): number => {
  if (!lastSensoryAt) return 0;

  const cooldown = calcSensoryCooldown(sensoryStat);
  const syncedNow = Date.now() - timeDiff;
  const elapsedSeconds = (syncedNow - lastSensoryAt.getTime()) / 1000;
  const remaining = cooldown - elapsedSeconds;

  return Math.max(remaining, 0);
};

/**
 * Get remaining stealth cooldown in seconds (after combat)
 * @param timeDiff - Optional time difference between server and client clocks
 */
export const getRemainingStealthCooldown = (
  stealthCooldownAt: Date | null,
  timeDiff: number = 0,
): number => {
  if (!stealthCooldownAt) return 0;

  const syncedNow = Date.now() - timeDiff;
  const remaining = (stealthCooldownAt.getTime() - syncedNow) / 1000;
  return Math.max(remaining, 0);
};

/**
 * Check if a user is currently stealthed (active and not expired)
 * Convenience function that combines stealthActive check with expiration check
 * @param timeDiff - Optional time difference between server and client clocks
 */
export const isUserCurrentlyStealthed = (
  user: {
    stealthActive: boolean;
    stealthActivatedAt: Date | null;
    stealth: number;
  },
  timeDiff: number = 0,
): boolean => {
  return (
    user.stealthActive &&
    user.stealthActivatedAt !== null &&
    !isStealthExpired(user.stealthActivatedAt, user.stealth, timeDiff)
  );
};

/**
 * Calculate covert training finish time
 */
export const calcCovertTrainingFinishAt = (
  covertTrainingStartedAt: Date | null,
  covertTrainingMinutes: number | null,
): Date | null => {
  if (!covertTrainingStartedAt || covertTrainingMinutes == null) return null;
  return new Date(
    covertTrainingStartedAt.getTime() + covertTrainingMinutes * 60 * 1000,
  );
};

/**
 * Calculate covert training gains, applying bonuses before the stat cap.
 * `territoryBoost` is the session's average bonus fraction; `pvpBoostPercent` is percent.
 */
export const calcCovertTrainingGain = (
  minutes: number,
  currentStat: number,
  cap: number,
  gainPerMinute: number,
  pvpBoostPercent: number = 0,
  territoryBoost = 0,
): number => {
  const rawGain = boostPvpGain(
    minutes * gainPerMinute * (1 + territoryBoost),
    pvpBoostPercent,
  );
  return Math.max(0, Math.min(rawGain, cap - currentStat));
};

/**
 * Derive all stealth status values from user data.
 * This is a pure function that computes all stealth-related UI values.
 * Covert gains average preloaded bonus windows across the actual training interval.
 * @param timeDiff - Client minus server clock offset in milliseconds.
 */
export const getStealthStatus = (
  userData: TerritoryBoostUser & {
    stealth: number;
    sensory: number;
    stealthActive: boolean;
    stealthActivatedAt: Date | null;
    stealthCooldownAt: Date | null;
    lastSensoryAt: Date | null;
    covertTrainingType: "stealth" | "sensory" | null;
    covertTrainingStartedAt: Date | null;
    covertTrainingMinutes: number | null;
    pvpBoost?: { totalPercent: number };
  },
  cap: number,
  gainPerMinute: number,
  timeDiff: number = 0,
) => {
  const covertTrainingFinishAt = calcCovertTrainingFinishAt(
    userData.covertTrainingStartedAt,
    userData.covertTrainingMinutes,
  );

  const covertTrainingGain =
    userData.covertTrainingMinutes != null
      ? calcCovertTrainingGain(
          userData.covertTrainingMinutes,
          userData.covertTrainingType === "stealth"
            ? userData.stealth
            : userData.sensory,
          cap,
          gainPerMinute,
          userData.pvpBoost?.totalPercent ?? 0,
          userData.covertTrainingStartedAt && covertTrainingFinishAt
            ? getTerritoryWarPeriodBoost(
                userData,
                userData.covertTrainingStartedAt,
                covertTrainingFinishAt,
              )
            : 0,
        )
      : null;

  return {
    stealth: userData.stealth,
    sensory: userData.sensory,
    stealthActive: userData.stealthActive,
    isCurrentlyStealthed: isUserCurrentlyStealthed(userData, timeDiff),
    stealthDurationMax: calcStealthDuration(userData.stealth),
    stealthDurationRemaining: getRemainingStealthDuration(
      userData.stealthActivatedAt,
      userData.stealth,
      timeDiff,
    ),
    stealthKeepChance: calcStealthKeepChance(userData.stealth),
    stealthCooldownRemaining: getRemainingStealthCooldown(
      userData.stealthCooldownAt,
      timeDiff,
    ),
    sensoryDetectChance: calcSensoryDetectChance(userData.sensory),
    sensoryCooldown: calcSensoryCooldown(userData.sensory),
    sensoryCooldownRemaining: getRemainingSensoryCooldown(
      userData.lastSensoryAt,
      userData.sensory,
      timeDiff,
    ),
    covertTrainingType: userData.covertTrainingType,
    covertTrainingFinishAt,
    covertTrainingGain,
  };
};

/** Whole 1000-point steps of a capped stat above STEALTH_SENSORY_DEFAULT. */
const intervalsAboveDefault = (stat: number) =>
  Math.max(
    0,
    Math.floor((Math.min(stat, STEALTH_SENSORY_CAP) - STEALTH_SENSORY_DEFAULT) / 1000),
  );
