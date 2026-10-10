import { z } from "zod";
import {
  CombatStatNames,
  MasteryNames,
  QUEUE_WAITING_SLOTS,
  TrainingSpeeds,
} from "@/drizzle/constants";

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

export const masteryTrainingQueueEntrySchema = z.object({
  stat: z.enum(MasteryNames),
  speed: z.enum(TrainingSpeeds),
});
export type MasteryTrainingQueueEntry = z.infer<typeof masteryTrainingQueueEntrySchema>;

export const updateMasteryTrainingQueueInputSchema = z.object({
  entries: z.array(masteryTrainingQueueEntrySchema).max(QUEUE_WAITING_SLOTS.GOLD),
  expectedEntries: z
    .array(masteryTrainingQueueEntrySchema)
    .max(QUEUE_WAITING_SLOTS.GOLD),
});

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

const queuedJobSchema = z.object({
  id: z.string(),
  durationSeconds: z.number(),
  startsAt: z.date(),
  finishesAt: z.date(),
});
export type QueuedJob = z.infer<typeof queuedJobSchema>;

export const jutsuTrainingQueueOutputSchema = z.object({
  capacity: z.number(),
  waiting: z.array(
    queuedJobSchema.extend({
      jutsuId: z.string(),
      name: z.string(),
      image: z.string().nullable(),
      reservedRyo: z.number(),
      /** The level this entry trains the jutsu to */
      level: z.number(),
    }),
  ),
});

export const craftingQueueOutputSchema = z.object({
  capacity: z.number(),
  waiting: z.array(
    queuedJobSchema.extend({
      itemId: z.string(),
      name: z.string(),
      image: z.string().nullable(),
      quantity: z.number(),
      materials: z.array(z.object({ name: z.string(), quantity: z.number() })),
    }),
  ),
});

// Input schemas
export const startTrainingInputSchema = z.object({
  stat: z.enum(CombatStatNames),
  // The procedure rejects non-positive amounts with a user-facing errorResponse.
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
