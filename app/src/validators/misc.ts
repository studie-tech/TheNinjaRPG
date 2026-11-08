import { z } from "zod";
import {
  GAME_SETTING_GAINS_MULTIPLIER,
  MAX_MASS_EXPERIENCE_AWARD,
} from "@/drizzle/constants";

export const changeSettingSchema = z.object({
  setting: z.enum([
    "trainingGainMultiplier",
    "regenGainMultiplier",
    "battleExpMultiplier",
    "missionExpMultiplier",
    "jutsuExpMultiplier",
    "itemExpMultiplier",
  ]),
  multiplier: z.enum(GAME_SETTING_GAINS_MULTIPLIER),
  days: z.number().min(0).max(31),
});
export type ChangeSettingSchema = z.infer<typeof changeSettingSchema>;

// Prestige transfer schema (used in townhall)
export const createPrestigeTransferSchema = (maxPrestige: number) =>
  z.object({
    amount: z.coerce.number().int().positive().max(maxPrestige).optional(),
  });
export type PrestigeTransferSchemaInput = z.input<
  ReturnType<typeof createPrestigeTransferSchema>
>;
export type PrestigeTransferSchema = z.infer<
  ReturnType<typeof createPrestigeTransferSchema>
>;

// Experience award schema (used in PublicUser for staff)
export const experienceAwardSchema = z.object({
  amount: z.number().min(1).max(MAX_MASS_EXPERIENCE_AWARD),
});
export type ExperienceAwardSchema = z.infer<typeof experienceAwardSchema>;

export const idSchema = z.object({ id: z.string() });
