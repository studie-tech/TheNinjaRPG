import { z } from "zod";
import {
  StaffApplicationStates,
  StaffApplicationTargetRoles,
} from "@/drizzle/constants";

export const createApplicationSchema = z.object({
  targetRole: z.enum(StaffApplicationTargetRoles),
  motivation: z.string().min(10).max(4000),
});
export type CreateApplicationSchema = z.infer<typeof createApplicationSchema>;

// Infinite filtering for applications list
export const listApplicationsInfiniteSchema = z.object({
  cursor: z.number().nullish(),
  limit: z.number().min(1).max(100).prefault(30),
  onlyMine: z.boolean().optional(),
  username: z.string().optional(),
  targetRole: z.enum(StaffApplicationTargetRoles).optional(),
  state: z.enum(StaffApplicationStates).optional(),
});
export type ListApplicationsInfiniteSchema = z.infer<
  typeof listApplicationsInfiniteSchema
>;
