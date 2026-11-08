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

/** Blank means disabled; Content explicitly opts a hunting or gathering contract into delegation. */
export const petTaskMinutesSchema = makeCappedNullableNumber(PET_TASK_MAX_MINUTES, 1);
