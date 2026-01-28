import { z } from "zod";
import { UserRanks, STARTER_VILLAGES } from "@/drizzle/constants";
import { idsWithNumberField } from "@/validators/base";

export const rewardFields = {
  reward_hunter_items: z.boolean().default(false),
  reward_hunter_items_ids: z.array(z.string()).default([]),
  reward_gathering_items: z.boolean().default(false),
  reward_gathering_items_ids: z.array(z.string()).default([]),
  reward_seichi_silver: z.coerce.number().default(0),
  reward_money: z.coerce.number().default(0),
  reward_clanpoints: z.coerce.number().default(0),
  reward_anbupoints: z.coerce.number().default(0),
  reward_exp: z.coerce.number().default(0),
  reward_tokens: z.coerce.number().default(0),
  reward_prestige: z.coerce.number().default(0),
  reward_reputation: z.coerce.number().default(0),
  reward_skillpoints: z.coerce.number().default(0),
  reward_rank: z.enum(UserRanks).default("NONE"),
  reward_village_membership: z.enum(STARTER_VILLAGES).default("NONE"),
  reward_items: idsWithNumberField,
  reward_jutsus: z.array(z.string()).default([]),
  reward_bloodlines: z.array(z.string()).default([]),
  reward_badges: z.array(z.string()).default([]),
  reward_medical_experience: z.coerce.number().default(0),
  reward_hunting_experience: z.coerce.number().default(0),
  reward_crafting_experience: z.coerce.number().default(0),
  reward_gathering_experience: z.coerce.number().default(0),
  reward_war_damage: z.coerce.number().default(0), // Damage to enemy war health
  reward_war_healing: z.coerce.number().default(0), // Heal own war health
};

export const ObjectiveReward = z.object(rewardFields);
export type ObjectiveRewardType = z.infer<typeof ObjectiveReward>;

export const hasReward = (reward: ObjectiveRewardType) => {
  const parsedReward = ObjectiveReward.parse(reward);
  return (
    parsedReward.reward_money > 0 ||
    parsedReward.reward_seichi_silver > 0 ||
    parsedReward.reward_clanpoints > 0 ||
    parsedReward.reward_anbupoints > 0 ||
    parsedReward.reward_exp > 0 ||
    parsedReward.reward_tokens > 0 ||
    parsedReward.reward_prestige > 0 ||
    parsedReward.reward_reputation > 0 ||
    parsedReward.reward_skillpoints > 0 ||
    parsedReward.reward_rank !== "NONE" ||
    parsedReward.reward_village_membership !== "NONE" ||
    parsedReward.reward_items.length > 0 ||
    parsedReward.reward_jutsus.length > 0 ||
    parsedReward.reward_bloodlines.length > 0 ||
    parsedReward.reward_badges.length > 0 ||
    parsedReward.reward_hunter_items ||
    parsedReward.reward_gathering_items ||
    parsedReward.reward_medical_experience > 0 ||
    parsedReward.reward_hunting_experience > 0 ||
    parsedReward.reward_crafting_experience > 0 ||
    parsedReward.reward_gathering_experience > 0 ||
    parsedReward.reward_war_damage > 0 ||
    parsedReward.reward_war_healing > 0
  );
};
