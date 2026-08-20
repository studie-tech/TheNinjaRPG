import { z } from "zod";
import { ContributionAgents } from "@/drizzle/constants";

// Upper bound on a self-declared daily token cap. 0 means "no cap of my own";
// the server-side job caps still apply either way.
const MAX_DAILY_TOKEN_CAP = 1_000_000_000;

// Client-reported token usage is advisory (it drives the user's own budget and
// the leaderboard), so it is bounded to keep a modified client from writing
// absurd values into the ledger.
const MAX_REPORTED_TOKENS = 100_000_000;

export const updateProfileInput = z.object({
  // 0 = unlimited.
  claudeDailyTokenCap: z
    .number()
    .int()
    .nonnegative()
    .max(MAX_DAILY_TOKEN_CAP)
    .optional(),
  codexDailyTokenCap: z
    .number()
    .int()
    .nonnegative()
    .max(MAX_DAILY_TOKEN_CAP)
    .optional(),
  autoRun: z.boolean().optional(),
  // NOTE: githubLogin is deliberately NOT settable here. It is the identity that
  // rewards are paid against, so it is only ever written by the verified
  // requestGithubVerification / confirmGithubVerification challenge flow.
});

// GitHub logins: alphanumeric with single hyphens, max 39 chars.
export const githubLoginSchema = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z\d](?:[A-Za-z\d]|-(?=[A-Za-z\d])){0,38}$/,
    "Not a valid GitHub login",
  );

export const requestGithubVerificationInput = z.object({
  githubLogin: githubLoginSchema,
});

export const confirmGithubVerificationInput = z.object({
  githubLogin: githubLoginSchema,
  // Id of the gist the user created containing the server-issued nonce.
  gistId: z
    .string()
    .trim()
    .regex(/^[A-Za-z\d]{1,64}$/, "Not a valid gist id"),
});

export const claimNextJobInput = z.object({
  agent: z.enum(ContributionAgents),
});

export const heartbeatInput = z.object({
  jobId: z.number().int().positive(),
});

export const completeJobInput = z.object({
  jobId: z.number().int().positive(),
  tokensIn: z.number().int().nonnegative().max(MAX_REPORTED_TOKENS).default(0),
  tokensOut: z.number().int().nonnegative().max(MAX_REPORTED_TOKENS).default(0),
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

export const exchangeConnectCodeInput = z.object({
  code: z.string().min(40).max(160),
  codeVerifier: z.string().min(40).max(160),
});

export type UpdateProfileInput = z.infer<typeof updateProfileInput>;
export type ClaimNextJobInput = z.infer<typeof claimNextJobInput>;
export type HeartbeatInput = z.infer<typeof heartbeatInput>;
export type CompleteJobInput = z.infer<typeof completeJobInput>;
export type FailJobInput = z.infer<typeof failJobInput>;
export type GetMyJobsInput = z.infer<typeof getMyJobsInput>;
export type GetLeaderboardInput = z.infer<typeof getLeaderboardInput>;
export type ExchangeConnectCodeInput = z.infer<typeof exchangeConnectCodeInput>;
export type RequestGithubVerificationInput = z.infer<
  typeof requestGithubVerificationInput
>;
export type ConfirmGithubVerificationInput = z.infer<
  typeof confirmGithubVerificationInput
>;
