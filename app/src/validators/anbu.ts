import { z } from "zod";
import {
  createReservedNameField,
  looseFactionNameField,
  RESERVED_FACTION_NAMES,
} from "@/validators/reservedName";

export const strictAnbuNameField = createReservedNameField({
  reserved: RESERVED_FACTION_NAMES,
  errorMessage: "This squad name is not allowed.",
});

export const anbuCreateSchema = z.object({
  leaderId: z.string(),
  villageId: z.string(),
  name: strictAnbuNameField,
});

export type AnbuCreateSchema = z.infer<typeof anbuCreateSchema>;

export const anbuRenameSchema = z.object({
  name: looseFactionNameField,
  image: z.string(),
});

export type AnbuRenameSchema = z.infer<typeof anbuRenameSchema>;

/**
 * Numeric changes a guarded squad write committed, applied on top of the cached `anbu.get`
 * result, or the expected numeric baseline it confirmed. The id asserts squad identity.
 */
export const anbuSquadDeltaSchema = z.object({
  id: z.string(),
  points: z.number().optional(),
  espionageLevel: z.number().optional(),
  stealthLevel: z.number().optional(),
});

export type AnbuSquadDelta = z.infer<typeof anbuSquadDeltaSchema>;
