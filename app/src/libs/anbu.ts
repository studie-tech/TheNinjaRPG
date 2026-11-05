import {
  ANBU_ESPIONAGE_BASE_CHANCE_PERC,
  ANBU_ESPIONAGE_CHANGE_PER_LEVEL,
  ANBU_STEALTH_BASE_CHANCE_PERC,
  ANBU_STEALTH_CHANGE_PER_LEVEL,
} from "@/drizzle/constants";

/** Percent chance that a squad's espionage mission succeeds. */
export const anbuEspionageChance = (level: number) =>
  ANBU_ESPIONAGE_BASE_CHANCE_PERC + level * ANBU_ESPIONAGE_CHANGE_PER_LEVEL;

/** Percent chance that a squad member evades the village protector. */
export const anbuStealthChance = (level: number) =>
  ANBU_STEALTH_BASE_CHANCE_PERC + level * ANBU_STEALTH_CHANGE_PER_LEVEL;
