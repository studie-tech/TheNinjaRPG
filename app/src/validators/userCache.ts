import { z } from "zod";
import { baseServerResponse } from "@/validators/base";

export const userDeltaSchema = z.object({
  money: z.number().optional(),
  reputationPoints: z.number().optional(),
  seichiSilver: z.number().optional(),
  extraItemSlots: z.number().optional(),
  extraJutsuSlots: z.number().optional(),
  bloodrightSpent: z.number().optional(),
});

export type UserDelta = z.infer<typeof userDeltaSchema>;

export const userDeltaResponseSchema = baseServerResponse.extend({
  userDelta: userDeltaSchema.optional(),
});

export const bloodrightResponseSchema = baseServerResponse.extend({
  userDelta: userDeltaSchema.optional(),
  data: z
    .object({
      bloodright: z.array(z.object({ skillId: z.string(), cost: z.number() })),
      bloodrightSpent: z.number().optional(),
      monthlySkillResets: z.object({ month: z.string(), count: z.number() }).optional(),
    })
    .optional(),
});
