/**
 * Tower-defense balance curves.
 *
 * Enemy health grows geometrically with a per-wave rate that steps down in later eras,
 * while damage and bounty grow more slowly. In-run upgrades are paid from bounty, so
 * they cover most but not all of each wave's growth; the gap is what permanent Guard Hall
 * levels close. Each era boundary also adds new enemy rules (affixes, mutators, more
 * bosses), so the best build keeps changing as the wave count climbs.
 *
 * Every curve is a table built by multiplication so it is identical on every engine.
 *
 * Runs must always end: per wave, the best in-run growth (shop damage times jutsu or
 * sentry levels, paid from bounty growing at 65% of health growth) stays below health
 * growth, so even a perfect build eventually falls behind.
 */

import {
  TD_DAILY_PRESTIGE,
  TD_DAILY_RYO_PER_LEVEL,
  TD_DAILY_VILLAGE_TOKENS,
  TD_DAILY_WAVES,
} from "@/drizzle/constants";
import { powi } from "@/libs/towerDefense/rng";

export const TD_TPS = 10;
export const TD_TICK_SECONDS = 1 / TD_TPS;
/** Ticks between automatic wave starts. */
export const TD_WAVE_TICKS = 240;
/** Quiet ticks before the first wave: a short breath from wave 1, longer at checkpoints. */
export const TD_OPENING_TICKS = 50;
export const TD_CHECKPOINT_OPENING_TICKS = 300;
/** Ticks over which a wave's enemies arrive. */
export const TD_SPAWN_WINDOW_TICKS = 150;
/** Enemies alive at once; further spawns wait. */
export const TD_MAX_ALIVE = 220;
export const TD_SPAWN_RADIUS = 12;
export const TD_RIFT_SPAWN_RADIUS = 6.5;
/** The hero may blink anywhere within this distance of the centre. */
export const TD_HERO_ZONE = 3.5;
export const TD_SENTRY_RING = 2.2;
export const TD_SENTRY_SLOTS = 6;
export const TD_CAMO_REVEAL_RANGE = 2.5;
export const TD_SHIELD_REFILL_TICKS = 30;
export const TD_SHURIKEN_SPEED = 9;
export const TD_LOOT_TICKS = 60;
/** Gap between seals before a sequence resets. */
export const TD_SEAL_GAP_TICKS = 25;
/** Coordinates in actions are integers in hundredths of a unit. */
export const TD_COORD_SCALE = 100;

/** Character level at which the level bonus peaks. */
export const TD_LEVEL_BONUS_MAX_LEVEL = 100;
/** Extra damage at that level, rising linearly from nothing at level 1. */
export const TD_LEVEL_BONUS_MAX = 1;

/**
 * Waves a run cleared: a wave counts once the next one starts, so a run started at
 * `startWave` that fell during `wave` cleared everything in between.
 */
export const tdWavesCleared = (startWave: number, wave: number) =>
  Math.max(0, wave - startWave);

/** Whether a run cleared enough waves to fulfil the daily Guard Hall duty. */
export const tdFulfilsDailyDuty = (startWave: number, wave: number) =>
  tdWavesCleared(startWave, wave) >= TD_DAILY_WAVES;

/** What the daily Guard Hall duty pays a character of `level`. */
export const tdDailyReward = (level: number) => ({
  ryo: TD_DAILY_RYO_PER_LEVEL * Math.max(1, Math.floor(level)),
  prestige: TD_DAILY_PRESTIGE,
  villageTokens: TD_DAILY_VILLAGE_TOKENS,
});

/** Share of extra damage a character level brings: 0 at level 1, the maximum at 100. */
export const tdLevelDamageBonus = (level: number) =>
  Number.isFinite(level)
    ? (TD_LEVEL_BONUS_MAX *
        Math.min(Math.max(Math.floor(level) - 1, 0), TD_LEVEL_BONUS_MAX_LEVEL - 1)) /
      (TD_LEVEL_BONUS_MAX_LEVEL - 1)
    : 0;

export const TD_HERO_BASE = {
  damage: 10,
  rate: 1.4,
  range: 4.5,
  crit: 0.05,
  critMult: 2,
  health: 100,
  regen: 0.005,
  chakra: 100,
  chakraRegen: 3,
  blinkTicks: 40,
  substitutionTicks: 80,
  substitutionWindow: 8,
  trapCharges: 3,
  trapRechargeTicks: 60,
} as const;

const MAX_TABLE_WAVE = 5000;

/** Health growth per wave; each later era grows more slowly but adds new mechanics. */
const tdHealthGrowth = (wave: number) =>
  wave <= 30 ? 0.085 : wave <= 100 ? 0.068 : wave <= 300 ? 0.064 : 0.056;

/**
 * Extra growth past wave 600 that bounty does not share: in-run upgrades stop keeping
 * pace, so every build eventually meets its wall.
 */
const tdLateRamp = (wave: number) => Math.min(0.1, Math.max(0, wave - 600) * 0.0002);

const buildTable = (rate: (wave: number) => number) => {
  const table = [1, 1];
  for (let wave = 2; wave <= MAX_TABLE_WAVE; wave++)
    table.push((table[wave - 1] ?? 1) * (1 + rate(wave)));
  return table;
};

const healthTable = buildTable((wave) => tdHealthGrowth(wave) + tdLateRamp(wave));
const damageTable = buildTable(
  (wave) => tdHealthGrowth(wave) * 0.72 + tdLateRamp(wave),
);
const bountyTable = buildTable((wave) => tdHealthGrowth(wave) * 0.65);

/** Past the table, keep compounding, but never past a finite ceiling. */
const tableAt = (table: number[], wave: number) => {
  const index = Math.max(1, Math.floor(wave));
  const base = table[Math.min(MAX_TABLE_WAVE, index)] ?? 1;
  const value =
    index > MAX_TABLE_WAVE ? base * powi(1.1, index - MAX_TABLE_WAVE) : base;
  return Math.min(1e290, value);
};

/** Health of a basic enemy at a wave. */
export const tdReferenceHealth = (wave: number) => 12 * tableAt(healthTable, wave);
/** Damage per hit of a basic enemy at a wave. */
export const tdReferenceDamage = (wave: number) => 4 * tableAt(damageTable, wave);
/** Ryo for killing a basic enemy at a wave. */
export const tdReferenceBounty = (wave: number) => tableAt(bountyTable, wave);
/** Enemy speed bonus, capped so late waves stay readable. */
export const tdSpeedBonus = (wave: number) => 1 + Math.min(0.6, wave / 1000);

/** Past this wave, elite and boss hits pierce a share of the hero's max health. */
export const TD_PIERCING_AFTER_WAVE = 150;
/** Share of the hero's max health an elite or boss hit pierces through every defense. */
export const tdPiercingShare = (wave: number) =>
  Math.min(0.04, Math.max(0, wave - TD_PIERCING_AFTER_WAVE) / 8000);

/** Enemies in a normal wave before era modifiers. */
export const tdWaveCount = (wave: number) =>
  Math.min(60, Math.floor(6 + 2 * Math.sqrt(wave)));

/** Chance a spawned enemy is an elite, and how many affixes elites carry. */
export const tdEliteChance = (wave: number) =>
  wave < 35 ? 0 : Math.min(0.35, (wave - 35) / 300);
export const tdAffixCount = (wave: number) =>
  Math.max(1, Math.min(5, 1 + Math.floor((wave - 50) / 100)));

/** Ryo paid when a wave ends, before multipliers. */
export const tdWaveBonus = (wave: number) => 6 * tdReferenceBounty(wave);

/** Scrolls for clearing a wave, growing so late waves are worth far more. */
export const tdWaveScrolls = (wave: number) => 1 + wave * 0.06 + (wave * wave) / 40000;
export const tdBossScrolls = (wave: number, titan: boolean) =>
  (3 + wave * 0.15) * (titan ? 5 : 1);

/** Ryo a run starts with: enough to rebuild a reasonable shop when skipping ahead. */
export const tdStartingRyo = (startWave: number, warChestLevel: number) => {
  const base = startWave <= 1 ? 20 : 250 * tdReferenceBounty(startWave);
  return Math.floor(base * (1 + 0.05 * warChestLevel));
};

/** Perk drafts granted when a run starts past wave 1. */
export const tdStartingDrafts = (startWave: number) => Math.floor((startWave - 1) / 20);

/** Fastest game speed unlocked by a Time Dilation level. */
export const TD_GAME_SPEEDS = [1, 1.5, 2, 3, 4] as const;
export const tdMaxSpeed = (level: number) =>
  TD_GAME_SPEEDS[Math.max(0, Math.min(TD_GAME_SPEEDS.length - 1, level))] ?? 1;
