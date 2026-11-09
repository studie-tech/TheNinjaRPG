import { z } from "zod";
import { ObjectiveReward } from "./rewards";

export const divisionRewardSchema = z.object({
  division: z.string(),
  rewards: ObjectiveReward,
});
export type RankedSeasonDivisionReward = z.infer<typeof divisionRewardSchema>;

export const rankedSeasonSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().min(1, "Description is required"),
  startDate: z.date(),
  endDate: z.date(),
  rewards: z.array(divisionRewardSchema),
  paused: z.boolean().prefault(false),
});
export type RankedSeason = z.infer<typeof rankedSeasonSchema>;
export type RankedSeasonInput = z.input<typeof rankedSeasonSchema>;

export const rankedLoadoutSchema = z.object({
  jutsuIds: z.array(z.string()),
  weaponIds: z.array(z.string()),
  consumableIds: z.array(z.string()),
  favoriteJutsuIds: z.array(z.string()).optional(),
  favoriteWeaponIds: z.array(z.string()).optional(),
  favoriteConsumableIds: z.array(z.string()).optional(),
});
export type RankedLoadoutSchema = z.infer<typeof rankedLoadoutSchema>;
