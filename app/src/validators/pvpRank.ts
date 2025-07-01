import { z } from "zod";
import { rewardFields } from "./objectives";

// Possible rewards are the same as for objectives, so that we can re-use code
export const rewardSchema = z.object(rewardFields);
export type RankedSeasonReward = z.infer<typeof rewardSchema>;

export const divisionRewardSchema = z.object({
  division: z.string(),
  rewards: rewardSchema,
});
export type RankedSeasonDivisionReward = z.infer<typeof divisionRewardSchema>;

export const rankedSeasonSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().min(1, "Description is required"),
  startDate: z.date(),
  endDate: z.date(),
  rewards: z.array(divisionRewardSchema),
});
export type RankedSeason = z.infer<typeof rankedSeasonSchema>;

export const rankedLoadoutSchema = z.object({
  jutsuIds: z.array(z.string()),
  weaponIds: z.array(z.string()),
  consumableIds: z.array(z.string()),
});
export type RankedLoadoutSchema = z.infer<typeof rankedLoadoutSchema>;
