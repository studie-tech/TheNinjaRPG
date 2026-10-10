import { z } from "zod";
import { ElementNames } from "@/drizzle/constants";
import { baseServerResponse } from "@/validators/base";

export const userDeltaSchema = z.object({
  money: z.number().optional(),
  earnedExperience: z.number().optional(),
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

export const bloodrightResponseSchema = userDeltaResponseSchema.extend({
  data: z
    .object({
      bloodright: z.array(z.object({ skillId: z.string(), cost: z.number() })),
      bloodrightSpent: z.number().optional(),
      monthlySkillResets: z.object({ month: z.string(), count: z.number() }).optional(),
    })
    .optional(),
});

export const elementRerollResponseSchema = userDeltaResponseSchema.extend({
  data: z
    .object({
      primaryElement: z.enum(ElementNames).nullable(),
      secondaryElement: z.enum(ElementNames).nullable(),
    })
    .optional(),
});

export const resetSkillPointsResponseSchema = userDeltaResponseSchema.extend({
  data: z
    .object({
      monthlySkillResets: z.object({ month: z.string(), count: z.number() }),
      maxEnergy: z.number(),
      effectiveMasteries: z.object({
        ninjutsuMastery: z.number(),
        genjutsuMastery: z.number(),
        taijutsuMastery: z.number(),
        bukijutsuMastery: z.number(),
        bloodlineMastery: z.number(),
        sageMastery: z.number(),
      }),
    })
    .optional(),
});
