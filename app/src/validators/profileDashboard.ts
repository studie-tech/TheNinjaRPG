import { z } from "zod";

export const dashboardContentCategorySchema = z.enum([
  "events",
  "missions",
  "story",
  "battlePyramids",
]);

export const dashboardAvailabilitySchema = z.enum(["available", "travel", "locked"]);

export const dashboardContentSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  image: z.string().nullable(),
  category: dashboardContentCategorySchema,
  questType: z.string(),
  rank: z.string(),
  location: z.string(),
  destination: z.string(),
  availability: dashboardAvailabilitySchema,
  availabilityReason: z.string().nullable(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
});

export const dashboardRaidRewardSchema = z.object({
  raidId: z.string(),
  raidName: z.string(),
  claimableCount: z.number().int().nonnegative(),
  damageDealt: z.number().nonnegative(),
});

export const profileDashboardSchema = z.object({
  serverTime: z.date(),
  content: z.array(dashboardContentSummarySchema),
  raidRewards: z.array(dashboardRaidRewardSchema),
});

export type ProfileDashboard = z.infer<typeof profileDashboardSchema>;
export type DashboardContentSummary = z.infer<typeof dashboardContentSummarySchema>;
