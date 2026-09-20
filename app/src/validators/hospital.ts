import { z } from "zod";
import { baseServerResponse } from "@/validators/base";

export const userHealInputSchema = z.object({
  userId: z.string(),
  healPercentage: z.int().min(1).max(100),
});

/** The healer's row after a hospital heal; the client patches its cached user with it. */
export const healerAfterHealSchema = z.object({
  curHealth: z.number(),
  curChakra: z.number(),
  curStamina: z.number(),
  medicalExperience: z.number(),
  regenAt: z.date(),
});

export const userHealOutputSchema = baseServerResponse.extend({
  chakraCost: z.number().optional(),
  expGain: z.number().optional(),
  healer: healerAfterHealSchema.optional(),
});

export const npcHealInputSchema = z.object({ villageId: z.string().nullish() });

export const npcHealOutputSchema = baseServerResponse.extend({
  data: z
    .object({
      curHealth: z.number(),
      money: z.number(),
      regenAt: z.date(),
    })
    .optional(),
});

export type HealerAfterHeal = z.infer<typeof healerAfterHealSchema>;
