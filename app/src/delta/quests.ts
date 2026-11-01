import type { GetRewardResult } from "@/libs/quest";
import { MASTERY_EXPERIENCE_FIELDS } from "@/validators/rewards";
import type { UserDelta } from "@/validators/userCache";

/**
 * Scalar rewards compose with accepted cache updates; derived state needs reconciliation.
 * Pet XP needs a refresh because its committed amount depends on live SQL eligibility.
 */
export const getRewardUserDelta = (
  rewards: GetRewardResult,
  reputationCost = 0,
  hasQuestSnapshot = false,
): UserDelta | undefined => {
  if (
    // Integer columns round SQL payouts; fractional atomic increments need reconciliation.
    [
      rewards.reward_money,
      rewards.reward_seichi_silver,
      rewards.reward_exp,
      rewards.reward_skillpoints,
    ].some((amount) => !Number.isInteger(amount)) ||
    (!hasQuestSnapshot && rewards.reward_reputation !== 0) ||
    rewards.reward_prestige < 0 ||
    rewards.reward_rank !== "NONE" ||
    rewards.reward_village_membership !== "NONE" ||
    (!hasQuestSnapshot &&
      (rewards.reward_items.length > 0 ||
        rewards.reward_jutsus.length > 0 ||
        rewards.reward_badges.length > 0 ||
        rewards.reward_skillpoints !== 0)) ||
    rewards.reward_bloodlines.length > 0 ||
    rewards.reward_sage_modes.length > 0 ||
    (rewards.reward_titles?.length ?? 0) > 0 ||
    rewards.reward_hunter_items ||
    rewards.reward_gathering_items ||
    rewards.reward_clanpoints !== 0 ||
    rewards.reward_anbupoints !== 0 ||
    rewards.reward_tokens !== 0 ||
    rewards.reward_war_damage !== 0 ||
    rewards.reward_war_healing !== 0 ||
    rewards.reward_medical_experience !== 0 ||
    rewards.reward_hunting_experience !== 0 ||
    rewards.reward_crafting_experience !== 0 ||
    rewards.reward_gathering_experience !== 0 ||
    (rewards.reward_pet_experience ?? 0) !== 0 ||
    MASTERY_EXPERIENCE_FIELDS.some((field) => (rewards[field] ?? 0) > 0) ||
    (rewards.reward_mastery_rank && rewards.reward_mastery_rank !== "NONE") ||
    rewards.reward_sage_mastery_experience !== 0
  ) {
    // Content grants, profession milestones and shared relations change derived profile data.
    return undefined;
  }
  return {
    money: rewards.reward_money,
    seichiSilver: rewards.reward_seichi_silver,
    earnedExperience: rewards.reward_exp,
    reputationPoints: rewards.reward_reputation - reputationCost,
    reputationPointsTotal: rewards.reward_reputation,
    villagePrestige: rewards.reward_prestige,
  };
};
