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

// Absolute values are kept separate from arithmetic deltas so a saved field is never added.
export const userPatchSchema = z.object({
  primaryElement: z.enum(ElementNames).nullable().optional(),
  secondaryElement: z.enum(ElementNames).nullable().optional(),
  bloodright: z.array(z.object({ skillId: z.string(), cost: z.number() })).optional(),
  bloodrightSpent: z.number().optional(),
  monthlySkillResets: z.object({ month: z.string(), count: z.number() }).optional(),
  maxEnergy: z.number().optional(),
  effectiveMasteries: z
    .object({
      ninjutsuMastery: z.number(),
      genjutsuMastery: z.number(),
      taijutsuMastery: z.number(),
      bukijutsuMastery: z.number(),
      bloodlineMastery: z.number(),
      sageMastery: z.number(),
    })
    .optional(),
});

export const userDeltaResponseSchema = baseServerResponse.extend({
  userDelta: userDeltaSchema.optional(),
  userPatch: userPatchSchema.optional(),
});
