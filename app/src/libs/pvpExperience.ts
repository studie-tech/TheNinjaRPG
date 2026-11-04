import {
  PVP_EXPERIENCE_AVERAGE_SETTING,
  PVP_EXPERIENCE_BOOST_TIERS,
  PVP_EXPERIENCE_PARTICIPATION_REWARD,
  PVP_EXPERIENCE_WIN_REWARD,
  PVP_WEEKLY_KILL_BOOST,
  PVP_WEEKLY_KILL_BOOST_CAP,
} from "@/drizzle/constants";
import type { GameSetting, UserData } from "@/drizzle/schema";
import { periodStart } from "@/utils/time";
import type { ObjectiveRewardType } from "@/validators/rewards";
import { MASTERY_EXPERIENCE_FIELDS } from "@/validators/rewards";

/** Global tiers require earned XP; a zero population average never grants a free boost. */
export const getPvpBoost = (
  user: Partial<
    Pick<UserData, "pvpExperience" | "weeklyPvpKills" | "weeklyPvpKillsAt" | "isAi">
  >,
  settings: GameSetting[] = [],
  now = new Date(),
) => {
  const average =
    settings.find((s) => s.name === PVP_EXPERIENCE_AVERAGE_SETTING)?.value ?? 0;
  const experience = Math.max(0, user.pvpExperience ?? 0);
  const basePercent =
    !user.isAi && experience > 0 && average > 0
      ? (PVP_EXPERIENCE_BOOST_TIERS.find((tier) => experience >= average * tier.ratio)
          ?.percent ?? 0)
      : 0;
  const weeklyKills =
    !user.isAi &&
    user.weeklyPvpKillsAt &&
    user.weeklyPvpKillsAt >= periodStart("weekly", now)
      ? Math.max(0, user.weeklyPvpKills ?? 0)
      : 0;
  const weeklyPercent = Math.min(
    PVP_WEEKLY_KILL_BOOST_CAP,
    weeklyKills * PVP_WEEKLY_KILL_BOOST,
  );
  return {
    average,
    basePercent,
    weeklyKills,
    weeklyPercent,
    totalPercent: basePercent + weeklyPercent,
  };
};

/** PvP XP follows the battle's repeat-opponent scaling and is never boosted by itself. */
export const pvpExperienceReward = (
  outcome: "Won" | "Lost" | "Draw" | "Fled",
  scaling: number,
) =>
  outcome === "Fled"
    ? 0
    : Math.floor(
        (PVP_EXPERIENCE_PARTICIPATION_REWARD +
          (outcome === "Won" ? PVP_EXPERIENCE_WIN_REWARD : 0)) *
          Math.max(0, scaling) *
          100,
      ) / 100;

/** Penalties and transfers retain their amount; only newly generated positive gains increase. */
export const boostPvpGain = (gain: number, percent: number) =>
  gain > 0 ? (gain * (100 + percent)) / 100 : gain;

const fractionalPvpRewardFields = new Set<string>([
  "reward_prestige",
  ...MASTERY_EXPERIENCE_FIELDS,
]);

const pvpRewardFields = [
  "reward_pet_experience",
  "reward_money",
  "reward_clanpoints",
  "reward_exp",
  "reward_tokens",
  "reward_prestige",
  "reward_hunting_experience",
  "reward_crafting_experience",
  "reward_gathering_experience",
  ...MASTERY_EXPERIENCE_FIELDS,
  "reward_sage_mastery_experience",
] as const;

/** Boost newly generated rewards in place across quest, raid, season, streak and item payouts. */
export const boostPvpRewards = (
  rewards: Partial<Pick<ObjectiveRewardType, (typeof pvpRewardFields)[number]>>,
  percent: number,
  floorIntegers = false,
) => {
  for (const field of pvpRewardFields) {
    const gain = rewards[field];
    if (typeof gain === "number") {
      const amount = boostPvpGain(gain, percent);
      rewards[field] =
        floorIntegers && !fractionalPvpRewardFields.has(field)
          ? Math.floor(amount)
          : amount;
    }
  }
};
