import type {
  ContributionAgent,
  ContributionJobStatus,
  ContributionJobType,
  ContributionRefKind,
} from "@/drizzle/constants";

export type {
  ContributionAgent,
  ContributionJobStatus,
  ContributionJobType,
  ContributionRefKind,
};

// Minimal shape of an existing job row, as read from the DB or synthesized in tests.
// Keeping this decoupled from the Drizzle row type lets the pure logic stay importable
// anywhere (including the client) without pulling in the ORM.
export interface ExistingJob {
  id: number;
  jobType: ContributionJobType;
  refKind: ContributionRefKind;
  refNumber: number;
  status: ContributionJobStatus;
  claimedByUserId?: string | null;
  attemptCount: number;
}

// A job spec produced by creation/backfill logic, ready to be inserted.
export interface JobSpec {
  jobType: ContributionJobType;
  refKind: ContributionRefKind;
  refNumber: number;
  refUrl: string;
  // Snapshot of the ref captured at creation time.
  context: JobContext;
}

export interface JobContext {
  title: string;
  labels: string[];
  body?: string;
  // For pull requests, the author's login (used to block self-review).
  authorLogin?: string;
  // True when the PR head is on a different repository than the base (a fork).
  isCrossFork?: boolean;
}

// An open GitHub issue, as fetched for eligibility checks.
export interface OpenIssueRef {
  number: number;
  title: string;
  labels: string[];
  body?: string;
  url: string;
}

// An open GitHub pull request, as fetched for eligibility checks.
export interface OpenPullRequestRef {
  number: number;
  title: string;
  labels: string[];
  body?: string;
  url: string;
  authorLogin: string;
  isCrossFork: boolean;
  isBot: boolean;
}

// The inputs a backfill / reconciliation pass works from.
export interface BackfillInput {
  issues: OpenIssueRef[];
  pullRequests: OpenPullRequestRef[];
  existingJobs: ExistingJob[];
}

// Constraints for claiming a job (evaluated against the requesting user).
export interface ClaimConstraints {
  userId: string;
  agent: ContributionAgent;
  // UTC day string, e.g. "2026-08-19".
  today: string;
  // Jobs completed today, across all agents.
  jobsCompletedToday: number;
  // Tokens consumed today by the requesting agent (for the daily cap).
  tokensUsedTodayForAgent: number;
  // 0 = unlimited.
  dailyTokenCapForAgent: number;
}

// A claimed job, with the timestamps needed for staleness checks.
export interface ClaimedJobState {
  claimedAt: number;
  heartbeatAt: number | null;
}

export interface VerificationEvidence {
  // GitHub login of the actor who produced the result.
  actorLogin: string;
  // ISO timestamp of when the result was produced.
  producedAt: number;
}

export interface VerificationInput {
  jobType: ContributionJobType;
  // The user's GitHub login (from their profile).
  githubLogin: string;
  evidence: VerificationEvidence;
  // When the job was claimed (ms epoch).
  claimedAt: number;
  // Current time (ms epoch).
  nowMs: number;
  // Window in which the result must have been produced.
  windowMs: number;
}
