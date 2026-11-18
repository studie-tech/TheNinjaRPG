import type { UserRaidBuff } from "@/drizzle/schema";
import { getEffectPower } from "@/libs/combat/power";
import type { BattleUserState, UserEffect } from "@/libs/combat/types";

/** Recovery bonuses active from creation until exclusive expiry, including permanent title intervals. */
export type TimedBuff = Pick<UserRaidBuff, "effects" | "createdAt" | "expiresAt"> & {
  /** Flat title bonuses stack; ordinary meal and raid bonuses compete by strength. */
  stacking?: boolean;
};

/** Base regeneration plus the strongest timed bonus and all additive title bonuses at this instant. */
export const getTimedRegeneration = (
  base: number,
  buffs: readonly TimedBuff[],
  at = new Date(),
) => {
  let increase = 0;
  let permanentIncrease = 0;
  for (const buff of buffs) {
    if (new Date(buff.createdAt) > at || new Date(buff.expiresAt) <= at) continue;
    for (const effect of buff.effects) {
      if (effect.type !== "increaseregeneration") continue;
      if (buff.stacking) {
        permanentIncrease += effect.power;
        continue;
      }
      increase = Math.max(
        increase,
        effect.calculation === "percentage"
          ? (base * effect.power) / 100
          : effect.power,
      );
    }
  }
  return base + increase + permanentIncrease;
};

/**
 * Recover complete ticks, sampling each at from + tick * tickSeconds. Grouping by
 * activation/expiry boundaries preserves earned bonuses without iterating every offline tick.
 */
export const getTimedRegenerationGain = (
  base: number,
  buffs: readonly TimedBuff[],
  from: Date,
  ticks: number,
  tickSeconds: number,
) => {
  if (!buffs.length || ticks <= 0) return base * ticks;
  const step = tickSeconds * 1000;
  const boundaries = new Set([1, ticks + 1]);
  for (const buff of buffs) {
    for (const date of [buff.createdAt, buff.expiresAt]) {
      boundaries.add(
        Math.max(
          1,
          Math.min(
            ticks + 1,
            Math.ceil((new Date(date).getTime() - from.getTime()) / step),
          ),
        ),
      );
    }
  }
  const ordered = [...boundaries].sort((a, b) => a - b);
  return ordered
    .slice(0, -1)
    .reduce(
      (sum, first, i) =>
        sum +
        (ordered[i + 1]! - first) *
          getTimedRegeneration(base, buffs, new Date(from.getTime() + first * step)),
      0,
    );
};

const statFields = [
  "offence",
  "defence",
  "strength",
  "speed",
  "intelligence",
  "willpower",
] as const;
type StatField = (typeof statFields)[number];
/** Resolve unified combat-stat selectors and Highest generals into concrete affected fields. */
const affectedFields = (effect: UserEffect, target: BattleUserState): StatField[] => {
  if (effect.type !== "increasestat") return [];
  const fields: StatField[] = [];
  if (effect.direction === "offence" || effect.direction === "both")
    fields.push("offence");
  if (effect.direction === "defence" || effect.direction === "both")
    fields.push("defence");
  for (const general of effect.generalTypes ?? []) {
    if (general === "Highest") fields.push(...target.highestGenerals);
    else fields.push(general.toLowerCase() as StatField);
  }
  return [...new Set(fields)].filter((field) => statFields.includes(field));
};

/**
 * Keep each statistic's strongest timed bonus against its saved unmodified baseline.
 * Equal bonuses use effect IDs to select one stable winner; ordinary combat tags still stack.
 */
export const nonStackingTimedStatEffect = (
  effect: UserEffect,
  effects: UserEffect[],
  target: BattleUserState,
  now = Date.now(),
): UserEffect | null => {
  if (!effect.timedBuffExpiresAt || effect.type !== "increasestat") return effect;
  if (effect.timedBuffExpiresAt <= now) return null;
  target.baseStatsForModifiers ??= {};
  for (const field of statFields) target.baseStatsForModifiers[field] ??= target[field];
  const remaining = affectedFields(effect, target).filter((field) => {
    const base = target.baseStatsForModifiers?.[field] ?? target[field];
    const amount = (entry: UserEffect) => {
      const power = getEffectPower(entry);
      return entry.calculation === "percentage" ? (base * power) / 100 : power;
    };
    return !effects.some(
      (other) =>
        other.id !== effect.id &&
        other.targetId === effect.targetId &&
        other.type === "increasestat" &&
        (other.timedBuffExpiresAt ?? 0) > now &&
        affectedFields(other, target).includes(field) &&
        (amount(other) > amount(effect) ||
          (amount(other) === amount(effect) && other.id < effect.id)),
    );
  });
  if (!remaining.length) return null;
  return {
    ...effect,
    direction: remaining.includes("offence")
      ? remaining.includes("defence")
        ? "both"
        : "offence"
      : remaining.includes("defence")
        ? "defence"
        : "none",
    generalTypes: remaining
      .filter((field) => field !== "offence" && field !== "defence")
      .map(
        (field) =>
          (field[0]?.toUpperCase() + field.slice(1)) as
            | "Strength"
            | "Speed"
            | "Intelligence"
            | "Willpower",
      ),
  };
};

/** Disjoint continuous bonus intervals for combat's fractional Energy recovery. */
export type RegenerationPeriod = { startsAt: number; endsAt: number; bonus: number };
/** Preload bonus-only intervals so combat settlement needs no further buff queries. */
export const getTimedRegenerationPeriods = (
  base: number,
  buffs: readonly TimedBuff[],
) => {
  const boundaries = [
    ...new Set(
      buffs.flatMap((buff) => [
        new Date(buff.createdAt).getTime(),
        new Date(buff.expiresAt).getTime(),
      ]),
    ),
  ].sort((a, b) => a - b);
  return boundaries.slice(0, -1).flatMap((startsAt, index): RegenerationPeriod[] => {
    const bonus = getTimedRegeneration(base, buffs, new Date(startsAt)) - base;
    return bonus > 0 ? [{ startsAt, endsAt: boundaries[index + 1]!, bonus }] : [];
  });
};
/** Prorate overlapping bonus intervals; callers add ordinary base regeneration separately. */
export const getRegenerationPeriodGain = (
  periods: readonly RegenerationPeriod[],
  from: Date,
  to: Date,
  tickSeconds: number,
) =>
  periods.reduce(
    (sum, period) =>
      sum +
      (period.bonus *
        Math.max(
          0,
          Math.min(to.getTime(), period.endsAt) -
            Math.max(from.getTime(), period.startsAt),
        )) /
        (tickSeconds * 1000),
    0,
  );
