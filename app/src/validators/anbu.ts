import { z } from "zod";
import { CoreVillages, LegacyVillageNames } from "@/drizzle/constants";

const bannedAnbuNames = [
  "Freedom State",
  "Horizon",
  ...CoreVillages,
  ...LegacyVillageNames,
];

const anbuNameField = z
  .string()
  .trim()
  .min(3)
  .max(88)
  .regex(/^[a-zA-Z0-9_]+$/, {
    error: "Alphanumeric and underscores only",
  })
  .refine(
    (name) =>
      !bannedAnbuNames.some((banned) => banned.toLowerCase() === name.toLowerCase()),
    {
      error: "This squad name is not allowed.",
    },
  );

export const anbuCreateSchema = z.object({
  leaderId: z.string(),
  villageId: z.string(),
  name: anbuNameField,
});

export type AnbuCreateSchema = z.infer<typeof anbuCreateSchema>;

export const anbuRenameSchema = z.object({
  name: anbuNameField,
  image: z.string(),
});

export type AnbuRenameSchema = z.infer<typeof anbuRenameSchema>;

export const anbuEditSchema = anbuRenameSchema.extend({ squadId: z.string() });

export type AnbuEditSchema = z.infer<typeof anbuEditSchema>;
