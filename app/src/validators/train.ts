import { z } from "zod";
import {
  CombatStatNames,
  TimedMasteryNames,
  TrainingSpeeds,
} from "@/drizzle/constants";

export const energyTrainingQueueEntrySchema = z.object({
  stat: z.enum(CombatStatNames),
  energy: z.number().finite().positive(),
});
export type EnergyTrainingQueueEntry = z.infer<typeof energyTrainingQueueEntrySchema>;

export const masteryTrainingQueueEntrySchema = z.object({
  stat: z.enum(TimedMasteryNames),
  speed: z.enum(TrainingSpeeds),
});
export type MasteryTrainingQueueEntry = z.infer<typeof masteryTrainingQueueEntrySchema>;

/** A material stack taken by a queued craft, returned to its stack on cancellation. */
export const craftingQueueMaterialSchema = z.object({
  userItemId: z.string(),
  itemId: z.string(),
  quantity: z.number().int().positive(),
  storedAtHome: z.boolean(),
  /** Display name, so the queue view needs no item lookup */
  name: z.string().optional(),
});
export type CraftingQueueMaterial = z.infer<typeof craftingQueueMaterialSchema>;

export const cancelQueuedJobInputSchema = z.object({ queueId: z.string() });

export const queuedJobSchema = z.object({
  id: z.string(),
  durationSeconds: z.number(),
  startsAt: z.date(),
  finishesAt: z.date(),
});

// Input schemas
export const startTrainingInputSchema = z.object({
  stat: z.enum(CombatStatNames),
  // The procedure rejects non-positive amounts with a user-facing errorResponse.
  energy: z.number().finite(),
  guess: z.string().optional(),
});
