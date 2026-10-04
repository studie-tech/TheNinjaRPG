import { z } from "zod";

export const dashboardContentGroups = [
  "missions",
  "story",
  "events",
  "errands",
  "medical",
  "pvp",
  "battlePyramids",
  "raids",
] as const;
export type DashboardContentGroup = (typeof dashboardContentGroups)[number];
export const dashboardContentPrioritySchema = z
  .array(z.enum(dashboardContentGroups))
  .length(dashboardContentGroups.length)
  .refine((groups) => new Set(groups).size === dashboardContentGroups.length, {
    message: "Include each content type exactly once.",
  });
