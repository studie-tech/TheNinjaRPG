import { z } from "zod";
import { ContributionAgents } from "@/drizzle/constants";

export const updateProfileInput = z.object({
  // 0 = unlimited.
  claudeDailyTokenCap: z.number().int().nonnegative().optional(),
  codexDailyTokenCap: z.number().int().nonnegative().optional(),
  autoRun: z.boolean().optional(),
  githubLogin: z.string().min(1).max(191).optional(),
});

export const claimNextJobInput = z.object({
  agent: z.enum(ContributionAgents),
});

export const heartbeatInput = z.object({
  jobId: z.number().int().positive(),
});

export const completeJobInput = z.object({
  jobId: z.number().int().positive(),
  tokensIn: z.number().int().nonnegative().default(0),
  tokensOut: z.number().int().nonnegative().default(0),
  // Where the result lives (review / comment / PR URL). Re-verified server-side.
  resultUrl: z.string().max(500).optional(),
});

export const failJobInput = z.object({
  jobId: z.number().int().positive(),
  error: z.string().max(2000).optional(),
});

export const getMyJobsInput = z.object({
  limit: z.number().int().positive().max(100).default(50),
});

export const getLeaderboardInput = z.object({
  limit: z.number().int().positive().max(50).default(20),
});

export type UpdateProfileInput = z.infer<typeof updateProfileInput>;
export type ClaimNextJobInput = z.infer<typeof claimNextJobInput>;
export type HeartbeatInput = z.infer<typeof heartbeatInput>;
export type CompleteJobInput = z.infer<typeof completeJobInput>;
export type FailJobInput = z.infer<typeof failJobInput>;
export type GetMyJobsInput = z.infer<typeof getMyJobsInput>;
export type GetLeaderboardInput = z.infer<typeof getLeaderboardInput>;
