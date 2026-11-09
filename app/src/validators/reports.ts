import { z } from "zod";
import { TimeUnits } from "@/drizzle/constants";
import type { UserCard } from "@/queries/userColumns";

export const systems = [
  "forum_comment",
  "conversation_comment",
  "user_profile",
  "concept_art",
  "battle_log",
] as const;

export const userReportSchema = z.object({
  system: z.enum(systems),
  system_id: z.string(),
  reported_userId: z.string(),
  reason: z.string().min(1).max(10000),
});

export type UserReportSchema = z.infer<typeof userReportSchema>;

export const reportCommentSchema = z.object({
  comment: z.string().min(10).max(5000),
  object_id: z.string(),
  banTime: z.number().min(0).max(100),
  banTimeUnit: z.enum(TimeUnits),
});

export type ReportCommentSchema = z.infer<typeof reportCommentSchema>;

export const userReviewSchema = z.object({
  staffUserId: z.string(),
  review: z.string(),
  positive: z.boolean().optional(),
});
export type UserReviewSchema = z.infer<typeof userReviewSchema>;

export type AdditionalContext = UserCard & {
  authorId?: string;
  content: string;
  createdAt: Date;
};

export const modBotPerformanceSchema = z.object({
  days: z.union([z.literal(7), z.literal(30), z.literal(90)]).default(30),
  interval: z.enum(["daily", "weekly"]).default("daily"),
  surface: z.enum(["all", "conversation", "forum", "profile", "other"]).default("all"),
});
export type ModBotPerformanceInput = z.infer<typeof modBotPerformanceSchema>;
