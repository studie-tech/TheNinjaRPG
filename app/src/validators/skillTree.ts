import { z } from "zod";
import { SkillTreePathTypes } from "@/drizzle/constants";

export const skillTreeFilteringSchema = z.object({
  pathType: z.enum(SkillTreePathTypes).optional(),
  bloodlineId: z.string().min(1).optional(),
  name: z.string().max(256).optional(),
  effect: z.array(z.string()).optional(),
  tier: z.number().min(1).max(10).nullable().optional(),
  costSkillPoints: z.number().min(1).nullable().optional(),
  hidden: z.boolean().optional(),
  folderId: z.string().optional(),
});

export type SkillTreeFilteringSchema = z.infer<typeof skillTreeFilteringSchema>;

export const skillTreeFolderSchema = z.object({
  name: z.string().min(1).max(191),
  image: z.string().max(512).optional(),
  description: z.string().optional(),
  hidden: z.boolean().optional(),
  order: z.int().optional(),
});

export type SkillTreeFolderSchema = z.infer<typeof skillTreeFolderSchema>;

export const bloodrightTierSchema = z.object({ skillId: z.string() });
export const createSkillSchema = z
  .object({ bloodlineId: z.string().min(1).optional() })
  .optional();
