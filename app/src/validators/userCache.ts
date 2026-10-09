import { z } from "zod";
import { baseServerResponse } from "@/validators/base";

export const userBalanceResponseSchema = baseServerResponse.extend({
  data: z
    .object({
      money: z.number(),
      bank: z.number(),
      reputationPoints: z.number(),
      seichiSilver: z.number(),
    })
    .optional(),
});

export const bloodrightResponseSchema = baseServerResponse.extend({
  data: z
    .object({
      bloodright: z.array(z.object({ skillId: z.string(), cost: z.number() })),
      bloodrightSpent: z.number(),
      monthlySkillResets: z.object({ month: z.string(), count: z.number() }),
      seichiSilver: z.number(),
      reputationPoints: z.number(),
    })
    .optional(),
});
