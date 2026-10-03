import { z } from "zod";
import { CombatStatNames, MasteryNames, TrainingSpeeds } from "@/drizzle/constants";

// Input schemas
export const startTrainingInputSchema = z.object({
  stat: z.enum(CombatStatNames),
  energy: z.number().finite().positive(),
  guess: z.string().optional(),
});

export const startMasteryTrainingInputSchema = z.object({
  stat: z.enum(MasteryNames),
});

export const stopTrainingInputSchema = z.object({
  guess: z.string().optional(),
});

export const updateTrainingSpeedInputSchema = z.object({
  speed: z.enum(TrainingSpeeds),
});

export const trainingLogInputSchema = z.object({
  userId: z.string(),
});

// Output data schemas
export const startTrainingDataSchema = z.object({
  experience: z.number(),
  curEnergy: z.number(),
  stat: z.enum(CombatStatNames),
  amount: z.number(),
});

export const startMasteryTrainingDataSchema = z.object({
  currentlyTrainingMastery: z.enum(MasteryNames),
  masteryTrainingStartedAt: z.date(),
});

export const stopMasteryTrainingDataSchema = z.object({
  /** Mastery actually added, after the rank cap */
  amount: z.number(),
  currentlyTrainingMastery: z.enum(MasteryNames),
  /** minutes_training credited to quests; the stored questData changed when above 0 */
  creditedMinutes: z.number(),
});
