import { describe, expect, it } from "vitest";
import {
  computeBackfillJobs,
  excludeSelfAuthored,
  hasJobsRemainingToday,
  hasLabel,
  isClaimStale,
  isImplementationCandidate,
  isJobActive,
  isResultVerified,
  isTokenCapExceeded,
  isTriageCandidate,
  planIssueJob,
  releaseJobStatus,
  selectClaimCandidates,
  shouldCreatePrReviewJob,
} from "@/libs/devContribution/jobs";
import type {
  ExistingJob,
  OpenIssueRef,
  OpenPullRequestRef,
} from "@/libs/devContribution/types";

const job = (overrides: Partial<ExistingJob> = {}): ExistingJob => ({
  id: 1,
  jobType: "ISSUE_TRIAGE",
  refKind: "ISSUE",
  refNumber: 10,
  status: "PENDING",
  attemptCount: 0,
  ...overrides,
});

describe("label eligibility", () => {
  it("detects the clarified label case-insensitively", () => {
    expect(hasLabel(["bug", "fully clarified"], "Fully Clarified")).toBe(true);
    expect(hasLabel(["bug"], "Fully Clarified")).toBe(false);
  });

  it("unlabeled / normal issues are triage candidates only", () => {
    expect(isTriageCandidate(["bug"])).toBe(true);
    expect(isImplementationCandidate(["bug"])).toBe(false);
  });

  it("clarified issues are implementation candidates only", () => {
    expect(isImplementationCandidate(["bug", "Fully Clarified"])).toBe(true);
    expect(isTriageCandidate(["bug", "Fully Clarified"])).toBe(false);
  });
});

describe("planIssueJob", () => {
  const issue: Pick<OpenIssueRef, "number" | "labels"> = {
    number: 10,
    labels: ["bug"],
  };
  const clarified: Pick<OpenIssueRef, "number" | "labels"> = {
    number: 10,
    labels: ["bug", "Fully Clarified"],
  };

  it("creates a triage job for an open, unclarified issue", () => {
    expect(planIssueJob(issue, [])).toEqual({
      create: "ISSUE_TRIAGE",
      cancelJobIds: [],
    });
  });

  it("creates an implementation job for a clarified issue", () => {
    expect(planIssueJob(clarified, [])).toEqual({
      create: "ISSUE_IMPLEMENT",
      cancelJobIds: [],
    });
  });

  it("does not duplicate an in-flight job of the desired type", () => {
    const pending = job({ jobType: "ISSUE_TRIAGE", refNumber: 10 });
    expect(planIssueJob(issue, [pending]).create).toBeNull();
  });

  it("does not re-issue a completed job of the desired type", () => {
    const done = job({
      jobType: "ISSUE_IMPLEMENT",
      refNumber: 10,
      status: "COMPLETED",
    });
    expect(planIssueJob(clarified, [done]).create).toBeNull();
  });

  it("cancels an obsolete triage job once the issue is clarified", () => {
    const triage = job({ jobType: "ISSUE_TRIAGE", refNumber: 10, id: 77 });
    const plan = planIssueJob(clarified, [triage]);
    expect(plan.create).toBe("ISSUE_IMPLEMENT");
    expect(plan.cancelJobIds).toEqual([77]);
  });
});

describe("shouldCreatePrReviewJob", () => {
  const pr: Pick<
    OpenPullRequestRef,
    "number" | "authorLogin" | "isCrossFork" | "isBot"
  > = {
    number: 5,
    authorLogin: "someone",
    isCrossFork: true,
    isBot: false,
  };

  it("creates a review for a fresh cross-fork community PR", () => {
    expect(shouldCreatePrReviewJob(pr, [])).toBe(true);
  });

  it("never reviews bot PRs or same-repo PRs", () => {
    expect(shouldCreatePrReviewJob({ ...pr, isBot: true }, [])).toBe(false);
    expect(shouldCreatePrReviewJob({ ...pr, isCrossFork: false }, [])).toBe(false);
  });

  it("allows at most one in-flight review at a time", () => {
    const pending = job({
      jobType: "PR_REVIEW",
      refKind: "PULL_REQUEST",
      refNumber: 5,
    });
    expect(shouldCreatePrReviewJob(pr, [pending])).toBe(false);
  });

  it("caps total review jobs per PR", () => {
    const done = (n: number) =>
      job({
        jobType: "PR_REVIEW",
        refKind: "PULL_REQUEST",
        refNumber: 5,
        id: n,
        status: "COMPLETED",
      });
    expect(shouldCreatePrReviewJob(pr, [done(1), done(2)])).toBe(true);
    expect(shouldCreatePrReviewJob(pr, [done(1), done(2), done(3)])).toBe(false);
  });
});

describe("computeBackfillJobs", () => {
  it("produces specs for eligible refs and skips ineligible ones", () => {
    const specs = computeBackfillJobs({
      issues: [
        { number: 1, title: "t", labels: ["bug"], url: "u1" },
        {
          number: 2,
          title: "t",
          labels: ["Fully Clarified"],
          url: "u2",
        },
      ],
      pullRequests: [
        {
          number: 3,
          title: "pr",
          labels: [],
          url: "u3",
          authorLogin: "a",
          isCrossFork: true,
          isBot: false,
        },
      ],
      existingJobs: [job({ refNumber: 1, jobType: "ISSUE_TRIAGE", status: "PENDING" })],
    });
    // Issue 1 already has a triage job; issue 2 gets implement; PR 3 gets review.
    expect(specs).toHaveLength(2);
    expect(specs.map((s) => s.jobType).sort()).toEqual([
      "ISSUE_IMPLEMENT",
      "PR_REVIEW",
    ]);
  });
});

describe("claiming", () => {
  it("blocks over the daily token cap, but not when cap is unlimited", () => {
    expect(isTokenCapExceeded(100, 100)).toBe(true);
    expect(isTokenCapExceeded(99, 100)).toBe(false);
    expect(isTokenCapExceeded(1_000_000, 0)).toBe(false);
  });

  it("respects the global daily job cap", () => {
    expect(hasJobsRemainingToday(9)).toBe(true);
    expect(hasJobsRemainingToday(10)).toBe(false);
  });

  it("ranks candidates by priority then oldest, skipping the user's busy refs", () => {
    const pending = [
      job({ id: 1, jobType: "ISSUE_TRIAGE", refNumber: 1 }),
      job({ id: 2, jobType: "PR_REVIEW", refKind: "PULL_REQUEST", refNumber: 2 }),
      job({ id: 3, jobType: "ISSUE_IMPLEMENT", refNumber: 3 }),
      job({ id: 4, jobType: "ISSUE_TRIAGE", refNumber: 1 }), // same ref as #1
    ];
    const userJobs = [
      job({ id: 9, refNumber: 3, jobType: "ISSUE_IMPLEMENT", status: "COMPLETED" }),
    ]; // user did #3
    const ordered = selectClaimCandidates(pending, userJobs).map((j) => j.id);
    // implement(3) is skipped (user completed it); review(2) outranks triage(1,4);
    // triage 1 comes before 4 (older).
    expect(ordered).toEqual([2, 1, 4]);
  });

  it("excludes self-review of a PR the user authored", () => {
    const mine = {
      ...job({ jobType: "PR_REVIEW", refKind: "PULL_REQUEST", refNumber: 5 }),
      context: { authorLogin: "me" },
    };
    const theirs = {
      ...job({ jobType: "PR_REVIEW", refKind: "PULL_REQUEST", refNumber: 6, id: 2 }),
      context: { authorLogin: "other" },
    };
    const kept = excludeSelfAuthored([mine, theirs], "ME");
    expect(kept.map((j: ExistingJob) => j.id)).toEqual([2]);
  });

  it("also blocks triaging an issue you opened yourself", () => {
    // Without this, opening an issue, claiming the triage job it generates and
    // commenting on it is a self-serve reward loop.
    const mine = {
      ...job({ jobType: "ISSUE_TRIAGE", refKind: "ISSUE", refNumber: 11 }),
      context: { authorLogin: "me" },
    };
    const theirs = {
      ...job({ jobType: "ISSUE_TRIAGE", refKind: "ISSUE", refNumber: 12, id: 2 }),
      context: { authorLogin: "someone-else" },
    };
    const kept = excludeSelfAuthored([mine, theirs], "me");
    expect(kept.map((j: ExistingJob) => j.id)).toEqual([2]);
  });
});

describe("staleness / release", () => {
  const now = Date.parse("2026-08-19T12:00:00Z");
  it("flags claims older than the stale threshold using the newest signal", () => {
    const fresh = { claimedAt: now - 60_000, heartbeatAt: now - 30_000 };
    expect(isClaimStale(fresh, now)).toBe(false);
    const stale = { claimedAt: now - 15 * 60_000, heartbeatAt: now - 12 * 60_000 };
    expect(isClaimStale(stale, now)).toBe(true);
    // No heartbeat falls back to the claim time.
    const noHb = { claimedAt: now - 11 * 60_000, heartbeatAt: null };
    expect(isClaimStale(noHb, now)).toBe(true);
  });

  it("releases to PENDING until the attempt budget is exhausted", () => {
    expect(releaseJobStatus(0)).toBe("PENDING");
    expect(releaseJobStatus(2)).toBe("PENDING");
    expect(releaseJobStatus(3)).toBe("FAILED");
  });
});

describe("verification", () => {
  const claimedAt = Date.parse("2026-08-19T10:00:00Z");
  const now = Date.parse("2026-08-19T11:00:00Z");

  it("verifies a same-author result produced after the claim", () => {
    expect(
      isResultVerified({
        jobType: "PR_REVIEW",
        githubLogin: "sam",
        evidence: { actorLogin: "Sam", producedAt: claimedAt + 30 * 60_000 },
        claimedAt,
        nowMs: now,
        windowMs: 2 * 60 * 60 * 1000,
      }),
    ).toBe(true);
  });

  it("rejects a different author", () => {
    expect(
      isResultVerified({
        jobType: "PR_REVIEW",
        githubLogin: "sam",
        evidence: { actorLogin: "mallory", producedAt: claimedAt + 30 * 60_000 },
        claimedAt,
        nowMs: now,
        windowMs: 2 * 60 * 60 * 1000,
      }),
    ).toBe(false);
  });

  it("rejects a result produced well before the claim (pre-existing work)", () => {
    expect(
      isResultVerified({
        jobType: "ISSUE_TRIAGE",
        githubLogin: "sam",
        evidence: { actorLogin: "sam", producedAt: claimedAt - 10 * 60_000 },
        claimedAt,
        nowMs: now,
        windowMs: 2 * 60 * 60 * 1000,
      }),
    ).toBe(false);
  });

  it("rejects when the profile has no github login", () => {
    expect(
      isResultVerified({
        jobType: "PR_REVIEW",
        githubLogin: "",
        evidence: { actorLogin: "sam", producedAt: claimedAt + 60_000 },
        claimedAt,
        nowMs: now,
        windowMs: 2 * 60 * 60 * 1000,
      }),
    ).toBe(false);
  });
});

describe("activity helpers", () => {
  it("classifies statuses", () => {
    expect(isJobActive("PENDING")).toBe(true);
    expect(isJobActive("CLAIMED")).toBe(true);
    expect(isJobActive("COMPLETED")).toBe(false);
  });
});

describe("regressions: loop guards and the verification window", () => {
  it("does not re-create a FAILED job for a still-open issue", () => {
    // planIssueJob only suppressed COMPLETED, so the 10-minute backfill cron
    // resurrected every FAILED job forever with attemptCount reset to 0.
    const failed: ExistingJob = {
      ...job({ jobType: "ISSUE_TRIAGE", refKind: "ISSUE", refNumber: 3 }),
      status: "FAILED",
      attemptCount: 3,
    };
    const plan = planIssueJob({ number: 3, labels: [] }, [failed]);
    expect(plan.create).toBeNull();
  });

  it("DOES re-create after a CANCELLED job, so a reopened issue gets work again", () => {
    // Closing an issue cancels its pending job. If CANCELLED also suppressed
    // re-creation, reopening the issue would leave it permanently without one.
    const cancelled: ExistingJob = {
      ...job({ jobType: "ISSUE_TRIAGE", refKind: "ISSUE", refNumber: 4 }),
      status: "CANCELLED",
    };
    expect(planIssueJob({ number: 4, labels: [] }, [cancelled]).create).toBe(
      "ISSUE_TRIAGE",
    );
  });

  it("does not re-create a COMPLETED job", () => {
    const done: ExistingJob = {
      ...job({ jobType: "ISSUE_TRIAGE", refKind: "ISSUE", refNumber: 7 }),
      status: "COMPLETED",
    };
    expect(planIssueJob({ number: 7, labels: [] }, [done]).create).toBeNull();
  });

  it("still creates a job when the issue has none at all", () => {
    expect(planIssueJob({ number: 5, labels: [] }, []).create).toBe("ISSUE_TRIAGE");
  });

  it("treats VERIFYING as in-flight so backfill does not duplicate it", () => {
    expect(isJobActive("VERIFYING")).toBe(true);
    const verifying: ExistingJob = {
      ...job({ jobType: "ISSUE_TRIAGE", refKind: "ISSUE", refNumber: 6 }),
      status: "VERIFYING",
    };
    expect(planIssueJob({ number: 6, labels: [] }, [verifying]).create).toBeNull();
  });

  it("rejects a result produced long after the claim", () => {
    // The bound was compared against nowMs + windowMs, which no real GitHub
    // timestamp can exceed, so the window never rejected anything.
    const claimedAt = Date.parse("2026-08-19T00:00:00Z");
    const windowMs = 2 * 3600 * 1000;
    const fiveHoursLater = claimedAt + 5 * 3600 * 1000;
    expect(
      isResultVerified({
        jobType: "ISSUE_TRIAGE",
        githubLogin: "octocat",
        evidence: { actorLogin: "octocat", producedAt: fiveHoursLater },
        claimedAt,
        nowMs: fiveHoursLater + 1000,
        windowMs,
      }),
    ).toBe(false);
  });

  it("accepts a result produced inside the window", () => {
    const claimedAt = Date.parse("2026-08-19T00:00:00Z");
    const windowMs = 2 * 3600 * 1000;
    const withinWindow = claimedAt + 30 * 60 * 1000;
    expect(
      isResultVerified({
        jobType: "ISSUE_TRIAGE",
        githubLogin: "octocat",
        evidence: { actorLogin: "octocat", producedAt: withinWindow },
        claimedAt,
        nowMs: withinWindow + 1000,
        windowMs,
      }),
    ).toBe(true);
  });
});
