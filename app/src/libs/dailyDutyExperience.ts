import type { UserRank } from "@/drizzle/constants";
import { calcLevelRequirements } from "@/libs/profile";
import { tdDailyReward } from "@/libs/towerDefense/balance";

/** Share of the next level that one daily duty (Guard Hall or Scout Post) pays as experience. */
export const DAILY_DUTY_LEVEL_SHARE = 0.1;

/** Ranks still on the road to Chunin, whose daily duties also pay experience. */
const DUTY_EXPERIENCE_RANKS: readonly UserRank[] = ["STUDENT", "GENIN"];

/**
 * Experience a daily duty pays: a tenth of the player's next level for Students and
 * Genin, so the dailies visibly move them towards their next story chapter, and none
 * for higher ranks, whose duty rewards are unchanged.
 */
export const dailyDutyExperience = (rank: UserRank, level: number) => {
  if (!DUTY_EXPERIENCE_RANKS.includes(rank)) return 0;
  const current = Math.max(1, Math.floor(level));
  const levelCost = calcLevelRequirements(current) - calcLevelRequirements(current - 1);
  return Math.round(levelCost * DAILY_DUTY_LEVEL_SHARE);
};

/** What a daily duty pays: the Guard Hall's ryo, prestige and village tokens, plus experience. */
export const dailyDutyReward = (rank: UserRank, level: number) => ({
  ...tdDailyReward(level),
  experience: dailyDutyExperience(rank, level),
});

/** The reward one daily duty pays. */
export type DailyDutyReward = ReturnType<typeof dailyDutyReward>;

/** A paid duty's rewards as the closing clause of its claim message. */
export const describeDailyDutyReward = (reward: DailyDutyReward, hasVillage: boolean) =>
  `+${reward.ryo.toLocaleString()} ryo, +${reward.prestige} prestige${reward.experience > 0 ? `, +${reward.experience.toLocaleString()} experience` : ""}${hasVillage ? ` and +${reward.villageTokens} tokens for your village` : ""}.`;
