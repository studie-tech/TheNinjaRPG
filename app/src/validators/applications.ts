import { z } from "zod";
import { StaffApplicationTargetRoles } from "@/drizzle/constants";

export const createApplicationSchema = z.object({
  targetRole: z.enum(StaffApplicationTargetRoles),
  motivation: z.string().min(10).max(4000),
});
export type CreateApplicationSchema = z.infer<typeof createApplicationSchema>;
