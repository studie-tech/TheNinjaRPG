import { z } from "zod";
import { CovertTrainingTypes } from "@/drizzle/constants";

// Input schemas
export const useSensoryInputSchema = z.object({
  sector: z.int(),
});

export const trainInputSchema = z.object({
  type: z.enum(CovertTrainingTypes),
  minutes: z.number().min(1).max(60),
});

// Output data schemas
export const detectedUserSchema = z.object({
  userId: z.string(),
  username: z.string(),
  longitude: z.number(),
  latitude: z.number(),
  villageId: z.string().nullable(),
  level: z.number(),
});

export const activateStealthDataSchema = z.object({
  stealthActivatedAt: z.date(),
});

export const useSensoryDataSchema = z.object({
  detectedUsers: z.array(detectedUserSchema),
  lastSensoryAt: z.date(),
});

export const startTrainDataSchema = z.object({
  covertTrainingType: z.enum(CovertTrainingTypes),
  covertTrainingFinishAt: z.date(),
  covertTrainingGain: z.number(),
});

export const stopTrainDataSchema = z.object({
  gained: z.number(),
  newValue: z.number(),
});
