import { z } from "zod";
import {
  CombatStatNames,
  MasteryNames,
  QUEUE_WAITING_SLOTS,
  TrainingSpeeds,
} from "@/drizzle/constants";
import { baseServerResponse } from "@/validators/base";

export const energyTrainingQueueEntrySchema = z.object({
  stat: z.enum(CombatStatNames),
  energy: z.number().finite().positive(),
});
export type EnergyTrainingQueueEntry = z.infer<typeof energyTrainingQueueEntrySchema>;

export const updateEnergyTrainingQueueInputSchema = z.object({
  entries: z.array(energyTrainingQueueEntrySchema).max(1 + QUEUE_WAITING_SLOTS.GOLD),
  expectedEntries: z
    .array(energyTrainingQueueEntrySchema)
    .max(1 + QUEUE_WAITING_SLOTS.GOLD),
  guess: z.string().optional(),
});

// Input schemas
export const startTrainingInputSchema = z.object({
  stat: z.enum(CombatStatNames),
  // Amounts of zero or less are rejected by the procedure with a user-facing message
  // (trainingEnergyMessage), which a page from before that check still displays.
  energy: z.number().finite(),
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

export const startTrainingOutputSchema = baseServerResponse.extend({
  data: startTrainingDataSchema.optional(),
});

export const startMasteryTrainingOutputSchema = baseServerResponse.extend({
  data: startMasteryTrainingDataSchema.optional(),
});

export const stopMasteryTrainingOutputSchema = baseServerResponse.extend({
  data: stopMasteryTrainingDataSchema.optional(),
});
