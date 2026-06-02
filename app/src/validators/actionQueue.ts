import { z } from "zod";
import { ActionQueueTypes, UserStatNames } from "@/drizzle/constants";

export const addJutsuQueueSchema = z.object({
  jutsuId: z.string(),
});

export const addStatQueueSchema = z.object({
  stat: z.enum(UserStatNames),
});

export const addCraftQueueSchema = z.object({
  itemId: z.string(),
  quantity: z.int().min(1).max(10).prefault(1),
});

export const removeActionQueueSchema = z.object({
  id: z.string(),
});

export const queuedMaterialRefundSchema = z.object({
  userItemId: z.string(),
  itemId: z.string(),
  consumeQuantity: z.number(),
  quantityAfterPayment: z.number(),
});

export type QueuedMaterialRefund = z.infer<typeof queuedMaterialRefundSchema>;

export const actionQueueEntrySchema = z.object({
  id: z.string(),
  queueType: z.enum(ActionQueueTypes),
  position: z.number(),
  jutsuId: z.string().nullable(),
  stat: z.enum(UserStatNames).nullable(),
  itemId: z.string().nullable(),
  quantity: z.number(),
  targetLevel: z.number().nullable(),
  label: z.string(),
  costLabel: z.string().nullable(),
  durationLabel: z.string().nullable(),
  createdAt: z.date(),
});

export type ActionQueueEntry = z.infer<typeof actionQueueEntrySchema>;
