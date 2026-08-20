// Periodic maintenance for dev-contribution jobs, run by the Vercel cron
// endpoint /api/dev-contribution-maintenance.
//
// Three responsibilities:
//  1. Requeue stale claims (claimed jobs whose heartbeat stopped).
//  2. Ensure the "Fully Clarified" label exists on the repository.
//  3. Backfill jobs from GitHub's open issues / PRs so work is never stuck
//     waiting on a missed webhook.
//
// All network access is injectable for testing; the cron route passes the real
// fetch + GITHUB_ISSUE_TOKEN.

import { and, eq } from "drizzle-orm";
import { CONTRIBUTION_CLARIFIED_LABEL, GITHUB_API_ENDPOINT } from "@/drizzle/constants";
import { devJob } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { type FetchImpl, ghFetch, ghHeaders } from "./github";
import { computeBackfillJobs, isClaimStale, releaseJobStatus } from "./jobs";
import type { ExistingJob, OpenIssueRef, OpenPullRequestRef } from "./types";
import { rowToExisting } from "./webhook";

export interface MaintenanceReport {
  staleRequeued: number;
  jobsCreated: number;
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

const normalize = (value: string | null | undefined) => value?.toLowerCase() ?? "";

// Release claimed jobs whose heartbeat has stopped, back to PENDING while the
// attempt budget remains, else FAILED.
export const requeueStaleClaims = async (db: DrizzleClient, nowMs: number) => {
  const claimed = await db.select().from(devJob).where(eq(devJob.status, "CLAIMED"));
  let requeued = 0;

  for (const job of claimed) {
    const claimedAtMs = job.claimedAt?.getTime() ?? 0;
    const heartbeatAtMs = job.heartbeatAt?.getTime() ?? null;
    if (!isClaimStale({ claimedAt: claimedAtMs, heartbeatAt: heartbeatAtMs }, nowMs))
      continue;

    const nextStatus = releaseJobStatus(job.attemptCount);
    const result = await db
      .update(devJob)
      .set({
        status: nextStatus,
        claimedByUserId: null,
        claimedAt: null,
        heartbeatAt: null,
        agent: null,
        error:
          nextStatus === "FAILED"
            ? "Claim timed out; attempt budget exhausted"
            : "Claim timed out; requeued",
        updatedAt: new Date(),
      })
      .where(and(eq(devJob.id, job.id), eq(devJob.status, "CLAIMED")));
    requeued += result.rowsAffected;
  }

  return requeued;
};

// GitHub's /issues endpoint also returns pull requests; those are skipped here
// because they are handled through the /pulls feed.
export const fetchOpenIssues = async (
  fetchImpl: FetchImpl,
  token: string | undefined,
): Promise<OpenIssueRef[]> => {
  const issues: OpenIssueRef[] = [];
  for (let page = 1; page <= 5; page++) {
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
      });
    }
    if (items.length < 100) break;
  }
  return issues;
};

export const fetchOpenPullRequests = async (
  fetchImpl: FetchImpl,
  token: string | undefined,
): Promise<OpenPullRequestRef[]> => {
  const prs: OpenPullRequestRef[] = [];
  for (let page = 1; page <= 3; page++) {
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
    if (items.length < 100) break;
  }
  return prs;
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

export const runMaintenance = async (
  db: DrizzleClient,
  options: { fetchImpl?: FetchImpl; token?: string } = {},
): Promise<MaintenanceReport> => {
  const fetchImpl = options.fetchImpl ?? ghFetch;
  const token = options.token;
  const report: MaintenanceReport = {
    staleRequeued: 0,
    jobsCreated: 0,
    labelEnsured: false,
    errors: [],
  };

  // Stale requeue does not depend on GitHub.
  try {
    report.staleRequeued = await requeueStaleClaims(db, Date.now());
  } catch (error) {
    report.errors.push(
      `stale requeue failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    report.labelEnsured = await ensureClarifiedLabel(fetchImpl, token);
  } catch (error) {
    report.errors.push(
      `label check failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    const [issues, pullRequests] = await Promise.all([
      fetchOpenIssues(fetchImpl, token),
      fetchOpenPullRequests(fetchImpl, token),
    ]);
    const existingRows = await db.select().from(devJob);
    const existingJobs: ExistingJob[] = existingRows.map(rowToExisting);

    const specs = computeBackfillJobs({ issues, pullRequests, existingJobs });
    for (const spec of specs) {
      // Belt and braces: skip if an active job for this ref+type appeared
      // between the read and now (e.g. a webhook event just landed).
      const active = existingJobs.some(
        (j) =>
          j.refKind === spec.refKind &&
          j.refNumber === spec.refNumber &&
          j.jobType === spec.jobType &&
          (j.status === "PENDING" || j.status === "CLAIMED"),
      );
      if (active) continue;
      await db.insert(devJob).values({
        jobType: spec.jobType,
        refKind: spec.refKind,
        refNumber: spec.refNumber,
        refUrl: spec.refUrl,
        status: "PENDING",
        contextJson: JSON.stringify(spec.context),
      });
      report.jobsCreated += 1;
    }
  } catch (error) {
    report.errors.push(
      `backfill failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return report;
};
