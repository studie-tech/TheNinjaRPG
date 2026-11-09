import { z } from "zod";
import { SKILL_TREE_MAX_TIER, SkillTreePathTypes } from "@/drizzle/constants";

export const skillTreeFilteringSchema = z.object({
  pathType: z.enum(SkillTreePathTypes).optional(),
  bloodlineId: z.string().min(1).optional(),
  name: z.string().max(256).optional(),
  effect: z.array(z.string()).optional(),
  tier: z.number().min(1).max(SKILL_TREE_MAX_TIER).nullable().optional(),
  costSkillPoints: z.number().min(1).nullable().optional(),
  hidden: z.boolean().optional(),
  folderId: z.string().optional(),
});

export type SkillTreeFilteringSchema = z.infer<typeof skillTreeFilteringSchema>;

export const bloodrightTierSchema = z.object({ skillId: z.string() });
