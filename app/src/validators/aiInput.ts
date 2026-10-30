import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { AI_MAX_HEALTH, ElementNames } from "@/drizzle/constants";
import { userData } from "@/drizzle/schema";
import { MAX_STORED_POOL, maxPoolsMultiplier } from "@/libs/profile";
import {
  AllTags,
  rejectActivityBonuses,
  SuperRefineEffects,
  SuperRefinePassiveEffects,
} from "@/validators/combat";

export const insertAiSchema = createInsertSchema(userData)
  .omit({
    warMission: true,
    bracketImmunityPausedAt: true,
    homeFurnitureRevision: true,
    occupationSignupAt: true,
    masteryTrainingStartedAt: true,
    currentlyTrainingMastery: true,
    elementalTrainingStartedAt: true,
    currentlyTrainingElement: true,
    deletionAt: true,
    travelFinishAt: true,
    questData: true,
    occupation: true,
    stealthActivatedAt: true,
    stealthCooldownAt: true,
    lastSensoryAt: true,
    covertTrainingType: true,
    covertTrainingStartedAt: true,
    covertTrainingMinutes: true,
  })
  .extend(
    z.object({
      jutsus: z.array(z.string()).optional(),
      items: z
        .array(
          z.object({
            ids: z.array(z.string()).prefault([]),
            number: z.coerce.number(),
          }),
        )
        .optional(),
      primaryElement: z.enum([...ElementNames, ""]).nullish(),
      secondaryElement: z.enum([...ElementNames, ""]).nullish(),
      level: z.coerce.number().min(1).max(200),
      regeneration: z.coerce.number().min(1).max(100),
      offence: z.coerce.number().min(10),
      defence: z.coerce.number().min(10),
      ninjutsuMastery: z.coerce.number().min(10),
      genjutsuMastery: z.coerce.number().min(10),
      taijutsuMastery: z.coerce.number().min(10),
      bukijutsuMastery: z.coerce.number().min(10),
      bloodlineMastery: z.coerce.number().min(10),
      sageMastery: z.coerce.number().min(10),
      statsMultiplier: z.coerce.number().min(1).max(50),
      poolsMultiplier: z.coerce.number().min(1).max(50),
      aiHealthOverride: z
        .preprocess(
          (value) => (value === "" ? null : value),
          z.coerce.number().int().min(1).max(AI_MAX_HEALTH).nullish(),
        )
        .transform((value) => value ?? null),
      strength: z.coerce.number().min(10),
      intelligence: z.coerce.number().min(10),
      willpower: z.coerce.number().min(10),
      speed: z.coerce.number().min(10),
      isSummon: z.coerce.boolean(),
      effects: z
        .array(AllTags)
        .superRefine(SuperRefineEffects)
        .superRefine(SuperRefinePassiveEffects)
        .superRefine(rejectActivityBonuses),
    }).shape,
  )
  .superRefine((data, ctx) => {
    const allowed = maxPoolsMultiplier(data.level);
    if (data.poolsMultiplier > allowed) {
      ctx.addIssue({
        code: "custom",
        path: ["poolsMultiplier"],
        message: `Pool modifier ${data.poolsMultiplier} at level ${data.level} would push HP/CP/SP above the maximum of ${MAX_STORED_POOL.toLocaleString("en-US")}. Use at most ${allowed} at this level.`,
      });
    }
  });
export type InsertAiSchema = z.infer<typeof insertAiSchema>;
export type InsertAiSchemaInput = z.input<typeof insertAiSchema>;
