import { and, desc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import {
  CONTRIBUTION_STALE_CLAIM_MS,
  CONTRIBUTION_VERIFY_WINDOW_MS,
} from "@/drizzle/constants";
import {
  devContributionProfile,
  devJob,
  devJobDailyUsage,
  userData,
} from "@/drizzle/schema";
import {
  consumeConnectCode,
  DEVICE_TOKEN_TTL_MS,
  getDeviceTokenSecret,
  revokeDeviceToken,
  signDeviceToken,
} from "@/libs/devContribution/deviceToken";
import { verifyContributionResult } from "@/libs/devContribution/github";
import {
  excludeSelfReview,
  getContributionReward,
  hasJobsRemainingToday,
  isTokenCapExceeded,
  releaseJobStatus,
  selectClaimCandidates,
} from "@/libs/devContribution/jobs";
import { postProcessRewards } from "@/libs/quest";
import { updateRewards } from "@/server/api/routers/quests";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  publicProcedure,
} from "@/server/api/trpc";
import { type DrizzleClient, drizzleDB } from "@/server/db";
import { getUtcDateString } from "@/utils/time";
import {
  claimNextJobInput,
  completeJobInput,
  failJobInput,
  getLeaderboardInput,
  getMyJobsInput,
  heartbeatInput,
  updateProfileInput,
} from "@/validators/devContribution";
import { ObjectiveReward } from "@/validators/rewards";

// How many pending jobs to consider when matching a claim (bounded so a huge
// backlog does not balloon the claim round-trip).
const CLAIM_CANDIDATE_LIMIT = 200;

export const devContributionRouter = createTRPCRouter({
  /**
   * Exchange a single-use connect code (from the browser-hosted /dev-connect
   * flow) for a short-lived device token. This is the only procedure the
   * desktop client calls before it holds a device token, so it is public:
   * the security boundary is the PKCE verifier + single-use, short-TTL code
   * that is only delivered to the client's own loopback server.
   */
  exchangeConnectCode: publicProcedure
    .input(
      z.object({
        code: z.string().min(40).max(160),
        codeVerifier: z.string().min(40).max(160),
      }),
    )
    .mutation(async ({ input }) => {
      const userId = await consumeConnectCode(input.code, input.codeVerifier);
      if (!userId) {
        return errorResponse("Connect code is invalid, expired, or already used");
      }
      const deviceToken = signDeviceToken(getDeviceTokenSecret(), userId, Date.now());
      return {
        success: true,
        message: "Device token issued",
        deviceToken,
        expiresAt: Date.now() + DEVICE_TOKEN_TTL_MS,
      };
    }),

  /**
   * Revoke the caller's current device token (from within the desktop
   * client's Settings screen).
   */
  revokeDeviceToken: protectedProcedure.mutation(async ({ ctx }) => {
    if (!ctx.deviceTokenJti) {
      return errorResponse("Not a device-token session");
    }
    await revokeDeviceToken(ctx.deviceTokenJti, Date.now() + DEVICE_TOKEN_TTL_MS);
    return { success: true, message: "Device token revoked" };
  }),

  /**
   * Get-or-create the caller's contribution profile plus today's usage.
   */
  getProfile: protectedProcedure.query(async ({ ctx }) => {
    const today = getUtcDateString();
    const [profile, usage] = await Promise.all([
      ensureProfile(ctx.drizzle, ctx.userId),
      ctx.drizzle
        .select()
        .from(devJobDailyUsage)
        .where(
          and(
            eq(devJobDailyUsage.userId, ctx.userId),
            eq(devJobDailyUsage.date, today),
          ),
        ),
    ]);

    const usageByAgent: Record<string, { tokens: number; jobsCompleted: number }> = {};
    for (const row of usage) {
      usageByAgent[row.agent] = {
        tokens: row.tokens,
        jobsCompleted: row.jobsCompleted,
      };
    }

    return {
      success: true,
      profile,
      today: {
        date: today,
        usageByAgent,
      },
    };
  }),

  /**
   * Update daily token caps, auto-run flag, and the verified GitHub login.
   */
  updateProfile: protectedProcedure
    .input(updateProfileInput)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const patch: Record<string, unknown> = {};
      if (input.claudeDailyTokenCap !== undefined) {
        patch.claudeDailyTokenCap = input.claudeDailyTokenCap;
      }
      if (input.codexDailyTokenCap !== undefined) {
        patch.codexDailyTokenCap = input.codexDailyTokenCap;
      }
      if (input.autoRun !== undefined) {
        patch.autoRun = input.autoRun;
      }
      if (input.githubLogin !== undefined) {
        patch.githubLogin = input.githubLogin.trim();
      }

      await ensureProfile(ctx.drizzle, ctx.userId);
      await ctx.drizzle
        .update(devContributionProfile)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(devContributionProfile.userId, ctx.userId));

      return { success: true, message: "Profile updated" };
    }),

  /**
   * Claim the next eligible job for the requested agent.
   *
   * Enforces (server-side, as a backstop to the client):
   *  - one in-flight job per user;
   *  - the agent's daily token cap;
   *  - the global daily job cap.
   *
   * The claim itself is a compare-and-swap on status=PENDING so two clients can
   * never claim the same job.
   */
  claimNextJob: protectedProcedure
    .input(claimNextJobInput)
    .mutation(async ({ ctx, input }) => {
      const agent = input.agent;
      const today = getUtcDateString();

      const [profile, usage, userJobs, pending] = await Promise.all([
        ensureProfile(ctx.drizzle, ctx.userId),
        ctx.drizzle
          .select()
          .from(devJobDailyUsage)
          .where(
            and(
              eq(devJobDailyUsage.userId, ctx.userId),
              eq(devJobDailyUsage.date, today),
            ),
          ),
        ctx.drizzle
          .select()
          .from(devJob)
          .where(eq(devJob.claimedByUserId, ctx.userId))
          .limit(200),
        ctx.drizzle
          .select()
          .from(devJob)
          .where(eq(devJob.status, "PENDING"))
          .orderBy(
            sql`FIELD(DevJob.jobType, 'ISSUE_IMPLEMENT', 'PR_REVIEW', 'ISSUE_TRIAGE') ASC, DevJob.createdAt ASC`,
          )
          .limit(CLAIM_CANDIDATE_LIMIT),
      ]);

      if (userJobs.some((j) => j.status === "CLAIMED")) {
        return {
          success: true,
          claimed: false,
          message: "You already have an active job. Finish it before claiming another.",
        };
      }

      const capForAgent =
        agent === "CLAUDE" ? profile.claudeDailyTokenCap : profile.codexDailyTokenCap;
      const agentTokens = usage.find((u) => u.agent === agent)?.tokens ?? 0;
      if (isTokenCapExceeded(agentTokens, capForAgent)) {
        return {
          success: true,
          claimed: false,
          message: `Daily ${agent.toLowerCase()} token budget exhausted. Resets at UTC midnight.`,
        };
      }

      const jobsCompletedToday = usage.reduce((sum, u) => sum + u.jobsCompleted, 0);
      if (!hasJobsRemainingToday(jobsCompletedToday)) {
        return {
          success: true,
          claimed: false,
          message: "Daily job limit reached. Come back tomorrow.",
        };
      }

      const candidates = excludeSelfReview(
        selectClaimCandidates(withContexts(pending), withContexts(userJobs)),
        profile.githubLogin ?? undefined,
      );

      for (const candidate of candidates) {
        const result = await ctx.drizzle
          .update(devJob)
          .set({
            status: "CLAIMED",
            agent,
            claimedByUserId: ctx.userId,
            claimedAt: new Date(),
            heartbeatAt: new Date(),
            attemptCount: sql`${devJob.attemptCount} + 1`,
            updatedAt: new Date(),
          })
          .where(and(eq(devJob.id, candidate.id), eq(devJob.status, "PENDING")));

        if (result.rowsAffected === 1) {
          await ctx.drizzle
            .update(devContributionProfile)
            .set({ lastSeenAt: new Date() })
            .where(eq(devContributionProfile.userId, ctx.userId));
          return {
            success: true,
            claimed: true,
            job: serializeJob(withContext(candidate)),
          };
        }
      }

      return {
        success: true,
        claimed: false,
        message: "No jobs available right now. Check back soon.",
      };
    }),

  /**
   * Keep a claimed job alive. Called by the client while work is in progress.
   */
  heartbeat: protectedProcedure
    .input(heartbeatInput)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.drizzle
        .update(devJob)
        .set({ heartbeatAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(devJob.id, input.jobId),
            eq(devJob.status, "CLAIMED"),
            eq(devJob.claimedByUserId, ctx.userId),
          ),
        );
      if (result.rowsAffected === 0) {
        return errorResponse("Job is not active or belongs to another user");
      }
      await ctx.drizzle
        .update(devContributionProfile)
        .set({ lastSeenAt: new Date() })
        .where(eq(devContributionProfile.userId, ctx.userId));
      return { success: true, message: "Heartbeat recorded" };
    }),

  /**
   * Report a finished job. The server re-verifies the result on GitHub before
   * granting a reward; unverified jobs still complete (counting toward history
   * and tokens) but pay nothing.
   */
  completeJob: protectedProcedure
    .input(completeJobInput)
    .mutation(async ({ ctx, input }) => {
      const now = Date.now();
      const today = getUtcDateString();

      const [job, user, profile, rewardedToday] = await Promise.all([
        ctx.drizzle
          .select()
          .from(devJob)
          .where(eq(devJob.id, input.jobId))
          .then((rows) => rows[0]),
        ctx.drizzle
          .select()
          .from(userData)
          .where(eq(userData.userId, ctx.userId))
          .then((r) => r[0]),
        ensureProfile(ctx.drizzle, ctx.userId),
        ctx.drizzle
          .select({ count: sql<number>`count(*)` })
          .from(devJob)
          .where(
            and(
              eq(devJob.claimedByUserId, ctx.userId),
              eq(devJob.status, "COMPLETED"),
              eq(devJob.rewardGranted, true),
              gte(devJob.completedAt, new Date(`${today}T00:00:00.000Z`)),
            ),
          )
          .then((rows) => rows[0]?.count ?? 0),
      ]);

      if (!job || job.status !== "CLAIMED" || job.claimedByUserId !== ctx.userId) {
        return errorResponse("Job is not active or belongs to another user");
      }
      if (job.rewardGranted) {
        return {
          success: true,
          message: "Job already completed",
          reward: null,
          verified: true,
        };
      }

      const claimedAt = job.claimedAt?.getTime() ?? now;
      const verification = await verifyContributionResult(
        {
          jobType: job.jobType,
          refNumber: job.refNumber,
          githubLogin: profile.githubLogin ?? "",
          claimedAt,
          nowMs: now,
          windowMs: CONTRIBUTION_VERIFY_WINDOW_MS,
        },
        { token: process.env.GITHUB_ISSUE_TOKEN },
      );

      const reward = verification.verified
        ? getContributionReward(job.jobType, rewardedToday)
        : null;

      const result = await ctx.drizzle
        .update(devJob)
        .set({
          status: "COMPLETED",
          completedAt: new Date(),
          resultUrl: verification.verified
            ? (verification.resultUrl ?? input.resultUrl ?? null)
            : (input.resultUrl ?? null),
          tokensIn: input.tokensIn,
          tokensOut: input.tokensOut,
          rewardGranted: reward !== null,
          error: verification.verified
            ? null
            : (verification.error ?? "Result could not be verified"),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(devJob.id, input.jobId),
            eq(devJob.status, "CLAIMED"),
            eq(devJob.claimedByUserId, ctx.userId),
            eq(devJob.rewardGranted, false),
          ),
        );

      if (result.rowsAffected === 0) {
        return errorResponse("Job already completed");
      }

      const totalTokens = input.tokensIn + input.tokensOut;
      const agent = job.agent ?? "CLAUDE";

      const writes: Promise<unknown>[] = [
        // Upsert the daily ledger (INSERT ... ON DUPLICATE KEY UPDATE).
        ctx.drizzle
          .insert(devJobDailyUsage)
          .values({
            userId: ctx.userId,
            date: today,
            agent,
            tokens: totalTokens,
            jobsCompleted: 1,
          })
          .onDuplicateKeyUpdate({
            set: {
              tokens: sql`${devJobDailyUsage.tokens} + values(\`tokens\`)`,
              jobsCompleted: sql`${devJobDailyUsage.jobsCompleted} + values(\`jobsCompleted\`)`,
              updatedAt: new Date(),
            },
          }),
        // Bump lifetime profile counters atomically.
        ctx.drizzle
          .update(devContributionProfile)
          .set({
            totalJobsCompleted: sql`${devContributionProfile.totalJobsCompleted} + 1`,
            totalTokensContributed: sql`${devContributionProfile.totalTokensContributed} + ${totalTokens}`,
            lastSeenAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(devContributionProfile.userId, ctx.userId)),
      ];

      if (reward && user) {
        writes.push(
          updateRewards({
            client: ctx.drizzle,
            user,
            reason: `DEV_CONTRIBUTION_${job.jobType}`,
            rewards: postProcessRewards({
              ...ObjectiveReward.parse({}),
              reward_money: reward.money,
              reward_exp: reward.exp,
              reward_reputation: reward.reputation,
            }),
          }),
        );
      }

      await Promise.all(writes);

      return {
        success: true,
        message: verification.verified
          ? "Job completed and verified"
          : "Job completed (result could not be verified yet, no reward granted)",
        reward: reward
          ? `${reward.money} money, ${reward.exp} exp, ${reward.reputation} reputation`
          : null,
        verified: verification.verified,
      };
    }),

  /**
   * Give up on a job. Releases it back to PENDING while attempts remain,
   * otherwise parks it as FAILED.
   */
  failJob: protectedProcedure
    .input(failJobInput)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [job] = await ctx.drizzle
        .select()
        .from(devJob)
        .where(eq(devJob.id, input.jobId));
      if (!job || job.status !== "CLAIMED" || job.claimedByUserId !== ctx.userId) {
        return errorResponse("Job is not active or belongs to another user");
      }

      const nextStatus = releaseJobStatus(job.attemptCount);
      await ctx.drizzle
        .update(devJob)
        .set({
          status: nextStatus,
          claimedByUserId: null,
          claimedAt: null,
          heartbeatAt: null,
          agent: null,
          error: input.error ?? "Job failed",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(devJob.id, input.jobId),
            eq(devJob.status, "CLAIMED"),
            eq(devJob.claimedByUserId, ctx.userId),
          ),
        );

      return {
        success: true,
        message:
          nextStatus === "PENDING"
            ? "Job released and will be re-offered to another contributor"
            : "Job parked after exhausting its attempt budget",
      };
    }),

  /**
   * The caller's most recent jobs (for the client's history view).
   */
  getMyJobs: protectedProcedure.input(getMyJobsInput).query(async ({ ctx, input }) => {
    const jobs = await ctx.drizzle
      .select()
      .from(devJob)
      .where(eq(devJob.claimedByUserId, ctx.userId))
      .orderBy(desc(devJob.id))
      .limit(input.limit);
    return {
      success: true,
      jobs: jobs.map((j) => serializeJob(withContext(j))),
    };
  }),

  /**
   * Top contributors by completed jobs, then tokens.
   */
  getLeaderboard: publicProcedure
    .input(getLeaderboardInput)
    .query(async ({ input }) => {
      const rows = await drizzleDB
        .select({
          userId: devContributionProfile.userId,
          totalJobsCompleted: devContributionProfile.totalJobsCompleted,
          totalTokensContributed: devContributionProfile.totalTokensContributed,
          lastSeenAt: devContributionProfile.lastSeenAt,
          name: userData.username,
        })
        .from(devContributionProfile)
        .innerJoin(userData, eq(devContributionProfile.userId, userData.userId))
        .where(gte(devContributionProfile.totalJobsCompleted, 1))
        .orderBy(
          desc(devContributionProfile.totalJobsCompleted),
          desc(devContributionProfile.totalTokensContributed),
        )
        .limit(input.limit);
      return {
        success: true,
        leaderboard: rows,
      };
    }),
});

// ─────────────────────────────────────────────────────────────────────────────
// Convenience helpers (kept at the bottom per repo convention)
// ─────────────────────────────────────────────────────────────────────────────

type JobRow = typeof devJob.$inferSelect;

export interface SerializedJob {
  id: number;
  jobType: JobRow["jobType"];
  refKind: JobRow["refKind"];
  refNumber: number;
  refUrl: string;
  context: JobContext;
  agent: JobRow["agent"];
  claimedAt: Date | null;
  heartbeatAt: Date | null;
  staleThresholdMs: number;
}

export interface JobContext {
  title?: string;
  labels?: string[];
  body?: string;
  authorLogin?: string;
  isCrossFork?: boolean;
  [key: string]: unknown;
}

const withContext = <T extends JobRow>(job: T) => ({
  ...job,
  context: safeParseContext(job.contextJson),
});

const withContexts = <T extends JobRow>(jobs: T[]) => jobs.map(withContext);

function safeParseContext(json: string | null): JobContext {
  if (!json) return {};
  try {
    return JSON.parse(json) as JobContext;
  } catch {
    return {};
  }
}

const serializeJob = (job: ReturnType<typeof withContext>): SerializedJob => ({
  id: job.id,
  jobType: job.jobType,
  refKind: job.refKind,
  refNumber: job.refNumber,
  refUrl: job.refUrl,
  context: job.context,
  agent: job.agent,
  claimedAt: job.claimedAt,
  heartbeatAt: job.heartbeatAt,
  staleThresholdMs: CONTRIBUTION_STALE_CLAIM_MS,
});

// Get-or-create the caller's profile. Concurrent first-time claims may race on
// the insert; the duplicate-key error is tolerated and re-read.
async function ensureProfile(client: DrizzleClient, userId: string) {
  const findProfile = () =>
    client
      .select()
      .from(devContributionProfile)
      .where(eq(devContributionProfile.userId, userId))
      .then((rows) => rows[0]);

  const existing = await findProfile();
  if (existing) return existing;
  try {
    await client.insert(devContributionProfile).values({ userId });
  } catch (error) {
    // Ignore duplicate-key races; a concurrent insert won.
    if (!(error instanceof Error) || !/Duplicate entry/i.test(error.message))
      throw error;
  }
  const created = await findProfile();
  if (!created) throw new Error("Failed to create contribution profile");
  return created;
}
