import { z } from "zod";
import { ActivityQueueTypes, TrainingSpeeds, UserStatNames } from "@/drizzle/constants";

export const queueMaterialRefundSchema = z.object({
  itemId: z.string(),
  quantity: z.number().int().positive(),
  userItemId: z.string(),
});

export const activityQueueEntrySchema = z.object({
  id: z.string(),
  position: z.number().int(),
  stat: z.enum(UserStatNames).nullable(),
  jutsuId: z.string().nullable(),
  jutsuName: z.string().nullable(),
  itemId: z.string().nullable(),
  itemName: z.string().nullable(),
  quantity: z.number().int(),
  moneyPaid: z.number().int(),
  costBasisLevel: z.number().int().nullable(),
  targetLevel: z.number().int().nullable(),
  trainTimeMs: z.number().int().nullable(),
  trainingSpeed: z.enum(TrainingSpeeds).nullable(),
  craftSeconds: z.number().int().nullable(),
  canCancel: z.boolean(),
});

export const activityQueueStatusSchema = z.object({
  type: z.enum(ActivityQueueTypes),
  maxQueued: z.number().int(),
  maxPipeline: z.number().int(),
  usedQueued: z.number().int(),
  active: z
    .object({
      label: z.string(),
      finishAt: z.date().nullable(),
      stat: z.enum(UserStatNames).optional(),
      jutsuId: z.string().optional(),
      itemId: z.string().optional(),
      targetLevel: z.number().int().optional(),
    })
    .nullable(),
  queued: z.array(activityQueueEntrySchema),
});

export type ActivityQueueEntry = z.infer<typeof activityQueueEntrySchema>;
export type ActivityQueueStatus = z.infer<typeof activityQueueStatusSchema>;
