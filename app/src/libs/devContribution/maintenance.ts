// Periodic maintenance for dev-contribution jobs, run by the Vercel cron
// endpoint /api/dev-contribution-maintenance.
//
// Responsibilities:
//  1. Requeue stale claims (claimed jobs whose heartbeat stopped).
//  2. Re-check results GitHub could not confirm at completion time.
//  3. Ensure the "Fully Clarified" label exists on the repository.
//  4. Backfill jobs from GitHub's open issues / PRs so work is never stuck
//     waiting on a missed webhook.
//
// All network access is injectable for testing; the cron route passes the real
// fetch + GITHUB_ISSUE_TOKEN.

import { and, eq, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import {
  CONTRIBUTION_BACKFILL_BATCH_SIZE,
  CONTRIBUTION_CLARIFIED_LABEL,
  CONTRIBUTION_STALE_CLAIM_MS,
  CONTRIBUTION_VERIFY_BATCH_SIZE,
  CONTRIBUTION_VERIFY_RETRY_MS,
  CONTRIBUTION_VERIFY_WINDOW_MS,
  GITHUB_API_ENDPOINT,
} from "@/drizzle/constants";
import { devContributionProfile, devJob } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { getUtcDateString } from "@/utils/time";
import { type FetchImpl, ghFetch, ghHeaders, verifyContributionResult } from "./github";
import {
  computeBackfillJobs,
  isClaimStale,
  isJobActive,
  releaseJobStatus,
} from "./jobs";
import { grantContributionReward } from "./rewards";
import type { ExistingJob, OpenIssueRef, OpenPullRequestRef } from "./types";

export interface MaintenanceReport {
  staleRequeued: number;
  verificationsResolved: number;
  verificationsRewarded: number;
  jobsCreated: number;
  jobsCancelled: number;
  labelEnsured: boolean;
  errors: string[];
}

interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  pull_request?: unknown;
  labels: Array<{ name: string }>;
  user?: { login: string };
}

interface GitHubPullRequest {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  labels: Array<{ name: string }>;
  user: { login: string; type?: string };
  head: { repo?: { owner?: { login: string } } };
  base: { repo?: { owner?: { login: string } } };
}

// Bound on the open-ref feeds. Hitting it means the picture is incomplete, so
// absence from the feed can no longer be read as "this ref is closed".
const ISSUE_PAGE_LIMIT = 5;
const PR_PAGE_LIMIT = 3;

const normalize = (value: string | null | undefined) => value?.toLowerCase() ?? "";

// Fields reset whenever a job stops being held by a contributor.
const clearClaimFields = {
  claimedByUserId: null,
  claimedAt: null,
  heartbeatAt: null,
  agent: null,
} as const;

/** Release the per-user claim slot held on the profile for these jobs. */
const releaseClaimSlots = async (db: DrizzleClient, jobIds: number[]) => {
  if (jobIds.length === 0) return;
  await db
    .update(devContributionProfile)
    .set({ activeJobId: null, updatedAt: new Date() })
    .where(
      and(
        inArray(devContributionProfile.activeJobId, jobIds),
        // A released job keeps its id, so it can be re-claimed by someone else
        // before this runs. Clearing on the id alone would then strip a slot
        // that legitimately holds the same job again.
        sql`NOT EXISTS (SELECT 1 FROM DevJob j
                        WHERE j.id = DevContributionProfile.activeJobId
                          AND j.status = 'CLAIMED')`,
      ),
    );
};

/**
 * Cancel jobs that have become obsolete because the issue's desired job type
 * changed (e.g. a triage job on an issue that has since been clarified).
 *
 * PENDING and CLAIMED are cancelled: nobody has submitted that work yet, and
 * leaving it live means the same issue carries two job types at once and the
 * obsolete one still pays out. VERIFYING is deliberately left alone — the
 * contributor already did and submitted that work, so it must still be able to
 * verify and pay.
 */
export const cancelObsoleteJobs = async (
  db: DrizzleClient,
  ids: number[],
): Promise<number> => {
  if (ids.length === 0) return 0;
  const result = await db
    .update(devJob)
    .set({
      status: "CANCELLED",
      ...clearClaimFields,
      updatedAt: new Date(),
    })
    .where(
      and(inArray(devJob.id, ids), inArray(devJob.status, ["PENDING", "CLAIMED"])),
    );
  // A cancelled CLAIMED job was holding its owner's single claim slot.
  await releaseClaimSlots(db, ids);
  return result.rowsAffected;
};

// Release claimed jobs whose heartbeat has stopped, back to PENDING while the
// attempt budget remains, else FAILED. The updates are batched by target status
// so a backlog costs two round-trips rather than one per row.
export const requeueStaleClaims = async (db: DrizzleClient, nowMs: number) => {
  const claimed = await db
    .select({
      id: devJob.id,
      claimedAt: devJob.claimedAt,
      heartbeatAt: devJob.heartbeatAt,
      attemptCount: devJob.attemptCount,
    })
    .from(devJob)
    .where(eq(devJob.status, "CLAIMED"));

  const toPending: number[] = [];
  const toFailed: number[] = [];
  for (const job of claimed) {
    const claimedAtMs = job.claimedAt?.getTime() ?? 0;
    const heartbeatAtMs = job.heartbeatAt?.getTime() ?? null;
    if (!isClaimStale({ claimedAt: claimedAtMs, heartbeatAt: heartbeatAtMs }, nowMs))
      continue;
    (releaseJobStatus(job.attemptCount) === "FAILED" ? toFailed : toPending).push(
      job.id,
    );
  }

  const stale = [...toPending, ...toFailed];
  if (stale.length === 0) return 0;

  // The snapshot decided staleness, but the client may have heartbeated since.
  // Without carrying that into the compare-and-swap the update would yank a job
  // that is actively running again, so re-assert the same condition at write
  // time: no signal — claim or heartbeat — newer than the cutoff.
  const cutoff = new Date(nowMs - CONTRIBUTION_STALE_CLAIM_MS);
  const stillStale = and(
    eq(devJob.status, "CLAIMED"),
    lte(devJob.claimedAt, cutoff),
    or(isNull(devJob.heartbeatAt), lte(devJob.heartbeatAt, cutoff)),
  );

  const [pendingResult, failedResult] = await Promise.all([
    toPending.length
      ? db
          .update(devJob)
          .set({
            status: "PENDING",
            ...clearClaimFields,
            error: "Claim timed out; requeued",
            updatedAt: new Date(),
          })
          .where(and(inArray(devJob.id, toPending), stillStale))
      : Promise.resolve({ rowsAffected: 0 }),
    toFailed.length
      ? db
          .update(devJob)
          .set({
            status: "FAILED",
            ...clearClaimFields,
            error: "Claim timed out; attempt budget exhausted",
            updatedAt: new Date(),
          })
          .where(and(inArray(devJob.id, toFailed), stillStale))
      : Promise.resolve({ rowsAffected: 0 }),
  ]);

  await releaseClaimSlots(db, stale);
  return pendingResult.rowsAffected + failedResult.rowsAffected;
};

/**
 * Re-check jobs whose result GitHub could not confirm when the client reported
 * them. Without this a transient rate limit or propagation delay would burn a
 * contributor's completed work; here it simply gets another look, until
 * CONTRIBUTION_VERIFY_RETRY_MS has elapsed.
 */
export const resolvePendingVerifications = async (
  db: DrizzleClient,
  nowMs: number,
  options: { fetchImpl?: FetchImpl; token?: string } = {},
): Promise<{ resolved: number; rewarded: number; errors: string[] }> => {
  const fetchImpl = options.fetchImpl ?? ghFetch;
  const errors: string[] = [];
  const pending = await db
    .select()
    .from(devJob)
    .where(eq(devJob.status, "VERIFYING"))
    .orderBy(devJob.updatedAt)
    .limit(CONTRIBUTION_VERIFY_BATCH_SIZE);
  if (pending.length === 0) return { resolved: 0, rewarded: 0, errors };

  const userIds = [...new Set(pending.map((j) => j.claimedByUserId).filter(Boolean))];
  const profiles = userIds.length
    ? await db
        .select()
        .from(devContributionProfile)
        .where(inArray(devContributionProfile.userId, userIds as string[]))
    : [];
  const loginFor = new Map(profiles.map((p) => [p.userId, p.githubLogin ?? ""]));

  let resolved = 0;
  let rewarded = 0;

  for (const job of pending) {
    const userId = job.claimedByUserId;
    if (!userId) continue;
    // Each job is isolated: one that keeps throwing — for instance the
    // deliberate rethrow when a payout fails — must not stall every other
    // contributor's pending verification on this and every later tick.
    try {
      const claimedAt = job.claimedAt?.getTime() ?? job.createdAt.getTime();
      const verification = await verifyContributionResult(
        {
          jobType: job.jobType,
          refNumber: job.refNumber,
          // The login proven when the job was claimed, not whatever the profile
          // says now: unlinking or re-verifying in between must not strand or
          // retarget work already submitted.
          githubLogin: job.claimedGithubLogin ?? loginFor.get(userId) ?? "",
          claimedAt,
          nowMs,
          windowMs: CONTRIBUTION_VERIFY_WINDOW_MS,
        },
        { fetchImpl, token: options.token },
      );

      const expired = nowMs - claimedAt > CONTRIBUTION_VERIFY_RETRY_MS;
      if (!verification.verified && verification.retryable && !expired) {
        // Rotate this job to the back of the updatedAt ordering so a batch of
        // perpetually-retrying jobs cannot monopolise every tick and starve
        // newer VERIFYING jobs (which would otherwise never be fetched until
        // the stuck ones cross the retry expiry).
        await db
          .update(devJob)
          .set({ updatedAt: new Date() })
          .where(and(eq(devJob.id, job.id), eq(devJob.status, "VERIFYING")));
        continue; // leave VERIFYING; try again next tick
      }

      let reward = null;
      if (verification.verified) {
        reward = await grantContributionReward({
          client: db,
          userId,
          jobId: job.id,
          jobType: job.jobType,
          today: getUtcDateString(new Date(nowMs)),
          artifactUrl: verification.resultUrl,
        });
      }

      const closed = await db
        .update(devJob)
        .set({
          // Only confirmed work retires the ref. Closing an unconfirmed job as
          // COMPLETED would make planIssueJob treat the issue as permanently
          // done, so release it under the attempt budget instead and let the
          // backfill re-offer it while attempts remain.
          status: verification.verified
            ? "COMPLETED"
            : releaseJobStatus(job.attemptCount),
          completedAt: verification.verified ? new Date(nowMs) : null,
          ...(verification.verified ? {} : clearClaimFields),
          resultUrl: verification.resultUrl ?? job.resultUrl,
          error: verification.verified
            ? null
            : (verification.error ?? "Result could not be verified"),
          updatedAt: new Date(),
        })
        .where(and(eq(devJob.id, job.id), eq(devJob.status, "VERIFYING")));

      if (closed.rowsAffected === 1) {
        resolved += 1;
        if (reward) rewarded += 1;
        if (verification.verified) {
          // completeJob only bumps the leaderboard counter when GitHub confirms
          // inline; work deferred to VERIFYING has to be counted here, or a
          // transient GitHub failure would keep it off the leaderboard forever.
          // Gated on the CAS above so it can only ever run once per job.
          await db
            .update(devContributionProfile)
            .set({
              totalJobsCompleted: sql`${devContributionProfile.totalJobsCompleted} + 1`,
              updatedAt: new Date(),
            })
            .where(eq(devContributionProfile.userId, userId));
        }
      }
    } catch (error) {
      errors.push(
        `job ${job.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return { resolved, rewarded, errors };
};

/**
 * Clear claim slots pointing at jobs that are no longer in flight. Guards
 * against a slot leaking if a process died between taking the slot and
 * updating the job row.
 */
export const releaseOrphanedClaimSlots = async (db: DrizzleClient) => {
  const held = await db
    .select({
      userId: devContributionProfile.userId,
      activeJobId: devContributionProfile.activeJobId,
    })
    .from(devContributionProfile)
    .where(isNotNull(devContributionProfile.activeJobId));
  if (held.length === 0) return 0;

  const jobIds = held.map((h) => h.activeJobId as number);
  const liveRows = await db
    .select({ id: devJob.id, status: devJob.status })
    .from(devJob)
    .where(inArray(devJob.id, jobIds));
  // Only a CLAIMED job legitimately holds the slot; VERIFYING releases it at
  // submission time so the contributor can start their next job.
  const live = new Set(liveRows.filter((j) => j.status === "CLAIMED").map((j) => j.id));

  const stale = held.filter((h) => !live.has(h.activeJobId as number));
  if (stale.length === 0) return 0;
  // Compare-and-swap on the job id that was read: a slot legitimately re-taken
  // between the read above and this write must not be cleared out from under
  // the claim that now holds it.
  let cleared = 0;
  for (const slot of stale) {
    const result = await db
      .update(devContributionProfile)
      .set({ activeJobId: null, updatedAt: new Date() })
      .where(
        and(
          eq(devContributionProfile.userId, slot.userId),
          eq(devContributionProfile.activeJobId, slot.activeJobId as number),
        ),
      );
    cleared += result.rowsAffected;
  }
  return cleared;
};

// GitHub's /issues endpoint also returns pull requests; those are skipped here
// because they are handled through the /pulls feed.
export const fetchOpenIssues = async (
  fetchImpl: FetchImpl,
  token: string | undefined,
): Promise<{ refs: OpenIssueRef[]; truncated: boolean }> => {
  const issues: OpenIssueRef[] = [];
  let truncated = true;
  for (let page = 1; page <= ISSUE_PAGE_LIMIT; page++) {
    const res = await fetchImpl(
      `${GITHUB_API_ENDPOINT}/issues?state=open&per_page=100&page=${page}`,
      { headers: ghHeaders(token) },
    );
    if (!res.ok) throw new Error(`GitHub issues fetch failed: ${res.status}`);
    const items = (await res.json()) as GitHubIssue[];
    for (const item of items) {
      if (item.pull_request) continue;
      issues.push({
        number: item.number,
        title: item.title,
        labels: (item.labels ?? []).map((l) => l.name),
        body: item.body ?? undefined,
        url: item.html_url,
        authorLogin: item.user?.login,
      });
    }
    if (items.length < 100) {
      truncated = false;
      break;
    }
  }
  return { refs: issues, truncated };
};

export const fetchOpenPullRequests = async (
  fetchImpl: FetchImpl,
  token: string | undefined,
): Promise<{ refs: OpenPullRequestRef[]; truncated: boolean }> => {
  const prs: OpenPullRequestRef[] = [];
  let truncated = true;
  for (let page = 1; page <= PR_PAGE_LIMIT; page++) {
    const res = await fetchImpl(
      `${GITHUB_API_ENDPOINT}/pulls?state=open&per_page=100&page=${page}`,
      { headers: ghHeaders(token) },
    );
    if (!res.ok) throw new Error(`GitHub pulls fetch failed: ${res.status}`);
    const items = (await res.json()) as GitHubPullRequest[];
    for (const item of items) {
      const headOwner = normalize(item.head?.repo?.owner?.login);
      const baseOwner = normalize(item.base?.repo?.owner?.login);
      prs.push({
        number: item.number,
        title: item.title,
        labels: (item.labels ?? []).map((l) => l.name),
        body: item.body ?? undefined,
        url: item.html_url,
        authorLogin: item.user?.login ?? "",
        isCrossFork: !!headOwner && !!baseOwner && headOwner !== baseOwner,
        isBot: item.user?.type === "Bot",
      });
    }
    if (items.length < 100) {
      truncated = false;
      break;
    }
  }
  return { refs: prs, truncated };
};

// Create the "Fully Clarified" label when it is missing (the game's label that
// marks an issue as ready for implementation).
export const ensureClarifiedLabel = async (
  fetchImpl: FetchImpl,
  token: string | undefined,
): Promise<boolean> => {
  const target = normalize(CONTRIBUTION_CLARIFIED_LABEL);
  for (let page = 1; page <= 5; page++) {
    const res = await fetchImpl(
      `${GITHUB_API_ENDPOINT}/labels?per_page=100&page=${page}`,
      { headers: ghHeaders(token) },
    );
    if (!res.ok) throw new Error(`GitHub labels fetch failed: ${res.status}`);
    const labels = (await res.json()) as Array<{ name: string }>;
    if (labels.some((l) => normalize(l.name) === target)) return true;
    if (labels.length < 100) break;
  }

  const create = await fetchImpl(`${GITHUB_API_ENDPOINT}/labels`, {
    method: "POST",
    headers: { ...ghHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ name: CONTRIBUTION_CLARIFIED_LABEL, color: "2eaa3c" }),
  });
  // 201 created; 422 typically means the label already exists (race).
  return create.ok || create.status === 422;
};

/**
 * Read only the jobs that belong to the refs GitHub just reported. The previous
 * implementation selected the whole table on every tick, which grew without
 * bound and eventually blew the cron's memory/time budget.
 */
const fetchJobsForRefs = async (
  db: DrizzleClient,
  issueNumbers: number[],
  prNumbers: number[],
): Promise<ExistingJob[]> => {
  const parts: Promise<ExistingJob[]>[] = [];
  const select = (refKind: "ISSUE" | "PULL_REQUEST", numbers: number[]) =>
    db
      .select({
        id: devJob.id,
        jobType: devJob.jobType,
        refKind: devJob.refKind,
        refNumber: devJob.refNumber,
        status: devJob.status,
        claimedByUserId: devJob.claimedByUserId,
        attemptCount: devJob.attemptCount,
      })
      .from(devJob)
      .where(and(eq(devJob.refKind, refKind), inArray(devJob.refNumber, numbers)));

  if (issueNumbers.length) parts.push(select("ISSUE", issueNumbers));
  if (prNumbers.length) parts.push(select("PULL_REQUEST", prNumbers));
  if (parts.length === 0) return [];
  const chunks = await Promise.all(parts);
  return chunks.flat();
};

export const runMaintenance = async (
  db: DrizzleClient,
  options: { fetchImpl?: FetchImpl; token?: string } = {},
): Promise<MaintenanceReport> => {
  const fetchImpl = options.fetchImpl ?? ghFetch;
  const token = options.token;
  const nowMs = Date.now();
  const report: MaintenanceReport = {
    staleRequeued: 0,
    verificationsResolved: 0,
    verificationsRewarded: 0,
    jobsCreated: 0,
    jobsCancelled: 0,
    labelEnsured: false,
    errors: [],
  };

  const note = (label: string, error: unknown) =>
    report.errors.push(
      `${label}: ${error instanceof Error ? error.message : String(error)}`,
    );

  // Stale requeue does not depend on GitHub.
  try {
    report.staleRequeued = await requeueStaleClaims(db, nowMs);
    await releaseOrphanedClaimSlots(db);
  } catch (error) {
    note("stale requeue failed", error);
  }

  try {
    const { resolved, rewarded, errors } = await resolvePendingVerifications(
      db,
      nowMs,
      { fetchImpl, token },
    );
    report.verificationsResolved = resolved;
    report.verificationsRewarded = rewarded;
    report.errors.push(...errors);
  } catch (error) {
    note("verification retry failed", error);
  }

  try {
    report.labelEnsured = await ensureClarifiedLabel(fetchImpl, token);
  } catch (error) {
    note("label check failed", error);
  }

  try {
    const [issueFeed, prFeed] = await Promise.all([
      fetchOpenIssues(fetchImpl, token),
      fetchOpenPullRequests(fetchImpl, token),
    ]);
    const issues = issueFeed.refs;
    const pullRequests = prFeed.refs;
    const existingJobs = await fetchJobsForRefs(
      db,
      issues.map((i) => i.number),
      pullRequests.map((p) => p.number),
    );

    const { specs, cancelJobIds } = computeBackfillJobs({
      issues,
      pullRequests,
      existingJobs,
    });
    report.jobsCancelled = await cancelObsoleteJobs(db, cancelJobIds);
    // One re-read plus one multi-row insert, rather than a SELECT and an INSERT
    // per spec: the loop form cost 2N serialized round-trips against a database
    // the repo asks us to make as few trips to as possible.
    const capped = specs.slice(0, CONTRIBUTION_BACKFILL_BATCH_SIZE);
    if (capped.length < specs.length) {
      report.errors.push(
        `backfill capped at ${CONTRIBUTION_BACKFILL_BATCH_SIZE} of ${specs.length} jobs; the rest follow next tick`,
      );
    }
    if (capped.length > 0) {
      // Re-read active jobs for exactly these refs, so a webhook insert that
      // landed between the first read and now is still seen.
      const active = await fetchJobsForRefs(
        db,
        capped.filter((c) => c.refKind === "ISSUE").map((c) => c.refNumber),
        capped.filter((c) => c.refKind === "PULL_REQUEST").map((c) => c.refNumber),
      );
      const taken = new Set(
        active
          .filter((j) => isJobActive(j.status))
          .map((j) => `${j.refKind}:${j.refNumber}:${j.jobType}`),
      );
      const rows = capped
        .filter(
          (spec) => !taken.has(`${spec.refKind}:${spec.refNumber}:${spec.jobType}`),
        )
        .map((spec) => ({
          jobType: spec.jobType,
          refKind: spec.refKind,
          refNumber: spec.refNumber,
          refUrl: spec.refUrl,
          status: "PENDING" as const,
          contextJson: JSON.stringify(spec.context),
        }));
      if (rows.length > 0) {
        await db.insert(devJob).values(rows);
        report.jobsCreated += rows.length;
      }
    }

    // Close direction: a ref that is no longer open should not keep a PENDING
    // job. Only safe when the feed was complete — if it truncated, absence just
    // means the ref fell past the page cap.
    if (!issueFeed.truncated && !prFeed.truncated) {
      const openIssues = new Set(issues.map((i) => i.number));
      const openPrs = new Set(pullRequests.map((p) => p.number));
      const pending = await db
        .select({ id: devJob.id, refKind: devJob.refKind, refNumber: devJob.refNumber })
        .from(devJob)
        .where(eq(devJob.status, "PENDING"))
        .limit(1000);
      const orphaned = pending
        .filter((j) =>
          j.refKind === "ISSUE"
            ? !openIssues.has(j.refNumber)
            : !openPrs.has(j.refNumber),
        )
        .map((j) => j.id);
      report.jobsCancelled += await cancelObsoleteJobs(db, orphaned);
    }
  } catch (error) {
    note("backfill failed", error);
  }

  // Cancel duplicate PENDING rows for a ref+type, keeping the oldest. Nothing
  // can make the webhook/cron insert atomic without transactions, so the
  // duplicate is reconciled here instead of pretending it cannot happen.
  try {
    const duplicates = await db
      .select({
        id: devJob.id,
        jobType: devJob.jobType,
        refKind: devJob.refKind,
        refNumber: devJob.refNumber,
      })
      .from(devJob)
      .where(eq(devJob.status, "PENDING"))
      .limit(1000);
    const seen = new Set<string>();
    const extra: number[] = [];
    for (const job of duplicates.sort((a, b) => a.id - b.id)) {
      const key = `${job.refKind}:${job.refNumber}:${job.jobType}`;
      if (seen.has(key)) extra.push(job.id);
      else seen.add(key);
    }
    if (extra.length > 0) {
      await db
        .update(devJob)
        .set({ status: "CANCELLED", error: "Duplicate job", updatedAt: new Date() })
        .where(and(inArray(devJob.id, extra), eq(devJob.status, "PENDING")));
    }
  } catch (error) {
    note("duplicate cleanup failed", error);
  }

  return report;
};
