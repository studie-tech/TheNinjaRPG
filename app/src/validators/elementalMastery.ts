import { z } from "zod";
import {
  BasicElementName,
  ELEMENTAL_MASTERY_CAP,
  TrainingSpeeds,
} from "@/drizzle/constants";

export const startElementalTrainingSchema = z.object({
  element: z.enum(BasicElementName),
  speed: z.enum(TrainingSpeeds),
});
export const collectElementalTrainingSchema = z.object({
  element: z.enum(BasicElementName),
  startedAt: z.date(),
  guess: z.string().optional(),
});
export const investElementalExperienceSchema = z.object({
  element: z.enum(BasicElementName),
  amount: z.number().int().positive().max(ELEMENTAL_MASTERY_CAP),
});
export const selectTrainedElementSchema = z.object({
  element: z.enum(BasicElementName).nullable(),
});
