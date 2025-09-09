import { z } from "zod";
import { statFilters } from "@/libs/train";
import { LetterRanks } from "@/drizzle/constants";
import { StatTypes } from "@/drizzle/constants";

export const bloodlineFilteringSchema = z.object({
  name: z.string().min(0).max(256).optional(),
  classification: z.enum(StatTypes).optional(),
  village: z.string().optional(),
  stat: z.array(z.enum(statFilters)).optional(),
  effect: z.array(z.string()).optional(),
  rank: z.enum(LetterRanks).optional(),
  element: z.array(z.string()).optional(),
  hidden: z.boolean().optional(),
});

export type BloodlineFilteringSchema = z.infer<typeof bloodlineFilteringSchema>;

/** Base schema for reskins */
export const baseReskinSchema = z.object({
  name: z.string().min(0).max(100).optional(),
  description: z.string().min(0).max(1000).optional(),
  image: z.string().min(1).max(191).optional(),
});

/** Schema for creating a bloodline reskin (staff only). */
export const bloodlineReskinCreateSchema = baseReskinSchema.extend({
  bloodlineId: z.string(),
});
export type BloodlineReskinCreateSchema = z.infer<typeof bloodlineReskinCreateSchema>;

/** Schema for updating a bloodline reskin (staff only, includes reason). */
export const bloodlineReskinUpdateSchema = baseReskinSchema.extend({
  reason: z.string().min(5).max(500),
});
export type BloodlineReskinUpdateSchema = z.infer<typeof bloodlineReskinUpdateSchema>;
