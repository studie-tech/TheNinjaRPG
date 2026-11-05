import { z } from "zod";
import { PET_TASK_MAX_MINUTES } from "@/drizzle/constants";
import { makeCappedNullableNumber } from "@/validators/base";
import { petSelectionSchema } from "@/validators/pets";

/** One accepted profession attempt; millisecond identities distinguish reused history rows. */
export const petTaskSchema = petSelectionSchema.extend({
  questHistoryId: z.string().min(1).max(191),
  questId: z.string().min(1).max(191),
  startedAt: z.number().int().nonnegative(),
  questVersion: z.number().int().nonnegative(),
  finishesAt: z.number().int().positive(),
});
export type PetTask = z.infer<typeof petTaskSchema>;

/** The displayed attempt identity prevents a stale cancel or claim from affecting a later task. */
export const petTaskActionSchema = petTaskSchema.pick({
  petId: true,
  questHistoryId: true,
  startedAt: true,
});
/** Dispatch accepts catalogue IDs only; occupation, duration and availability are server-owned. */
export const startPetTaskSchema = petSelectionSchema.extend({
  questId: z.string().min(1).max(191),
});
/** Blank means disabled; Content explicitly opts a hunting or gathering contract into delegation. */
export const petTaskMinutesSchema = makeCappedNullableNumber(PET_TASK_MAX_MINUTES, 1);
