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

export const anbuEditSchema = anbuRenameSchema.extend({ squadId: z.string() });

export type AnbuEditSchema = z.infer<typeof anbuEditSchema>;
