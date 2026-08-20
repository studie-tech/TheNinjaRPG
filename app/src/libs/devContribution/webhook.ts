// Webhook-driven dev-contribution job creation.
//
// GitHub sends `issues` and `pull_request` events to the app's webhook. This
// module translates the relevant ones into job rows, reusing the same pure
// eligibility logic as the cron backfill so both paths stay consistent.
//
// All inserts are guarded by a re-read of the ref's existing jobs so a webhook
// event racing with the cron backfill cannot create duplicates.

import { and, eq, inArray } from "drizzle-orm";
import { devJob } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { planIssueJob, shouldCreatePrReviewJob } from "./jobs";
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
    summary.cancelled = await cancelPending(db, plan.cancelJobIds);
  }

  if (plan.create) {
    // Re-check for a racing insert (webhook vs cron) before writing.
    const racing = existing.some(
      (j) =>
        j.jobType === plan.create && (j.status === "PENDING" || j.status === "CLAIMED"),
    );
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
    const racing = existing.some(
      (j) =>
        j.jobType === "PR_REVIEW" && (j.status === "PENDING" || j.status === "CLAIMED"),
    );
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
