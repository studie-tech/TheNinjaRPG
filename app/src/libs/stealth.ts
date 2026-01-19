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
  STEALTH_BASE_DURATION_SECONDS,
  STEALTH_DURATION_PER_1000_POINTS,
  STEALTH_MAX_DURATION_SECONDS,
  STEALTH_BASE_KEEP_CHANCE_PERC,
  STEALTH_KEEP_CHANCE_PER_1000_POINTS,
  STEALTH_SENSORY_CAP,
  SENSORY_BASE_DETECT_CHANCE_PERC,
  SENSORY_DETECT_CHANCE_PER_1000_POINTS,
  SENSORY_MAX_DETECT_CHANCE_PERC,
  SENSORY_BASE_COOLDOWN_SECONDS,
  SENSORY_COOLDOWN_REDUCTION_PER_1000_POINTS,
} from "@/drizzle/constants";

/**
 * Calculate the maximum stealth duration in seconds based on stealth stat
 * Base: 60 seconds (1 min), +60 seconds per 1000 points above default (1000), capped at 1200 seconds (20 min)
 * At default stat (1000), players get only the base duration
 */
export const calcStealthDuration = (stealthStat: number): number => {
  const clampedStat = Math.min(stealthStat, STEALTH_SENSORY_CAP);
  // Calculate intervals above the default stat (1000)
  // At 1000 stat: intervals = 0, at 2000 stat: intervals = 1, etc.
  const intervals = Math.max(0, Math.floor((clampedStat - 1000) / 1000));
  const duration = STEALTH_BASE_DURATION_SECONDS + intervals * STEALTH_DURATION_PER_1000_POINTS;
  return Math.min(duration, STEALTH_MAX_DURATION_SECONDS);
};

/**
 * Calculate the chance to maintain stealth when performing an action
 * Base: 5%, +2.75% per 1000 points above default (1000)
 * At default stat (1000), players get only the base chance
 * Returns a percentage (0-100)
 */
export const calcStealthKeepChance = (stealthStat: number): number => {
  const clampedStat = Math.min(stealthStat, STEALTH_SENSORY_CAP);
  // Calculate intervals above the default stat (1000)
  const intervals = Math.max(0, Math.floor((clampedStat - 1000) / 1000));
  return STEALTH_BASE_KEEP_CHANCE_PERC + intervals * STEALTH_KEEP_CHANCE_PER_1000_POINTS;
};

/**
 * Calculate the chance to detect a stealthed player
 * Base: 5%, +2.75% per 1000 points above default (1000), capped at 60%
 * At default stat (1000), players get only the base chance
 * Returns a percentage (0-100)
 */
export const calcSensoryDetectChance = (sensoryStat: number): number => {
  const clampedStat = Math.min(sensoryStat, STEALTH_SENSORY_CAP);
  // Calculate intervals above the default stat (1000)
  const intervals = Math.max(0, Math.floor((clampedStat - 1000) / 1000));
  const chance = SENSORY_BASE_DETECT_CHANCE_PERC + intervals * SENSORY_DETECT_CHANCE_PER_1000_POINTS;
  return Math.min(chance, SENSORY_MAX_DETECT_CHANCE_PERC);
};

/**
 * Calculate the cooldown between sensory uses in seconds
 * Base: 120 seconds (2 min), -5 seconds per 1000 points above default (1000)
 * At default stat (1000), players get the base cooldown
 * Minimum cooldown is 30 seconds
 */
export const calcSensoryCooldown = (sensoryStat: number): number => {
  const clampedStat = Math.min(sensoryStat, STEALTH_SENSORY_CAP);
  // Calculate intervals above the default stat (1000)
  const intervals = Math.max(0, Math.floor((clampedStat - 1000) / 1000));
  const cooldown =
    SENSORY_BASE_COOLDOWN_SECONDS - intervals * SENSORY_COOLDOWN_REDUCTION_PER_1000_POINTS;
  return Math.max(cooldown, 30); // Minimum 30 second cooldown
};

/**
 * Check if stealth has expired based on activation time and stat
 */
export const isStealthExpired = (
  stealthActivatedAt: Date | null,
  stealthStat: number,
): boolean => {
  if (!stealthActivatedAt) return true;

  const maxDuration = calcStealthDuration(stealthStat);
  const elapsedSeconds = (Date.now() - stealthActivatedAt.getTime()) / 1000;

  return elapsedSeconds >= maxDuration;
};

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
 */
export const isSensoryReady = (lastSensoryAt: Date | null, sensoryStat: number): boolean => {
  if (!lastSensoryAt) return true;

  const cooldown = calcSensoryCooldown(sensoryStat);
  const elapsedSeconds = (Date.now() - lastSensoryAt.getTime()) / 1000;

  return elapsedSeconds >= cooldown;
};

/**
 * Check if stealth cooldown has expired (after combat)
 */
export const isStealthCooldownExpired = (stealthCooldownAt: Date | null): boolean => {
  if (!stealthCooldownAt) return true;
  return Date.now() >= stealthCooldownAt.getTime();
};

/**
 * Get remaining stealth duration in seconds
 */
export const getRemainingStealthDuration = (
  stealthActivatedAt: Date | null,
  stealthStat: number,
): number => {
  if (!stealthActivatedAt) return 0;

  const maxDuration = calcStealthDuration(stealthStat);
  const elapsedSeconds = (Date.now() - stealthActivatedAt.getTime()) / 1000;
  const remaining = maxDuration - elapsedSeconds;

  return Math.max(remaining, 0);
};

/**
 * Get remaining sensory cooldown in seconds
 */
export const getRemainingSensoryCooldown = (
  lastSensoryAt: Date | null,
  sensoryStat: number,
): number => {
  if (!lastSensoryAt) return 0;

  const cooldown = calcSensoryCooldown(sensoryStat);
  const elapsedSeconds = (Date.now() - lastSensoryAt.getTime()) / 1000;
  const remaining = cooldown - elapsedSeconds;

  return Math.max(remaining, 0);
};

/**
 * Get remaining stealth cooldown in seconds (after combat)
 */
export const getRemainingStealthCooldown = (stealthCooldownAt: Date | null): number => {
  if (!stealthCooldownAt) return 0;

  const remaining = (stealthCooldownAt.getTime() - Date.now()) / 1000;
  return Math.max(remaining, 0);
};

/**
 * Check if a user is currently stealthed (active and not expired)
 * Convenience function that combines stealthActive check with expiration check
 */
export const isUserCurrentlyStealthed = (user: {
  stealthActive: boolean;
  stealthActivatedAt: Date | null;
  stealth: number;
}): boolean => {
  return (
    user.stealthActive &&
    user.stealthActivatedAt !== null &&
    !isStealthExpired(user.stealthActivatedAt, user.stealth)
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
  return new Date(covertTrainingStartedAt.getTime() + covertTrainingMinutes * 60 * 1000);
};

/**
 * Calculate the training gain for covert skills based on minutes and current stat level
 */
export const calcCovertTrainingGain = (
  minutes: number,
  currentStat: number,
  cap: number,
  gainPerMinute: number,
): number => {
  const rawGain = minutes * gainPerMinute;
  return Math.min(rawGain, cap - currentStat);
};

/**
 * Derive all stealth status values from user data.
 * This is a pure function that computes all stealth-related UI values.
 */
export const getStealthStatus = (
  userData:
    | {
        stealth: number;
        sensory: number;
        stealthActive: boolean;
        stealthActivatedAt: Date | null;
        stealthCooldownAt: Date | null;
        lastSensoryAt: Date | null;
        covertTrainingType: "stealth" | "sensory" | null;
        covertTrainingStartedAt: Date | null;
        covertTrainingMinutes: number | null;
      }
    | undefined
    | null,
  cap: number,
  gainPerMinute: number,
) => {
  if (!userData) return undefined;

  const covertTrainingFinishAt = calcCovertTrainingFinishAt(
    userData.covertTrainingStartedAt,
    userData.covertTrainingMinutes,
  );

  const covertTrainingGain =
    userData.covertTrainingMinutes != null
      ? calcCovertTrainingGain(
          userData.covertTrainingMinutes,
          userData.covertTrainingType === "stealth" ? userData.stealth : userData.sensory,
          cap,
          gainPerMinute,
        )
      : null;

  return {
    stealth: userData.stealth,
    sensory: userData.sensory,
    stealthActive: userData.stealthActive,
    isCurrentlyStealthed: isUserCurrentlyStealthed(userData),
    stealthDurationMax: calcStealthDuration(userData.stealth),
    stealthDurationRemaining: getRemainingStealthDuration(
      userData.stealthActivatedAt,
      userData.stealth,
    ),
    stealthKeepChance: calcStealthKeepChance(userData.stealth),
    stealthCooldownRemaining: getRemainingStealthCooldown(userData.stealthCooldownAt),
    sensoryDetectChance: calcSensoryDetectChance(userData.sensory),
    sensoryCooldown: calcSensoryCooldown(userData.sensory),
    sensoryCooldownRemaining: getRemainingSensoryCooldown(
      userData.lastSensoryAt,
      userData.sensory,
    ),
    covertTrainingType: userData.covertTrainingType,
    covertTrainingFinishAt,
    covertTrainingGain,
  };
};
