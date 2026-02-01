import { z } from "zod";

export const skillTreeFilteringSchema = z.object({
  name: z.string().min(0).max(256).optional(),
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
  order: z.number().int().optional(),
});

export type SkillTreeFolderSchema = z.infer<typeof skillTreeFolderSchema>;
