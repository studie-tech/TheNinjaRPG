import { z } from "zod";
import type { FederalStatus, UserRank, UserRole } from "@/drizzle/constants";
import { BanStates, TimeUnits } from "@/drizzle/constants";

export const systems = [
  "forum_comment",
  "tavern_comment",
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

export type AdditionalContext = {
  userId: string;
  username: string;
  avatar: string | null;
  level: number;
  rank: UserRank;
  federalStatus: FederalStatus;
  isOutlaw: boolean;
  role: UserRole;
  content: string;
  createdAt: Date;
};

export const reportFilteringSchema = z.object({
  reportedUser: z.string().optional(),
  reporterUser: z.string().optional(),
  status: z.enum(BanStates).optional(),
  startDate: z.date().optional(),
  endDate: z.date().optional(),
  system: z.string().optional(),
});
export type ReportFilteringSchema = z.infer<typeof reportFilteringSchema>;
