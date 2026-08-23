import {
  CONTRIBUTION_CLARIFIED_LABEL,
  CONTRIBUTION_CLOCK_SKEW_MS,
  CONTRIBUTION_JOB_PRIORITY,
  CONTRIBUTION_MAX_ATTEMPTS,
  CONTRIBUTION_MAX_JOBS_PER_DAY,
  CONTRIBUTION_MAX_REVIEWS_PER_PR,
  CONTRIBUTION_STALE_CLAIM_MS,
  type ContributionJobType,
} from "@/drizzle/constants";
import type {
  BackfillInput,
  ClaimedJobState,
  ExistingJob,
  JobSpec,
  OpenIssueRef,
  OpenPullRequestRef,
  VerificationInput,
} from "./types";

const normalizeLabel = (label: string) => label.trim().toLowerCase();

const CLARIFIED_LABEL = normalizeLabel(CONTRIBUTION_CLARIFIED_LABEL);

// A job is "in flight" when it has not reached a terminal state.
const ACTIVE_STATUSES = new Set(["PENDING", "CLAIMED", "VERIFYING"]);
const TERMINAL_STATUSES = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

export const isJobActive = (status: ExistingJob["status"]) =>
  ACTIVE_STATUSES.has(status);
export const isJobTerminal = (status: ExistingJob["status"]) =>
  TERMINAL_STATUSES.has(status);

// ─────────────────────────────────────────────────────────────────────────────
// Label / eligibility
// ─────────────────────────────────────────────────────────────────────────────

export const hasLabel = (labels: string[], label: string) => {
  const target = normalizeLabel(label);
  return labels.some((l) => normalizeLabel(l) === target);
};

// An open issue is a triage candidate when it has NOT been fully clarified yet.
export const isTriageCandidate = (labels: string[]) =>
  !hasLabel(labels, CLARIFIED_LABEL);

// An open issue is an implementation candidate only once fully clarified.
export const isImplementationCandidate = (labels: string[]) =>
  hasLabel(labels, CLARIFIED_LABEL);

// ─────────────────────────────────────────────────────────────────────────────
// Dedup / creation decisions
// ─────────────────────────────────────────────────────────────────────────────

const jobsForRef = (
  jobs: ExistingJob[],
  refKind: ExistingJob["refKind"],
  refNumber: number,
) => jobs.filter((j) => j.refKind === refKind && j.refNumber === refNumber);

// Decide which issue job (if any) should exist for an open issue.
// Returns "CREATE" with the desired type, "NONE", plus a list of job ids that
// should be cancelled (e.g. a triage job that is now obsolete because the issue
// has been clarified).
export const planIssueJob = (
  issue: Pick<OpenIssueRef, "number" | "labels">,
  jobs: ExistingJob[],
): { create: ContributionJobType | null; cancelJobIds: number[] } => {
  const forRef = jobsForRef(jobs, "ISSUE", issue.number);
  const wanted = isImplementationCandidate(issue.labels)
    ? "ISSUE_IMPLEMENT"
    : isTriageCandidate(issue.labels)
      ? "ISSUE_TRIAGE"
      : null;

  if (!wanted) {
    return { create: null, cancelJobIds: [] };
  }

  const active = forRef.filter((j) => isJobActive(j.status));
  const desiredActive = active.filter((j) => j.jobType === wanted);

  // An active job of the desired type already exists → nothing to do.
  if (desiredActive.length > 0) {
    return { create: null, cancelJobIds: [] };
  }

  // A settled job of the desired type already exists → do not re-issue it.
  // FAILED counts here: a job that exhausted its attempt budget must not be
  // resurrected by the next backfill pass, or the cron re-creates it forever
  // (with attemptCount reset) for any issue agents cannot finish.
  //
  // CANCELLED deliberately does NOT count: closing an issue cancels its pending
  // job, and an issue that is later reopened must be able to get one again.
  const desiredTerminal = forRef.filter(
    (j) => j.jobType === wanted && (j.status === "COMPLETED" || j.status === "FAILED"),
  );
  if (desiredTerminal.length > 0) {
    return { create: null, cancelJobIds: [] };
  }

  // If the issue state changed (e.g. got clarified), any active job of the OTHER
  // type is obsolete and should be cancelled.
  const obsoleteActive = active.filter((j) => j.jobType !== wanted).map((j) => j.id);

  return { create: wanted, cancelJobIds: obsoleteActive };
};

// Decide whether a pull request should get a new review job.
// Loop guards:
//  - only cross-fork (community) PRs, never bot-authored PRs;
//  - at most CONTRIBUTION_MAX_REVIEWS_PER_PR review jobs ever per PR;
//  - at most one in-flight (PENDING/CLAIMED) review job at a time.
export const shouldCreatePrReviewJob = (
  pr: Pick<OpenPullRequestRef, "number" | "authorLogin" | "isCrossFork" | "isBot">,
  jobs: ExistingJob[],
): boolean => {
  if (pr.isBot || !pr.isCrossFork) {
    return false;
  }
  const reviews = jobsForRef(jobs, "PULL_REQUEST", pr.number).filter(
    (j) => j.jobType === "PR_REVIEW",
  );
  // A cancelled review performed no review — a duplicate the reconciliation
  // dropped, or one voided when the PR briefly closed. Counting it would spend
  // the PR's review budget on work nobody did.
  const total = reviews.filter((j) => j.status !== "CANCELLED").length;
  if (total >= CONTRIBUTION_MAX_REVIEWS_PER_PR) {
    return false;
  }
  const inFlight = reviews.filter((j) => isJobActive(j.status)).length;
  return inFlight === 0;
};

// ─────────────────────────────────────────────────────────────────────────────
// Backfill / reconciliation
// ─────────────────────────────────────────────────────────────────────────────

// Diff GitHub's open refs against existing jobs and return the specs to create.
// This is the single source of truth for job creation, used by both the cron
// backfill and (as a guard) the webhook path.
export const computeBackfillJobs = (
  input: BackfillInput,
): { specs: JobSpec[]; cancelJobIds: number[] } => {
  const specs: JobSpec[] = [];
  // Jobs whose type is no longer the one the issue wants (e.g. a triage job on
  // an issue that has since been clarified). The webhook path already cancels
  // these; the cron has to as well, or a missed webhook leaves both job types
  // live on the same issue and the obsolete one still pays out.
  const cancelJobIds: number[] = [];

  for (const issue of input.issues) {
    const plan = planIssueJob(issue, input.existingJobs);
    cancelJobIds.push(...plan.cancelJobIds);
    if (plan.create) {
      specs.push({
        jobType: plan.create,
        refKind: "ISSUE",
        refNumber: issue.number,
        refUrl: issue.url,
        context: {
          title: issue.title,
          labels: issue.labels,
          body: issue.body,
          authorLogin: issue.authorLogin,
        },
      });
    }
  }

  for (const pr of input.pullRequests) {
    if (shouldCreatePrReviewJob(pr, input.existingJobs)) {
      specs.push({
        jobType: "PR_REVIEW",
        refKind: "PULL_REQUEST",
        refNumber: pr.number,
        refUrl: pr.url,
        context: {
          title: pr.title,
          labels: pr.labels,
          body: pr.body,
          authorLogin: pr.authorLogin,
          isCrossFork: pr.isCrossFork,
        },
      });
    }
  }

  return { specs, cancelJobIds };
};

// ─────────────────────────────────────────────────────────────────────────────
// Claiming
// ─────────────────────────────────────────────────────────────────────────────

// Is the user's daily token cap (for this agent) already exhausted?
export const isTokenCapExceeded = (tokensUsed: number, cap: number) => {
  return cap > 0 && tokensUsed >= cap;
};

// Can this user claim more work today at all (global job cap)?
export const hasJobsRemainingToday = (jobsCompletedToday: number) =>
  jobsCompletedToday < CONTRIBUTION_MAX_JOBS_PER_DAY;

// Filter + rank pending jobs that a user may claim.
//  - only PENDING jobs;
//  - never the same (ref + type) the user already has an active or completed job for;
//  - never a ref the user authored themselves (applied via excludeSelfAuthored);
//  - ordered by priority (implement > review > triage), then oldest first.
export const selectClaimCandidates = <T extends ExistingJob>(
  pending: T[],
  userJobs: ExistingJob[],
): T[] => {
  const userBusy = new Set(
    userJobs
      .filter((j) => isJobActive(j.status) || j.status === "COMPLETED")
      .map((j) => `${j.refKind}:${j.refNumber}:${j.jobType}`),
  );

  // No self-authored work: the requester must not have opened the issue/PR. The
  // author login is carried on the job context, so that filter lives in
  // excludeSelfAuthored and is applied by the caller.
  const eligible = pending.filter((job) => {
    if (job.status !== "PENDING") return false;
    const key = `${job.refKind}:${job.refNumber}:${job.jobType}`;
    if (userBusy.has(key)) return false;
    return true;
  });

  return eligible.sort((a, b) => {
    const priorityDelta =
      CONTRIBUTION_JOB_PRIORITY[b.jobType] - CONTRIBUTION_JOB_PRIORITY[a.jobType];
    if (priorityDelta !== 0) return priorityDelta;
    return a.id - b.id;
  });
};

// Exclude jobs whose underlying issue or pull request the requesting user wrote.
// This covers triage as well as review: without it a user can open an issue, claim
// the triage job it generates, comment on their own issue and collect the reward.
// The author login is carried on the job context, so it is injected by the caller.
export const excludeSelfAuthored = <
  T extends ExistingJob & { context?: { authorLogin?: string } },
>(
  jobs: T[],
  githubLogin: string | undefined,
): T[] => {
  if (!githubLogin) return jobs;
  const login = githubLogin.toLowerCase();
  return jobs.filter((job) => job.context?.authorLogin?.toLowerCase() !== login);
};

// ─────────────────────────────────────────────────────────────────────────────
// Staleness / requeue
// ─────────────────────────────────────────────────────────────────────────────

// A claim is stale when the most recent signal (claim or heartbeat) is older
// than the stale threshold.
export const isClaimStale = (state: ClaimedJobState, nowMs: number) => {
  const lastSignal = Math.max(state.claimedAt, state.heartbeatAt ?? state.claimedAt);
  return nowMs - lastSignal > CONTRIBUTION_STALE_CLAIM_MS;
};

// When a stale/failed claim is released, decide whether the job goes back to
// PENDING (more attempts left) or stays FAILED (attempt budget exhausted).
export const releaseJobStatus = (attemptCount: number): "PENDING" | "FAILED" => {
  return attemptCount >= CONTRIBUTION_MAX_ATTEMPTS ? "FAILED" : "PENDING";
};

// ─────────────────────────────────────────────────────────────────────────────
// Result verification
// ─────────────────────────────────────────────────────────────────────────────

// A result counts as verified when:
//  - the producing actor is the claiming user's GitHub login;
//  - it was produced AFTER the job was claimed (within clock skew);
//  - and within the verification window.
export const isResultVerified = (input: VerificationInput): boolean => {
  const { githubLogin, evidence, claimedAt, nowMs, windowMs } = input;
  if (!githubLogin || !evidence.actorLogin) return false;
  if (evidence.actorLogin.toLowerCase() !== githubLogin.toLowerCase()) return false;

  // Allow a small clock-skew tolerance before the claim timestamp.
  if (evidence.producedAt < claimedAt - CONTRIBUTION_CLOCK_SKEW_MS) return false;
  // The result must land within the verification window *of the claim*. Comparing
  // against nowMs would only reject future-dated evidence, i.e. never.
  if (evidence.producedAt > claimedAt + windowMs) return false;
  // Defensive: never accept evidence dated meaningfully in the future.
  if (evidence.producedAt > nowMs + CONTRIBUTION_CLOCK_SKEW_MS) return false;
  return true;
};

export { CONTRIBUTION_MAX_ATTEMPTS, CONTRIBUTION_MAX_JOBS_PER_DAY };
