import { describe, expect, it } from "vitest";
import {
  type FetchImpl,
  referencesIssue,
  verifyContributionResult,
} from "@/libs/devContribution/github";
import {
  ensureClarifiedLabel,
  fetchOpenIssues,
  fetchOpenPullRequests,
} from "@/libs/devContribution/maintenance";

const MINUTE = 60 * 1000;
const HOUR = 3600 * 1000;
const NOW = 1_000_000_000_000;

const iso = (ms: number) => new Date(ms).toISOString();

interface Route {
  match: string;
  body: unknown;
  status?: number;
}

const mockFetch = (routes: Route[]): FetchImpl => {
  return async (url: string) => {
    const route = routes.find((r) => url.includes(r.match));
    if (!route) {
      return new Response(JSON.stringify({ error: "unexpected url" }), { status: 404 });
    }
    return new Response(JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  };
};

const throwingFetch: FetchImpl = async () => {
  throw new Error("network down");
};

describe("verifyContributionResult", () => {
  it("verifies a PR review by the claiming user within the window", async () => {
    const fetchImpl = mockFetch([
      {
        match: "/pulls/7/reviews",
        body: [
          {
            user: { login: "octocat" },
            submitted_at: iso(NOW - HOUR),
            html_url: "https://github.com/r/pr/7/reviews/1",
          },
        ],
      },
    ]);

    const result = await verifyContributionResult(
      {
        jobType: "PR_REVIEW",
        refNumber: 7,
        githubLogin: "OctoCat",
        claimedAt: NOW - 2 * HOUR,
        nowMs: NOW,
        windowMs: 2 * HOUR,
      },
      { fetchImpl },
    );

    expect(result.verified).toBe(true);
    expect(result.resultUrl).toBe("https://github.com/r/pr/7/reviews/1");
  });

  it("rejects a review authored by a different user", async () => {
    const fetchImpl = mockFetch([
      {
        match: "/pulls/7/reviews",
        body: [
          {
            user: { login: "someone-else" },
            submitted_at: iso(NOW - HOUR),
            html_url: "https://github.com/r/pr/7/reviews/1",
          },
        ],
      },
    ]);

    const result = await verifyContributionResult(
      {
        jobType: "PR_REVIEW",
        refNumber: 7,
        githubLogin: "octocat",
        claimedAt: NOW - 2 * HOUR,
        nowMs: NOW,
        windowMs: 2 * HOUR,
      },
      { fetchImpl },
    );

    expect(result.verified).toBe(false);
  });

  it("rejects a review produced before the claim (beyond clock skew)", async () => {
    const fetchImpl = mockFetch([
      {
        match: "/pulls/7/reviews",
        body: [
          {
            user: { login: "octocat" },
            submitted_at: iso(NOW - 3 * HOUR),
            html_url: "https://github.com/r/pr/7/reviews/1",
          },
        ],
      },
    ]);

    const result = await verifyContributionResult(
      {
        jobType: "PR_REVIEW",
        refNumber: 7,
        githubLogin: "octocat",
        claimedAt: NOW - 2 * HOUR,
        nowMs: NOW,
        windowMs: 2 * HOUR,
      },
      { fetchImpl },
    );

    expect(result.verified).toBe(false);
  });

  it("rejects when no GitHub login is configured", async () => {
    const result = await verifyContributionResult(
      {
        jobType: "PR_REVIEW",
        refNumber: 7,
        githubLogin: "",
        claimedAt: NOW,
        nowMs: NOW,
        windowMs: 2 * HOUR,
      },
      { fetchImpl: mockFetch([]) },
    );

    expect(result.verified).toBe(false);
    expect(result.error).toMatch(/no verified github login/i);
  });

  it("verifies a triage issue comment", async () => {
    const fetchImpl = mockFetch([
      {
        match: "/issues/42/comments",
        body: [
          {
            user: { login: "octocat" },
            created_at: iso(NOW - 30 * 60 * 1000),
            html_url: "https://github.com/r/issues/42#issuecomment-1",
          },
        ],
      },
    ]);

    const result = await verifyContributionResult(
      {
        jobType: "ISSUE_TRIAGE",
        refNumber: 42,
        githubLogin: "octocat",
        claimedAt: NOW - 2 * HOUR,
        nowMs: NOW,
        windowMs: 2 * HOUR,
      },
      { fetchImpl },
    );

    expect(result.verified).toBe(true);
  });

  it("verifies an implementation PR that references the issue", async () => {
    const fetchImpl = mockFetch([
      {
        match: "/pulls?state=all",
        body: [
          {
            user: { login: "octocat" },
            title: "Add feature",
            body: "fixes #42",
            html_url: "https://github.com/r/pull/99",
            created_at: iso(NOW - 30 * 60 * 1000),
          },
        ],
      },
    ]);

    const result = await verifyContributionResult(
      {
        jobType: "ISSUE_IMPLEMENT",
        refNumber: 42,
        githubLogin: "octocat",
        claimedAt: NOW - 2 * HOUR,
        nowMs: NOW,
        windowMs: 2 * HOUR,
      },
      { fetchImpl },
    );

    expect(result.verified).toBe(true);
    expect(result.resultUrl).toBe("https://github.com/r/pull/99");
  });

  it("surfaces GitHub HTTP errors as unverified", async () => {
    const fetchImpl = mockFetch([{ match: "/pulls/7/reviews", body: {}, status: 403 }]);

    const result = await verifyContributionResult(
      {
        jobType: "PR_REVIEW",
        refNumber: 7,
        githubLogin: "octocat",
        claimedAt: NOW,
        nowMs: NOW,
        windowMs: 2 * HOUR,
      },
      { fetchImpl },
    );

    expect(result.verified).toBe(false);
    expect(result.error).toContain("403");
  });

  it("surfaces network failures as unverified", async () => {
    const result = await verifyContributionResult(
      {
        jobType: "PR_REVIEW",
        refNumber: 7,
        githubLogin: "octocat",
        claimedAt: NOW,
        nowMs: NOW,
        windowMs: 2 * HOUR,
      },
      { fetchImpl: throwingFetch },
    );

    expect(result.verified).toBe(false);
    expect(result.error).toContain("network down");
  });
});

describe("fetchOpenIssues", () => {
  it("skips pull requests that appear in the issues feed", async () => {
    const fetchImpl = mockFetch([
      {
        match: "/issues?state=open",
        body: [
          {
            number: 1,
            title: "Real issue",
            body: "b",
            html_url: "u1",
            labels: [{ name: "bug" }],
          },
          {
            number: 2,
            title: "A PR",
            body: null,
            html_url: "u2",
            labels: [],
            pull_request: {},
          },
        ],
      },
    ]);

    const { refs: issues } = await fetchOpenIssues(fetchImpl, "token");
    expect(issues).toHaveLength(1);
    expect(issues[0]).toEqual({
      number: 1,
      title: "Real issue",
      labels: ["bug"],
      body: "b",
      url: "u1",
    });
  });

  it("stops paginating on a short page", async () => {
    const longPage = Array.from({ length: 100 }, (_, i) => ({
      number: i + 1,
      title: `Issue ${i + 1}`,
      body: null,
      html_url: `u${i + 1}`,
      labels: [],
    }));
    const calls: string[] = [];
    const fetchImpl: FetchImpl = async (url) => {
      calls.push(url);
      if (url.includes("&page=1")) {
        return new Response(JSON.stringify(longPage), { status: 200 });
      }
      return new Response(JSON.stringify(longPage.slice(0, 3)), { status: 200 });
    };

    const { refs: issues } = await fetchOpenIssues(fetchImpl, "token");
    expect(issues).toHaveLength(103);
    expect(calls).toHaveLength(2);
  });
});

describe("fetchOpenPullRequests", () => {
  it("maps cross-fork and bot flags", async () => {
    const fetchImpl = mockFetch([
      {
        match: "/pulls?state=open",
        body: [
          {
            number: 10,
            title: "Fork PR",
            body: null,
            html_url: "u10",
            labels: [],
            user: { login: "contributor" },
            head: { repo: { owner: { login: "contributor" } } },
            base: { repo: { owner: { login: "studie-tech" } } },
          },
          {
            number: 11,
            title: "Same-repo PR",
            body: null,
            html_url: "u11",
            labels: [],
            user: { login: "maintainer" },
            head: { repo: { owner: { login: "studie-tech" } } },
            base: { repo: { owner: { login: "studie-tech" } } },
          },
          {
            number: 12,
            title: "Bot PR",
            body: null,
            html_url: "u12",
            labels: [],
            user: { login: "dependabot[bot]", type: "Bot" },
            head: { repo: { owner: { login: "dependabot" } } },
            base: { repo: { owner: { login: "studie-tech" } } },
          },
        ],
      },
    ]);

    const { refs: prs } = await fetchOpenPullRequests(fetchImpl, "token");
    expect(prs).toHaveLength(3);
    expect(prs[0]).toMatchObject({
      number: 10,
      authorLogin: "contributor",
      isCrossFork: true,
      isBot: false,
    });
    expect(prs[1]).toMatchObject({ number: 11, isCrossFork: false });
    expect(prs[2]).toMatchObject({ number: 12, isBot: true });
  });
});

describe("ensureClarifiedLabel", () => {
  it("returns true without creating when the label exists", async () => {
    const calls: string[] = [];
    const fetchImpl: FetchImpl = async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      return new Response(
        JSON.stringify([{ name: "bug" }, { name: "Fully Clarified" }]),
        {
          status: 200,
        },
      );
    };

    await expect(ensureClarifiedLabel(fetchImpl, "token")).resolves.toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^GET /);
  });

  it("creates the label when missing", async () => {
    const posts: Array<{ url: string; body: unknown }> = [];
    const fetchImpl: FetchImpl = async (url, init) => {
      if (init?.method === "POST")
        posts.push({ url, body: JSON.parse(String(init.body)) });
      if (url.includes("/labels") && url.includes("per_page")) {
        return new Response(JSON.stringify([{ name: "bug" }]), { status: 200 });
      }
      return new Response(JSON.stringify({ name: "Fully Clarified" }), { status: 201 });
    };

    await expect(ensureClarifiedLabel(fetchImpl, "token")).resolves.toBe(true);
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toMatchObject({ name: "Fully Clarified" });
  });

  it("treats a 422 (already exists race) as success", async () => {
    const fetchImpl: FetchImpl = async (_url, init) => {
      if (init?.method === "POST") return new Response("exists", { status: 422 });
      return new Response(JSON.stringify([]), { status: 200 });
    };

    await expect(ensureClarifiedLabel(fetchImpl, "token")).resolves.toBe(true);
  });
});

describe("regressions: picking the right GitHub artifact", () => {
  it("verifies the newest review, not an older one by the same user", async () => {
    // GitHub returns reviews oldest-first. Taking the first match meant a user
    // who had ever reviewed the PR before could never verify a new review.
    const fetchImpl = mockFetch([
      {
        match: "/pulls/7/reviews",
        body: [
          {
            user: { login: "octocat" },
            submitted_at: iso(NOW - 30 * 24 * HOUR),
            html_url: "https://github.com/r/pull/7#old",
          },
          {
            user: { login: "octocat" },
            submitted_at: iso(NOW - 10 * 60 * 1000),
            html_url: "https://github.com/r/pull/7#new",
          },
        ],
      },
    ]);

    const result = await verifyContributionResult(
      {
        jobType: "PR_REVIEW",
        refNumber: 7,
        githubLogin: "octocat",
        claimedAt: NOW - HOUR,
        nowMs: NOW,
        windowMs: 2 * HOUR,
      },
      { fetchImpl },
    );

    expect(result.verified).toBe(true);
    expect(result.resultUrl).toBe("https://github.com/r/pull/7#new");
  });

  it("verifies the newest issue comment, not an older one by the same user", async () => {
    const fetchImpl = mockFetch([
      {
        match: "/issues/42/comments",
        body: [
          {
            user: { login: "octocat" },
            created_at: iso(NOW - 30 * 24 * HOUR),
            html_url: "https://github.com/r/issues/42#old",
          },
          {
            user: { login: "octocat" },
            created_at: iso(NOW - 5 * 60 * 1000),
            html_url: "https://github.com/r/issues/42#new",
          },
        ],
      },
    ]);

    const result = await verifyContributionResult(
      {
        jobType: "ISSUE_TRIAGE",
        refNumber: 42,
        githubLogin: "octocat",
        claimedAt: NOW - HOUR,
        nowMs: NOW,
        windowMs: 2 * HOUR,
      },
      { fetchImpl },
    );

    expect(result.verified).toBe(true);
    expect(result.resultUrl).toBe("https://github.com/r/issues/42#new");
  });

  it("does not accept a PR referencing #123 for a job on issue #12", async () => {
    // Bare substring matching made `#12` match a body containing `#123`, so an
    // unrelated PR of the user's could be credited as the implementation.
    const fetchImpl = mockFetch([
      {
        match: "/pulls?state=all",
        body: [
          {
            user: { login: "octocat" },
            title: "Unrelated work",
            body: "Closes #123",
            html_url: "https://github.com/r/pull/500",
            created_at: iso(NOW - 30 * 60 * 1000),
          },
        ],
      },
    ]);

    const result = await verifyContributionResult(
      {
        jobType: "ISSUE_IMPLEMENT",
        refNumber: 12,
        githubLogin: "octocat",
        claimedAt: NOW - HOUR,
        nowMs: NOW,
        windowMs: 2 * HOUR,
      },
      { fetchImpl },
    );

    expect(result.verified).toBe(false);
  });

  it("still accepts an exact issue reference", () => {
    expect(referencesIssue("Closes #12", 12)).toBe(true);
    expect(referencesIssue("Closes #12.", 12)).toBe(true);
    expect(referencesIssue("(#12)", 12)).toBe(true);
    expect(referencesIssue("Closes #123", 12)).toBe(false);
    expect(referencesIssue("Closes #1234", 12)).toBe(false);
  });

  it("marks a GitHub outage as retryable rather than a definitive failure", async () => {
    // A transient 500 used to close the job unrewarded with no way back.
    const fetchImpl = mockFetch([{ match: "/pulls/7/reviews", status: 500, body: {} }]);
    const result = await verifyContributionResult(
      {
        jobType: "PR_REVIEW",
        refNumber: 7,
        githubLogin: "octocat",
        claimedAt: NOW - HOUR,
        nowMs: NOW,
        windowMs: 2 * HOUR,
      },
      { fetchImpl },
    );
    expect(result.verified).toBe(false);
    expect(result.retryable).toBe(true);
  });

  it("marks an out-of-window result as NOT retryable", async () => {
    const fetchImpl = mockFetch([
      {
        match: "/pulls/7/reviews",
        body: [
          {
            user: { login: "octocat" },
            submitted_at: iso(NOW - 30 * 24 * HOUR),
            html_url: "https://github.com/r/pull/7#ancient",
          },
        ],
      },
    ]);
    const result = await verifyContributionResult(
      {
        jobType: "PR_REVIEW",
        refNumber: 7,
        githubLogin: "octocat",
        claimedAt: NOW - HOUR,
        nowMs: NOW,
        windowMs: 2 * HOUR,
      },
      { fetchImpl },
    );
    expect(result.verified).toBe(false);
    expect(result.retryable).toBe(false);
  });

  it("picks the qualifying review even when a newer one falls outside the window", async () => {
    // Selecting the globally newest artifact and only then testing the window
    // discards a perfectly good in-window review whenever the contributor has
    // since reviewed the same PR again, failing work that genuinely happened.
    const fetchImpl = mockFetch([
      {
        match: "/pulls/7/reviews",
        body: [
          {
            user: { login: "octocat" },
            submitted_at: iso(NOW - 30 * MINUTE),
            html_url: "https://github.com/r/pull/7#in-window",
          },
          {
            user: { login: "octocat" },
            submitted_at: iso(NOW + 10 * HOUR),
            html_url: "https://github.com/r/pull/7#way-later",
          },
        ],
      },
    ]);
    const result = await verifyContributionResult(
      {
        jobType: "PR_REVIEW",
        refNumber: 7,
        githubLogin: "octocat",
        claimedAt: NOW - HOUR,
        nowMs: NOW,
        windowMs: 2 * HOUR,
      },
      { fetchImpl },
    );
    expect(result.verified).toBe(true);
    expect(result.resultUrl).toBe("https://github.com/r/pull/7#in-window");
  });
});

describe("open-ref feeds report truncation", () => {
  const page = (n: number, count: number) =>
    Array.from({ length: count }, (_, i) => ({
      number: n * 1000 + i,
      title: "t",
      body: null,
      html_url: "u",
      labels: [],
      user: { login: "a" },
      head: { repo: { owner: { login: "fork" } } },
      base: { repo: { owner: { login: "upstream" } } },
    }));

  it("flags truncated when every page comes back full", async () => {
    // Absence from a truncated feed does not mean the ref is closed, so the
    // caller must be able to tell a complete picture from a capped one before
    // it cancels anything on the strength of a ref being missing.
    const fetchImpl = async () =>
      new Response(JSON.stringify(page(1, 100)), { status: 200 });
    const issues = await fetchOpenIssues(fetchImpl, "token");
    expect(issues.truncated).toBe(true);
    const prs = await fetchOpenPullRequests(fetchImpl, "token");
    expect(prs.truncated).toBe(true);
  });

  it("does not flag truncated when a short page ends the feed", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify(page(1, 2)), { status: 200 });
    expect((await fetchOpenIssues(fetchImpl, "token")).truncated).toBe(false);
    expect((await fetchOpenPullRequests(fetchImpl, "token")).truncated).toBe(false);
  });
});
