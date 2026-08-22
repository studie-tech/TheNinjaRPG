// Server-side GitHub verification for dev-contribution results.
//
// The desktop client performs the actual dev work (posting a review, an issue
// comment, or opening a PR) through the user's own authenticated `gh` CLI. To
// prevent self-certified rewards, the server independently re-verifies the
// result against the GitHub API using GITHUB_ISSUE_TOKEN before granting the
// reward. The fetch implementation is injectable so the decision logic can be
// unit-tested without hitting the network.
//
// Two properties matter for correctness here:
//  - we must find the user's *newest* qualifying artifact, not their oldest,
//    otherwise a pre-existing comment on the same ref masks the new one;
//  - a lookup that fails for transient reasons (rate limit, 5xx, propagation
//    delay) must be reported as retryable, so the caller can re-check later
//    instead of burning the job.

import {
  CONTRIBUTION_CLOCK_SKEW_MS,
  CONTRIBUTION_GITHUB_MAX_PAGES,
  GITHUB_API_ENDPOINT,
} from "@/drizzle/constants";
import { isResultVerified } from "./jobs";
import type { VerificationEvidence } from "./types";

export interface GithubVerifyResult {
  verified: boolean;
  resultUrl?: string;
  error?: string;
  /**
   * True when the negative answer may simply be stale (network/rate-limit
   * failure, or the artifact has not propagated yet). The caller should retry
   * later rather than treating the job as finished.
   */
  retryable?: boolean;
}

export type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

// Every caller runs on a serverless handler (the completeJob path and the
// 10-minute cron). Without a bound, a stalled GitHub connection burns the whole
// invocation instead of failing fast — and an AbortError is classified as
// retryable, so the deferred-verification path simply tries again next tick.
export const GITHUB_REQUEST_TIMEOUT_MS = 10_000;

export const ghFetch: FetchImpl = (url, init) =>
  fetch(url, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS),
  });

export const ghHeaders = (token: string | undefined) => ({
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

/** Raised when GitHub could not answer; distinguishes "unknown" from "absent". */
class GithubLookupError extends Error {}

const parseIso = (value: string | null | undefined): number => {
  if (!value) return 0;
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? 0 : ts;
};

const sameLogin = (a: string | undefined, b: string) =>
  (a ?? "").toLowerCase() === b.toLowerCase();

/**
 * Walk paginated GitHub list endpoints until a short page (or the page cap) is
 * reached. `url` receives the 1-based page number.
 */
const collectPages = async <T>(
  url: (page: number) => string,
  fetchImpl: FetchImpl,
  token: string | undefined,
  label: string,
): Promise<T[]> => {
  const items: T[] = [];
  for (let page = 1; page <= CONTRIBUTION_GITHUB_MAX_PAGES; page++) {
    const res = await fetchImpl(url(page), { headers: ghHeaders(token) });
    if (!res.ok)
      throw new GithubLookupError(`GitHub ${label} lookup failed: ${res.status}`);
    const batch = (await res.json()) as T[];
    if (!Array.isArray(batch)) break;
    items.push(...batch);
    if (batch.length < 100) break;
  }
  return items;
};

/** Of the candidates authored by `login`, the one produced most recently. */
const newestByUser = <T>(
  items: T[],
  login: string,
  getLogin: (item: T) => string | undefined,
  getTime: (item: T) => number,
): T | null => {
  let best: T | null = null;
  for (const item of items) {
    if (!sameLogin(getLogin(item), login)) continue;
    if (getTime(item) <= 0) continue;
    if (!best || getTime(item) > getTime(best)) best = item;
  }
  return best;
};

// A review counts if it was submitted by the user at/after the claim time. The
// reviews endpoint has no `since` filter, so every page is walked and the most
// recent submission by the user wins.
const findReviewByUser = async (
  pullNumber: number,
  login: string,
  fetchImpl: FetchImpl,
  token: string | undefined,
): Promise<{ evidence: VerificationEvidence; url: string } | null> => {
  const reviews = await collectPages<{
    user: { login: string };
    submitted_at: string | null;
    html_url: string;
  }>(
    (page) =>
      `${GITHUB_API_ENDPOINT}/pulls/${pullNumber}/reviews?per_page=100&page=${page}`,
    fetchImpl,
    token,
    "reviews",
  );
  const match = newestByUser(
    reviews,
    login,
    (r) => r.user?.login,
    (r) => parseIso(r.submitted_at),
  );
  if (!match) return null;
  return {
    evidence: {
      actorLogin: match.user.login,
      producedAt: parseIso(match.submitted_at),
    },
    url: match.html_url,
  };
};

// A triage comment counts if the user commented on the issue at/after claim time.
// `since` is a supported filter on this endpoint, so the search is bounded to the
// claim window rather than scanning the whole thread.
const findIssueCommentByUser = async (
  issueNumber: number,
  login: string,
  since: number,
  fetchImpl: FetchImpl,
  token: string | undefined,
): Promise<{ evidence: VerificationEvidence; url: string } | null> => {
  const sinceParam = new Date(Math.max(0, since)).toISOString();
  const comments = await collectPages<{
    user: { login: string };
    created_at: string;
    html_url: string;
  }>(
    (page) =>
      `${GITHUB_API_ENDPOINT}/issues/${issueNumber}/comments?per_page=100&page=${page}` +
      `&since=${encodeURIComponent(sinceParam)}`,
    fetchImpl,
    token,
    "issue comments",
  );
  const match = newestByUser(
    comments,
    login,
    (c) => c.user?.login,
    (c) => parseIso(c.created_at),
  );
  if (!match) return null;
  return {
    evidence: { actorLogin: match.user.login, producedAt: parseIso(match.created_at) },
    url: match.html_url,
  };
};

/**
 * Does `text` reference issue #n? Matched on a digit boundary so that a job for
 * issue #12 is not satisfied by a pull request that references #1234.
 */
export const referencesIssue = (text: string, issueNumber: number): boolean =>
  new RegExp(`#${issueNumber}(?!\\d)`).test(text);

// An implementation counts if the user opened a PR referencing the issue.
const findImplementationPrByUser = async (
  issueNumber: number,
  login: string,
  fetchImpl: FetchImpl,
  token: string | undefined,
): Promise<{ evidence: VerificationEvidence; url: string } | null> => {
  const prs = await collectPages<{
    number: number;
    user: { login: string };
    title: string;
    body: string | null;
    html_url: string;
    created_at: string;
  }>(
    (page) =>
      `${GITHUB_API_ENDPOINT}/pulls?state=all&sort=created&direction=desc` +
      `&per_page=100&page=${page}`,
    fetchImpl,
    token,
    "PRs",
  );
  const referencing = prs.filter((pr) =>
    referencesIssue(`${pr.title ?? ""} ${pr.body ?? ""}`, issueNumber),
  );
  const match = newestByUser(
    referencing,
    login,
    (pr) => pr.user?.login,
    (pr) => parseIso(pr.created_at),
  );
  if (!match) return null;
  return {
    evidence: {
      actorLogin: match.user.login,
      producedAt: parseIso(match.created_at),
    },
    url: match.html_url,
  };
};

// Verify that the claiming user actually produced the claimed result on GitHub.
export const verifyContributionResult = async (
  params: {
    jobType: "PR_REVIEW" | "ISSUE_TRIAGE" | "ISSUE_IMPLEMENT";
    refNumber: number;
    githubLogin: string;
    claimedAt: number;
    nowMs: number;
    windowMs: number;
  },
  options: { fetchImpl?: FetchImpl; token?: string } = {},
): Promise<GithubVerifyResult & { evidence?: VerificationEvidence }> => {
  const fetchImpl = options.fetchImpl ?? ghFetch;
  const token = options.token;

  if (!params.githubLogin) {
    // Not retryable: nothing will change until the user verifies a GitHub login.
    return {
      verified: false,
      retryable: false,
      error: "Profile has no verified GitHub login",
    };
  }

  const since = params.claimedAt - CONTRIBUTION_CLOCK_SKEW_MS;

  try {
    const found =
      params.jobType === "PR_REVIEW"
        ? await findReviewByUser(params.refNumber, params.githubLogin, fetchImpl, token)
        : params.jobType === "ISSUE_TRIAGE"
          ? await findIssueCommentByUser(
              params.refNumber,
              params.githubLogin,
              since,
              fetchImpl,
              token,
            )
          : await findImplementationPrByUser(
              params.refNumber,
              params.githubLogin,
              fetchImpl,
              token,
            );

    if (!found) {
      return {
        verified: false,
        retryable: true,
        error: "No matching result found on GitHub yet (may still be propagating)",
      };
    }

    const verified = isResultVerified({
      jobType: params.jobType,
      githubLogin: params.githubLogin,
      evidence: found.evidence,
      claimedAt: params.claimedAt,
      nowMs: params.nowMs,
      windowMs: params.windowMs,
    });

    if (!verified) {
      // The artifact exists but falls outside the claim window: a later re-check
      // cannot change that, so do not keep retrying.
      return {
        verified: false,
        retryable: false,
        error: "Result does not fall within the claim window",
      };
    }

    return { verified: true, resultUrl: found.url, evidence: found.evidence };
  } catch (error) {
    return {
      verified: false,
      retryable: true,
      error: error instanceof Error ? error.message : "GitHub verification failed",
    };
  }
};

/**
 * Confirm that `gistId` is owned by `login` and contains `nonce`. Used to prove
 * that a game account controls a GitHub account before any reward can be paid
 * against that login.
 */
export const verifyGistOwnership = async (
  params: { gistId: string; login: string; nonce: string },
  options: { fetchImpl?: FetchImpl; token?: string } = {},
): Promise<{ ok: boolean; login?: string; error?: string }> => {
  const fetchImpl = options.fetchImpl ?? ghFetch;
  try {
    const res = await fetchImpl(`https://api.github.com/gists/${params.gistId}`, {
      headers: ghHeaders(options.token),
    });
    if (!res.ok) {
      return { ok: false, error: `Could not read gist (${res.status})` };
    }
    const gist = (await res.json()) as {
      owner?: { login?: string };
      files?: Record<string, { content?: string } | null>;
    };
    const owner = gist.owner?.login;
    if (!owner) return { ok: false, error: "Gist has no owner" };
    if (!sameLogin(owner, params.login)) {
      return { ok: false, error: "Gist is owned by a different GitHub account" };
    }
    const contents = Object.values(gist.files ?? {})
      .map((file) => file?.content ?? "")
      .join("\n");
    if (!contents.includes(params.nonce)) {
      return { ok: false, error: "Gist does not contain the verification code" };
    }
    return { ok: true, login: owner };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Gist verification failed",
    };
  }
};
