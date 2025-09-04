import { z } from "zod";
import { GAME_SETTING_GAINS_MULTIPLIER } from "@/drizzle/constants";

export const changeSettingSchema = z.object({
  setting: z.enum([
    "trainingGainMultiplier",
    "regenGainMultiplier",
    "battleExpMultiplier",
    "missionExpMultiplier",
    "jutsuExpMultiplier"
  ]),
  multiplier: z.enum(GAME_SETTING_GAINS_MULTIPLIER),
  days: z.number().min(0).max(31),
});
export type ChangeSettingSchema = z.infer<typeof changeSettingSchema>;

export const createTicketSchema = z
  .object({
    content: z.string().min(2).max(10000),
    title: z.string().min(2).max(255),
  })
  .strict()
  .required();

export type CreateTicketSchema = z.infer<typeof createTicketSchema>;

export const TicketTypes = [
  "bug_report",
  "human_support",
  "ai_support",
  "tutorial",
] as const;
export type TicketType = (typeof TicketTypes)[number];

export const captchaVerifySchema = z.object({
  guess: z.string(),
});

export type CaptchaVerifySchema = z.infer<typeof captchaVerifySchema>;
