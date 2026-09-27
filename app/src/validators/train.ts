import { z } from "zod";
import { CombatStatNames, MasteryNames, TrainingSpeeds } from "@/drizzle/constants";
import { QuestTracker } from "@/validators/objectives";

// Input schemas
export const startTrainingInputSchema = z.object({
  stat: z.enum(CombatStatNames),
});

export const startMasteryTrainingInputSchema = z.object({
  stat: z.enum(MasteryNames),
});

export const stopTrainingInputSchema = z.object({
  guess: z.string().optional(),
  villageId: z.string().nullable(),
});

export const updateTrainingSpeedInputSchema = z.object({
  speed: z.enum(TrainingSpeeds),
});

export const trainingLogInputSchema = z.object({
  userId: z.string(),
});

// Output data schemas
export const startTrainingDataSchema = z.object({
  currentlyTraining: z.enum(CombatStatNames),
  trainingStartedAt: z.date(),
});

export const startMasteryTrainingDataSchema = z.object({
  currentlyTrainingMastery: z.enum(MasteryNames),
  masteryTrainingStartedAt: z.date(),
});

export const stopTrainingDataSchema = z.object({
  experience: z.number(),
  currentlyTraining: z.enum(CombatStatNames),
  questData: z.array(QuestTracker),
});

export const stopMasteryTrainingDataSchema = z.object({
  amount: z.number(),
  currentlyTrainingMastery: z.enum(MasteryNames),
  questData: z.array(QuestTracker),
});
