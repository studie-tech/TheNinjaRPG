// Server-side GitHub verification for dev-contribution results.
//
// The desktop client performs the actual dev work (posting a review, an issue
// comment, or opening a PR) through the user's own authenticated `gh` CLI. To
// prevent self-certified rewards, the server independently re-verifies the
// result against the GitHub API using GITHUB_ISSUE_TOKEN before granting the
// reward. The fetch implementation is injectable so the decision logic can be
// unit-tested without hitting the network.

import { GITHUB_API_ENDPOINT } from "@/drizzle/constants";
import { isResultVerified } from "./jobs";
import type { VerificationEvidence } from "./types";

export interface GithubVerifyResult {
  verified: boolean;
  resultUrl?: string;
  error?: string;
}

export type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

export const ghFetch: FetchImpl = (url, init) => fetch(url, init);

export const ghHeaders = (token: string | undefined) => ({
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

const parseIso = (value: string | null | undefined): number => {
  if (!value) return 0;
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? 0 : ts;
};

// A review counts if it was submitted by the user at/after the claim time.
const findReviewByUser = async (
  pullNumber: number,
  login: string,
  fetchImpl: FetchImpl,
  token: string | undefined,
): Promise<{ evidence: VerificationEvidence; url: string } | null> => {
  const res = await fetchImpl(
    `${GITHUB_API_ENDPOINT}/pulls/${pullNumber}/reviews?per_page=100`,
    { headers: ghHeaders(token) },
  );
  if (!res.ok) throw new Error(`GitHub reviews lookup failed: ${res.status}`);
  const reviews = (await res.json()) as Array<{
    user: { login: string };
    submitted_at: string | null;
    html_url: string;
  }>;
  const match = reviews.find(
    (r) => r.user?.login?.toLowerCase() === login.toLowerCase(),
  );
  if (!match?.submitted_at) return null;
  return {
    evidence: {
      actorLogin: match.user.login,
      producedAt: parseIso(match.submitted_at),
    },
    url: match.html_url,
  };
};

// A triage comment counts if the user commented on the issue at/after claim time.
const findIssueCommentByUser = async (
  issueNumber: number,
  login: string,
  fetchImpl: FetchImpl,
  token: string | undefined,
): Promise<{ evidence: VerificationEvidence; url: string } | null> => {
  const res = await fetchImpl(
    `${GITHUB_API_ENDPOINT}/issues/${issueNumber}/comments?per_page=100&sort=created&direction=desc`,
    { headers: ghHeaders(token) },
  );
  if (!res.ok) throw new Error(`GitHub issue comments lookup failed: ${res.status}`);
  const comments = (await res.json()) as Array<{
    user: { login: string };
    created_at: string;
    html_url: string;
  }>;
  const match = comments.find(
    (c) => c.user?.login?.toLowerCase() === login.toLowerCase(),
  );
  if (!match) return null;
  return {
    evidence: { actorLogin: match.user.login, producedAt: parseIso(match.created_at) },
    url: match.html_url,
  };
};

// An implementation counts if the user opened a PR referencing the issue.
const findImplementationPrByUser = async (
  issueNumber: number,
  login: string,
  fetchImpl: FetchImpl,
  token: string | undefined,
): Promise<{ evidence: VerificationEvidence; url: string } | null> => {
  const res = await fetchImpl(`${GITHUB_API_ENDPOINT}/pulls?state=open&per_page=100`, {
    headers: ghHeaders(token),
  });
  if (!res.ok) throw new Error(`GitHub PRs lookup failed: ${res.status}`);
  const prs = (await res.json()) as Array<{
    number: number;
    user: { login: string };
    title: string;
    body: string | null;
    html_url: string;
    created_at: string;
  }>;
  const refPatterns = [
    `#${issueNumber}`,
    `(#${issueNumber})`,
    `fixes #${issueNumber}`,
    `closes #${issueNumber}`,
    `resolves #${issueNumber}`,
  ];
  const match = prs.find((pr) => {
    if (pr.user?.login?.toLowerCase() !== login.toLowerCase()) return false;
    const text = `${pr.title ?? ""} ${pr.body ?? ""}`.toLowerCase();
    return refPatterns.some((p) => text.includes(p.toLowerCase()));
  });
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
    return { verified: false, error: "Profile has no GitHub login configured" };
  }

  try {
    const found =
      params.jobType === "PR_REVIEW"
        ? await findReviewByUser(params.refNumber, params.githubLogin, fetchImpl, token)
        : params.jobType === "ISSUE_TRIAGE"
          ? await findIssueCommentByUser(
              params.refNumber,
              params.githubLogin,
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
      return {
        verified: false,
        error: "Result does not fall within the claim window",
      };
    }

    return { verified: true, resultUrl: found.url, evidence: found.evidence };
  } catch (error) {
    return {
      verified: false,
      error: error instanceof Error ? error.message : "GitHub verification failed",
    };
  }
};
