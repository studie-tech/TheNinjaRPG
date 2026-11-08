import { z } from "zod";
import {
  AttackMethods,
  AttackTargets,
  BattleUsageTypes,
  JutsuTypes,
  LetterRanks,
  StatTypes,
  UserRanks,
} from "@/drizzle/constants";
import { reskinBaseSchema } from "@/validators/bloodline";
import { statFilters } from "@/validators/statFilters";

/**
 * Full filtering schema for jutsu,
 * including both "include" and "exclude" fields.
 */
export const jutsuFilteringSchema = z.object({
  // -----------------
  // "Include" fields
  // -----------------
  appear: z.string().optional(),
  appearSfx: z.string().optional(),
  bloodline: z.string().optional(),
  classification: z.enum(StatTypes).optional(),
  disappear: z.string().optional(),
  disappearSfx: z.string().optional(),
  effect: z.array(z.string()).optional(),
  element: z.array(z.string()).optional(),
  jutsuType: z.array(z.enum(JutsuTypes)).optional(),
  method: z.enum(AttackMethods).optional(),
  name: z.string().max(256).optional(),
  rank: z.array(z.enum(UserRanks)).optional(),
  requiredLevel: z.coerce.number().optional(),
  rarity: z.enum(LetterRanks).optional(),
  stat: z.array(z.enum(statFilters)).optional(),
  static: z.string().optional(),
  target: z.enum(AttackTargets).optional(),
  hidden: z.boolean().optional(),
  villageId: z.string().nullable().optional(),
  battleUsageType: z.enum(BattleUsageTypes).optional(),
  actionCostPerc: z.number().optional(),

  // ------------------------------
  // "Exclusion" fields
  // ------------------------------
  excludedJutsuTypes: z.array(z.enum(JutsuTypes)).optional(),
  excludedClassifications: z.array(z.enum(StatTypes)).optional(),
  excludedRarities: z.array(z.string()).optional(),
  excludedRanks: z.array(z.enum(UserRanks)).optional(),
  excludedMethods: z.array(z.enum(AttackMethods)).optional(),
  excludedTargets: z.array(z.enum(AttackTargets)).optional(),
  excludedAppear: z.array(z.string()).optional(),
  excludedAppearSfx: z.array(z.string()).optional(),
  excludedDisappear: z.array(z.string()).optional(),
  excludedDisappearSfx: z.array(z.string()).optional(),
  excludedStatic: z.array(z.string()).optional(),
  excludedElements: z.array(z.string()).optional(),
  excludedEffects: z.array(z.string()).optional(),
  excludedStats: z.array(z.string()).optional(),
});

export type JutsuFilteringSchema = z.infer<typeof jutsuFilteringSchema>;

/** Keep the active loadout visible while filtering the rest of the owned inventory. */
export const userJutsuFilteringSchema = jutsuFilteringSchema.extend({
  includeEquipped: z.boolean().optional(),
});
export type UserJutsuFilteringSchema = z.infer<typeof userJutsuFilteringSchema>;

/**
 * Base schema for reskins
 */
export const jutsuReskinBaseSchema = reskinBaseSchema.extend({
  battleDescription: z.string().max(1000).optional(),
});

/**
 * Schema for creating or updating a jutsu reskin.
 * Shared between client (react-hook-form) and server (tRPC input).
 * - image is optional from the client; router defaults to the base jutsu image when omitted.
 */
export const jutsuReskinCreateSchema = jutsuReskinBaseSchema.extend({
  jutsuId: z.string(),
});

export type JutsuReskinCreateSchema = z.infer<typeof jutsuReskinCreateSchema>;

/**
 * Schema for editing an existing jutsu reskin by staff/content.
 * Mirrors create fields, but includes a mandatory reason field for audit/AI validation.
 * - username / jutsuId: the owner and base jutsu the reskin is assigned to.
 * - attached: whether the owner's copy of that jutsu uses the reskin.
 */
export const jutsuReskinUpdateSchema = jutsuReskinBaseSchema.extend({
  username: z.string().trim().min(1).max(191),
  jutsuId: z.string().min(1),
  attached: z.boolean(),
  reason: z.string().min(10),
});

export type JutsuReskinUpdateSchema = z.infer<typeof jutsuReskinUpdateSchema>;

export const createLinkedJutsuSchema = z.object({
  parentId: z.string().min(1),
  bloodlineReskinId: z.string().min(1),
});
export type CreateLinkedJutsuSchema = z.infer<typeof createLinkedJutsuSchema>;
