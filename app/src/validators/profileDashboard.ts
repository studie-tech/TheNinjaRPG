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

export type DashboardContentSummary = z.infer<typeof dashboardContentSummarySchema>;
