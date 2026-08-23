import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  CONTRIBUTION_JOB_PRIORITY,
  CONTRIBUTION_STALE_CLAIM_MS,
  CONTRIBUTION_VERIFY_WINDOW_MS,
  ContributionJobTypes,
} from "@/drizzle/constants";
import {
  devContributionProfile,
  devJob,
  devJobDailyUsage,
  userData,
} from "@/drizzle/schema";
import {
  clearGithubVerificationNonce,
  consumeConnectCode,
  DEVICE_TOKEN_TTL_MS,
  getDeviceTokenSecret,
  readGithubVerificationNonce,
  revokeAllDeviceTokensForUser,
  revokeDeviceToken,
  signDeviceToken,
  storeGithubVerificationNonce,
} from "@/libs/devContribution/deviceToken";
import {
  verifyContributionResult,
  verifyGistOwnership,
} from "@/libs/devContribution/github";
import {
  excludeSelfAuthored,
  hasJobsRemainingToday,
  isTokenCapExceeded,
  releaseJobStatus,
  selectClaimCandidates,
} from "@/libs/devContribution/jobs";
import {
  describeReward,
  grantContributionReward,
} from "@/libs/devContribution/rewards";
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
  confirmGithubVerificationInput,
  exchangeConnectCodeInput,
  failJobInput,
  getLeaderboardInput,
  getMyJobsInput,
  heartbeatInput,
  requestGithubVerificationInput,
  updateProfileInput,
} from "@/validators/devContribution";

// How many pending jobs to consider when matching a claim (bounded so a huge
// backlog does not balloon the claim round-trip).
const CLAIM_CANDIDATE_LIMIT = 200;

// MySQL FIELD() orders by position, so the list is the priority ranking highest
// first. Derived from CONTRIBUTION_JOB_PRIORITY so the SQL that picks the
// candidate window and the JS that ranks within it cannot drift apart.
const jobTypeFieldOrder = [...ContributionJobTypes].sort(
  (a, b) => CONTRIBUTION_JOB_PRIORITY[b] - CONTRIBUTION_JOB_PRIORITY[a],
);

export const devContributionRouter = createTRPCRouter({
  /**
   * Exchange a single-use connect code (from the browser-hosted /dev-connect
   * flow) for a short-lived device token. This is the only procedure the
   * desktop client calls before it holds a device token, so it is public:
   * the security boundary is the PKCE verifier + single-use, short-TTL code
   * that is only delivered to the client's own loopback server.
   */
  exchangeConnectCode: publicProcedure
    .input(exchangeConnectCodeInput)
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
   * Invalidate every device token issued to the caller. Unlike
   * `revokeDeviceToken` this works from an ordinary browser session, so a user
   * whose token leaked can cut it off without holding it.
   */
  revokeAllDeviceTokens: protectedProcedure
    .output(baseServerResponse)
    .mutation(async ({ ctx }) => {
      await revokeAllDeviceTokensForUser(ctx.userId);
      return { success: true, message: "All desktop clients signed out" };
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
   * Update daily token caps and the auto-run flag.
   *
   * The GitHub login is intentionally not settable here — see
   * requestGithubVerification.
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

      await ensureProfile(ctx.drizzle, ctx.userId);
      if (Object.keys(patch).length > 0) {
        await ctx.drizzle
          .update(devContributionProfile)
          .set({ ...patch, updatedAt: new Date() })
          .where(eq(devContributionProfile.userId, ctx.userId));
      }

      return { success: true, message: "Profile updated" };
    }),

  /**
   * Step 1 of proving GitHub account ownership: hand out a one-time nonce the
   * user must publish under the account they claim to own.
   *
   * Rewards are paid against the stored login, so accepting a client-supplied
   * value would let anyone farm another contributor's work. The nonce closes
   * that by requiring a write only the real account holder can make.
   */
  requestGithubVerification: protectedProcedure
    .input(requestGithubVerificationInput)
    .mutation(async ({ ctx, input }) => {
      await ensureProfile(ctx.drizzle, ctx.userId);
      const nonce = await storeGithubVerificationNonce(ctx.userId, input.githubLogin);
      return {
        success: true,
        message: "Publish this code in a public gist to prove ownership",
        nonce,
        instructions:
          `Run: echo "${nonce}" | gh gist create --public ` +
          `--desc "TheNinja-RPG verification" -`,
      };
    }),

  /**
   * Step 2: confirm the gist exists, is owned by the claimed login, and holds
   * the nonce we issued to this game account.
   */
  confirmGithubVerification: protectedProcedure
    .input(confirmGithubVerificationInput)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const nonce = await readGithubVerificationNonce(ctx.userId, input.githubLogin);
      if (!nonce) {
        return errorResponse(
          "No pending verification for that login. Request a new code first.",
        );
      }
      const check = await verifyGistOwnership(
        { gistId: input.gistId, login: input.githubLogin, nonce },
        { token: process.env.GITHUB_ISSUE_TOKEN },
      );
      if (!check.ok) {
        // Leave the nonce in place: the gist may simply not have propagated
        // yet, and burning it would make the user restart the whole flow.
        return errorResponse(check.error ?? "Could not verify GitHub account");
      }
      await clearGithubVerificationNonce(ctx.userId, input.githubLogin);

      await ensureProfile(ctx.drizzle, ctx.userId);
      await ctx.drizzle
        .update(devContributionProfile)
        .set({
          githubLogin: check.login ?? input.githubLogin,
          githubLoginVerifiedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(devContributionProfile.userId, ctx.userId));

      return { success: true, message: `Verified as @${check.login}` };
    }),

  /**
   * Claim the next eligible job for the requested agent.
   *
   * Enforces (server-side, as a backstop to the client):
   *  - one in-flight job per user;
   *  - the agent's daily token cap;
   *  - the global daily job cap.
   *
   * Two compare-and-swaps make this safe under concurrency: one takes the
   * user's single claim slot (so parallel requests cannot each walk away with a
   * job), the other flips the job row PENDING -> CLAIMED (so two users cannot
   * take the same job).
   */
  claimNextJob: protectedProcedure
    .input(claimNextJobInput)
    .mutation(async ({ ctx, input }) => {
      const agent = input.agent;
      const today = getUtcDateString();

      const [profile, usage, activeJobs, pending] = await Promise.all([
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
        // Only rows the contributor is still working on, so a long job history
        // cannot push the caller's active claim out of a truncated result set.
        // VERIFYING is excluded on purpose: the work is already submitted and
        // only GitHub confirmation is outstanding, so it must not block the next
        // claim for the whole retry window.
        ctx.drizzle
          .select({ id: devJob.id })
          .from(devJob)
          .where(
            and(eq(devJob.claimedByUserId, ctx.userId), eq(devJob.status, "CLAIMED")),
          )
          .limit(1),
        ctx.drizzle
          .select()
          .from(devJob)
          .where(eq(devJob.status, "PENDING"))
          .orderBy(
            sql`FIELD(${devJob.jobType}, ${sql.join(
              jobTypeFieldOrder.map((t) => sql`${t}`),
              sql`, `,
            )}) ASC`,
            devJob.createdAt,
          )
          .limit(CLAIM_CANDIDATE_LIMIT),
      ]);

      if (activeJobs.length > 0) {
        return {
          success: true,
          claimed: false,
          message: "You already have an active job. Finish it before claiming another.",
        };
      }

      // Rewards are only paid against a proven GitHub identity, and a missing
      // login is deliberately non-retryable in verifyContributionResult. Without
      // this guard a contributor could claim, do the work for real, and then
      // have the job close as COMPLETED with no reward and no retry.
      if (!profile.githubLogin || !profile.githubLoginVerifiedAt) {
        return {
          success: true,
          claimed: false,
          message:
            "Verify your GitHub account before claiming work, or completed jobs cannot be rewarded.",
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

      // Refs this user has already worked on, so they are not offered again.
      const refNumbers = [...new Set(pending.map((j) => j.refNumber))];
      const history = refNumbers.length
        ? await ctx.drizzle
            .select({
              jobType: devJob.jobType,
              refKind: devJob.refKind,
              refNumber: devJob.refNumber,
              status: devJob.status,
              id: devJob.id,
              attemptCount: devJob.attemptCount,
            })
            .from(devJob)
            .where(
              and(
                eq(devJob.claimedByUserId, ctx.userId),
                inArray(devJob.refNumber, refNumbers),
              ),
            )
        : [];

      const candidates = excludeSelfAuthored(
        selectClaimCandidates(withContexts(pending), history),
        profile.githubLogin ?? undefined,
      );

      for (const candidate of candidates) {
        // Take the caller's single claim slot. Losing this CAS means a parallel
        // request already holds it, so stop rather than claiming a second job.
        const slot = await ctx.drizzle
          .update(devContributionProfile)
          .set({ activeJobId: candidate.id, lastSeenAt: new Date() })
          .where(
            and(
              eq(devContributionProfile.userId, ctx.userId),
              isNull(devContributionProfile.activeJobId),
            ),
          );
        if (slot.rowsAffected !== 1) {
          return {
            success: true,
            claimed: false,
            message:
              "You already have an active job. Finish it before claiming another.",
          };
        }

        const claimedAt = new Date();
        const result = await ctx.drizzle
          .update(devJob)
          .set({
            status: "CLAIMED",
            agent,
            claimedByUserId: ctx.userId,
            claimedAt,
            heartbeatAt: claimedAt,
            attemptCount: sql`${devJob.attemptCount} + 1`,
            updatedAt: claimedAt,
          })
          .where(and(eq(devJob.id, candidate.id), eq(devJob.status, "PENDING")));

        if (result.rowsAffected === 1) {
          return {
            success: true,
            claimed: true,
            // Serialize the post-update state: the row we read was still PENDING.
            job: serializeJob(
              withContext({
                ...candidate,
                status: "CLAIMED" as const,
                agent,
                claimedByUserId: ctx.userId,
                claimedAt,
                heartbeatAt: claimedAt,
              }),
            ),
          };
        }

        // Another user took this job first: hand the slot back and try the next.
        await releaseClaimSlot(ctx.drizzle, ctx.userId, candidate.id);
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
      const now = new Date();
      const result = await ctx.drizzle
        .update(devJob)
        .set({ heartbeatAt: now, updatedAt: now })
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
        .set({ lastSeenAt: now })
        .where(eq(devContributionProfile.userId, ctx.userId));
      return { success: true, message: "Heartbeat recorded" };
    }),

  /**
   * Report a finished job. The server re-verifies the result on GitHub before
   * granting a reward.
   *
   * A result GitHub cannot confirm right now (propagation delay, rate limit,
   * outage) parks the job as VERIFYING for the maintenance cron to re-check,
   * rather than closing it unrewarded — otherwise a momentary GitHub hiccup
   * would permanently burn work the contributor actually did.
   */
  completeJob: protectedProcedure
    .input(completeJobInput)
    .mutation(async ({ ctx, input }) => {
      const now = Date.now();
      const today = getUtcDateString();

      const [job, profile] = await Promise.all([
        ctx.drizzle
          .select()
          .from(devJob)
          .where(eq(devJob.id, input.jobId))
          .then((rows) => rows[0]),
        ensureProfile(ctx.drizzle, ctx.userId),
      ]);

      if (!job || job.status !== "CLAIMED" || job.claimedByUserId !== ctx.userId) {
        return errorResponse("Job is not active or belongs to another user");
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

      const totalTokens = input.tokensIn + input.tokensOut;
      const agent = job.agent ?? "CLAUDE";
      const deferred = !verification.verified && verification.retryable === true;

      // Usage is recorded either way: the tokens were spent.
      const ledgerWrites = [
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
        ctx.drizzle
          .update(devContributionProfile)
          .set({
            // Only verified work counts toward the public leaderboard; tokens
            // are recorded either way because they were genuinely spent.
            totalJobsCompleted: verification.verified
              ? sql`${devContributionProfile.totalJobsCompleted} + 1`
              : sql`${devContributionProfile.totalJobsCompleted}`,
            totalTokensContributed: sql`${devContributionProfile.totalTokensContributed} + ${totalTokens}`,
            lastSeenAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(devContributionProfile.userId, ctx.userId)),
      ];

      if (deferred) {
        const parked = await ctx.drizzle
          .update(devJob)
          .set({
            status: "VERIFYING",
            tokensIn: input.tokensIn,
            tokensOut: input.tokensOut,
            resultUrl: input.resultUrl ?? null,
            error: verification.error ?? "Awaiting GitHub verification",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(devJob.id, input.jobId),
              eq(devJob.status, "CLAIMED"),
              eq(devJob.claimedByUserId, ctx.userId),
            ),
          );
        if (parked.rowsAffected === 0) return errorResponse("Job already completed");
        // The work is submitted; only GitHub confirmation is outstanding. Holding
        // the single claim slot until then would lock the contributor out for the
        // whole retry window over one transient GitHub failure.
        await Promise.all([
          ...ledgerWrites,
          releaseClaimSlot(ctx.drizzle, ctx.userId, job.id),
        ]);
        return {
          success: true,
          message:
            "Job submitted. GitHub has not confirmed the result yet; it will be re-checked shortly.",
          reward: null,
          verified: false,
          pending: true,
        };
      }

      // Only verified work retires the ref. Closing unverified work as COMPLETED
      // would make planIssueJob treat the issue as done for good (it keys off
      // status alone), so a caller could burn an issue out of the queue by
      // claiming it and reporting completion without touching GitHub. Release it
      // under the same attempt budget failJob uses instead.
      const unverifiedStatus = releaseJobStatus(job.attemptCount);
      const closed = await ctx.drizzle
        .update(devJob)
        .set({
          status: verification.verified ? "COMPLETED" : unverifiedStatus,
          completedAt: verification.verified ? new Date() : null,
          claimedByUserId: verification.verified ? job.claimedByUserId : null,
          claimedAt: verification.verified ? job.claimedAt : null,
          heartbeatAt: verification.verified ? job.heartbeatAt : null,
          agent: verification.verified ? job.agent : null,
          resultUrl: verification.verified
            ? (verification.resultUrl ?? input.resultUrl ?? null)
            : (input.resultUrl ?? null),
          tokensIn: input.tokensIn,
          tokensOut: input.tokensOut,
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
          ),
        );

      if (closed.rowsAffected === 0) {
        return errorResponse("Job already completed");
      }

      // Payout runs after the job is closed, and is itself CAS-guarded on both
      // the daily slot and devJob.rewardGranted, so it can never pay twice.
      const reward = verification.verified
        ? await grantContributionReward({
            client: ctx.drizzle,
            userId: ctx.userId,
            jobId: input.jobId,
            jobType: job.jobType,
            today,
          })
        : null;

      await Promise.all([
        ...ledgerWrites,
        releaseClaimSlot(ctx.drizzle, ctx.userId, job.id),
      ]);

      return {
        success: true,
        message: verification.verified
          ? reward
            ? "Job completed and verified"
            : "Job completed and verified (daily reward limit reached)"
          : unverifiedStatus === "PENDING"
            ? "Result could not be verified; the job has been released for another attempt"
            : "Result could not be verified and the attempt budget is exhausted",
        reward: reward ? describeReward(reward) : null,
        verified: verification.verified,
        pending: false,
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
      const released = await ctx.drizzle
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
      if (released.rowsAffected === 0) {
        return errorResponse("Job is no longer active");
      }
      await releaseClaimSlot(ctx.drizzle, ctx.userId, job.id);

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
        .where(sql`${devContributionProfile.totalJobsCompleted} >= 1`)
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

/** Free the caller's single claim slot, but only if it still points at this job. */
async function releaseClaimSlot(client: DrizzleClient, userId: string, jobId: number) {
  await client
    .update(devContributionProfile)
    .set({ activeJobId: null, updatedAt: new Date() })
    .where(
      and(
        eq(devContributionProfile.userId, userId),
        eq(devContributionProfile.activeJobId, jobId),
      ),
    );
}

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
