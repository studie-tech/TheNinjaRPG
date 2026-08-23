// Webhook-driven dev-contribution job creation.
//
// GitHub sends `issues` and `pull_request` events to the app's webhook. This
// module translates the relevant ones into job rows, reusing the same pure
// eligibility logic as the cron backfill so both paths stay consistent.
//
// Inserts are guarded by a fresh re-read of the ref's jobs immediately before
// writing. Without transactions that narrows the webhook-vs-cron race rather
// than closing it, so runMaintenance also reconciles any duplicate PENDING rows
// that slip through.

import { and, eq, inArray } from "drizzle-orm";
import { devJob } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { planIssueJob, shouldCreatePrReviewJob } from "./jobs";
import { cancelObsoleteJobs } from "./maintenance";
import type { ExistingJob } from "./types";

export interface WebhookEventSummary {
  created: string[];
  cancelled: number;
}

type JobRow = typeof devJob.$inferSelect;

export const rowToExisting = (row: JobRow): ExistingJob => ({
  id: row.id,
  jobType: row.jobType,
  refKind: row.refKind,
  refNumber: row.refNumber,
  status: row.status,
  claimedByUserId: row.claimedByUserId,
  attemptCount: row.attemptCount,
});

const fetchJobsForRef = async (
  db: DrizzleClient,
  refKind: "PULL_REQUEST" | "ISSUE",
  refNumber: number,
) => {
  const rows = await db
    .select()
    .from(devJob)
    .where(and(eq(devJob.refKind, refKind), eq(devJob.refNumber, refNumber)));
  return rows.map(rowToExisting);
};

/** Fresh check for an in-flight job of this exact ref + type. */
const hasActiveJob = async (
  db: DrizzleClient,
  refKind: "PULL_REQUEST" | "ISSUE",
  refNumber: number,
  jobType: ExistingJob["jobType"],
): Promise<boolean> => {
  const rows = await db
    .select({ id: devJob.id })
    .from(devJob)
    .where(
      and(
        eq(devJob.refKind, refKind),
        eq(devJob.refNumber, refNumber),
        eq(devJob.jobType, jobType),
        inArray(devJob.status, ["PENDING", "CLAIMED", "VERIFYING"]),
      ),
    )
    .limit(1);
  return rows.length > 0;
};

const cancelPending = async (db: DrizzleClient, ids: number[]): Promise<number> => {
  if (ids.length === 0) return 0;
  const result = await db
    .update(devJob)
    .set({
      status: "CANCELLED",
      claimedByUserId: null,
      claimedAt: null,
      heartbeatAt: null,
      agent: null,
      updatedAt: new Date(),
    })
    .where(and(inArray(devJob.id, ids), eq(devJob.status, "PENDING")));
  return result.rowsAffected;
};

/**
 * Handle an `issues` webhook event (opened / edited / labeled / unlabeled /
 * closed) for contribution job purposes.
 */
export const processContributionIssueEvent = async (
  db: DrizzleClient,
  issue: {
    number: number;
    title: string;
    labels: string[];
    body?: string | null;
    html_url: string;
    state: string;
    action: string;
    authorLogin?: string;
  },
): Promise<WebhookEventSummary> => {
  const summary: WebhookEventSummary = { created: [], cancelled: 0 };
  const existing = await fetchJobsForRef(db, "ISSUE", issue.number);

  // A closed issue invalidates any not-yet-started work on it.
  if (issue.state === "closed" || issue.action === "closed") {
    const pendingIds = existing.filter((j) => j.status === "PENDING").map((j) => j.id);
    summary.cancelled = await cancelPending(db, pendingIds);
    return summary;
  }

  const plan = planIssueJob({ number: issue.number, labels: issue.labels }, existing);

  if (plan.cancelJobIds.length > 0) {
    // Obsolete jobs, not merely pending ones: a CLAIMED triage job on an issue
    // that has just been clarified is now pointless work that would still pay.
    summary.cancelled = await cancelObsoleteJobs(db, plan.cancelJobIds);
  }

  if (plan.create) {
    // Re-read (not the snapshot above, which planIssueJob already consumed) so a
    // job inserted since then is seen.
    const racing = await hasActiveJob(db, "ISSUE", issue.number, plan.create);
    if (!racing) {
      await db.insert(devJob).values({
        jobType: plan.create,
        refKind: "ISSUE",
        refNumber: issue.number,
        refUrl: issue.html_url,
        status: "PENDING",
        contextJson: JSON.stringify({
          title: issue.title,
          labels: issue.labels,
          body: issue.body ?? undefined,
          authorLogin: issue.authorLogin,
        }),
      });
      summary.created.push(plan.create);
    }
  }

  return summary;
};

/**
 * Handle a `pull_request` webhook event (opened / reopened / synchronize /
 * closed) for contribution job purposes.
 */
export const processContributionPullRequestEvent = async (
  db: DrizzleClient,
  pr: {
    number: number;
    title: string;
    labels: string[];
    body?: string | null;
    html_url: string;
    state: string;
    action: string;
    authorLogin: string;
    authorIsBot: boolean;
    isCrossFork: boolean;
  },
): Promise<WebhookEventSummary> => {
  const summary: WebhookEventSummary = { created: [], cancelled: 0 };
  const existing = await fetchJobsForRef(db, "PULL_REQUEST", pr.number);

  // A closed/merged PR invalidates pending reviews of it.
  if (pr.state === "closed" || pr.action === "closed") {
    const pendingIds = existing
      .filter((j) => j.status === "PENDING" && j.jobType === "PR_REVIEW")
      .map((j) => j.id);
    summary.cancelled = await cancelPending(db, pendingIds);
    return summary;
  }

  if (shouldCreatePrReviewJob({ ...pr, isBot: pr.authorIsBot }, existing)) {
    const racing = await hasActiveJob(db, "PULL_REQUEST", pr.number, "PR_REVIEW");
    if (!racing) {
      await db.insert(devJob).values({
        jobType: "PR_REVIEW",
        refKind: "PULL_REQUEST",
        refNumber: pr.number,
        refUrl: pr.html_url,
        status: "PENDING",
        contextJson: JSON.stringify({
          title: pr.title,
          labels: pr.labels,
          body: pr.body ?? undefined,
          authorLogin: pr.authorLogin,
          isCrossFork: pr.isCrossFork,
        }),
      });
      summary.created.push("PR_REVIEW");
    }
  }

  return summary;
};
