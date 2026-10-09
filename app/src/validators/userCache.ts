import { z } from "zod";
import { baseServerResponse } from "@/validators/base";

export const userBalanceDataSchema = z.object({
  money: z.number(),
  bank: z.number(),
  reputationPoints: z.number(),
  seichiSilver: z.number(),
});

export const userBalanceResponseSchema = baseServerResponse.extend({
  data: userBalanceDataSchema.optional(),
});

export const extraItemSlotResponseSchema = baseServerResponse.extend({
  data: z
    .object({ reputationPoints: z.number(), extraItemSlots: z.number() })
    .optional(),
});

export const extraJutsuSlotResponseSchema = baseServerResponse.extend({
  data: z
    .object({ reputationPoints: z.number(), extraJutsuSlots: z.number() })
    .optional(),
});

export const jutsuOrderResponseSchema = baseServerResponse.extend({
  data: z.object({ jutsuIds: z.array(z.string()) }).optional(),
});

export const jutsuLoadoutResponseSchema = baseServerResponse.extend({
  data: z
    .object({
      jutsuLoadout: z.string(),
      loadout: z.object({ jutsuIds: z.array(z.string()) }),
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
