import { z } from "zod";
import { CovertTrainingTypes } from "@/drizzle/constants";

// Input schemas
export const useSensoryInputSchema = z.object({
  sector: z.number().int(),
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
});

export const useSensoryDataSchema = z.object({
  detectedUsers: z.array(detectedUserSchema),
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
