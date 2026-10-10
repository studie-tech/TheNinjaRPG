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
import { statFilters } from "@/libs/train";
import { JutsuValidator } from "@/validators/combat";

// Basic name/level search
export const searchJutsuSchema = z.object({
  name: z.string().min(0).max(256),
  requiredLevel: z.number().min(0).max(150).optional(),
});
export type SearchJutsuSchema = z.infer<typeof searchJutsuSchema>;

export const getEvolutionsSchema = z.object({
  jutsuId: z.string(),
});

export const evolveJutsuSchema = z.object({
  userJutsuId: z.string(),
  evolutionJutsuId: z.string(),
});

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
  name: z.string().min(0).max(256).optional(),
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
  excludedJutsuTypes: z.array(z.string()).optional(),
  excludedClassifications: z.array(z.string()).optional(),
  excludedRarities: z.array(z.string()).optional(),
  excludedRanks: z.array(z.string()).optional(),
  excludedMethods: z.array(z.string()).optional(),
  excludedTargets: z.array(z.string()).optional(),
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

/**
 * Base schema for reskins
 */
export const baseReskinSchema = z.object({
  name: z.string().trim().min(0).max(100).optional(),
  description: z.string().min(0).max(1000).optional(),
  battleDescription: z.string().min(0).max(1000).optional(),
  image: z.string().min(1).max(191).optional(),
});

/**
 * Schema for creating or updating a jutsu reskin.
 * Shared between client (react-hook-form) and server (tRPC input).
 * - image is optional from the client; router defaults to the base jutsu image when omitted.
 */
export const jutsuReskinCreateSchema = baseReskinSchema.extend({
  jutsuId: z.string(),
});

export type JutsuReskinCreateSchema = z.infer<typeof jutsuReskinCreateSchema>;

/**
 * Schema for editing an existing jutsu reskin by staff/content.
 * Mirrors create fields, but includes a mandatory reason field for audit/AI validation.
 * - username / jutsuId: the owner and base jutsu the reskin is assigned to.
 * - attached: whether the owner's copy of that jutsu uses the reskin.
 */
export const jutsuReskinUpdateSchema = baseReskinSchema.extend({
  username: z.string().trim().min(1).max(191),
  jutsuId: z.string().min(1),
  attached: z.boolean(),
  reason: z.string().min(10),
});

export const getJutsuReskinSchema = z.object({ reskinId: z.string() });
export const updateJutsuReskinSchema = getJutsuReskinSchema.extend({
  data: jutsuReskinUpdateSchema,
});

export type JutsuReskinUpdateSchema = z.infer<typeof jutsuReskinUpdateSchema>;

export const createLinkedJutsuSchema = z.object({
  parentId: z.string().min(1),
  bloodlineReskinId: z.string().min(1),
});
export type CreateLinkedJutsuSchema = z.infer<typeof createLinkedJutsuSchema>;

export const updateJutsuSchema = z.object({ id: z.string(), data: JutsuValidator });
