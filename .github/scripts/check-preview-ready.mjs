/**
 * Checks whether a Vercel preview deployment is ready for a given PR.
 *
 * Queries the GitHub Checks API for the PR's head SHA, finds Vercel check runs
 * matching a configurable name pattern, and extracts the preview URL from the
 * most recent successful check's output summary.
 *
 * Env vars consumed:
 *   GITHUB_TOKEN, PR_NUMBER, VERCEL_CHECK_NAME_PATTERN
 *
 * Outputs (via GITHUB_OUTPUT):
 *   is_ready    — "true" | "false"
 *   preview_url — the extracted deployment URL (only when ready)
 *   reason      — human-readable explanation when not ready
 *   check_name, details_url, head_sha, pr_url — supplementary metadata
 */
import { setOutput, createGithubClient } from "./ci-helpers.mjs";

const githubToken = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const prNumber = Number(process.env.PR_NUMBER);
const checkNamePatternRaw = process.env.VERCEL_CHECK_NAME_PATTERN ?? "vercel";

if (!githubToken) {
  throw new Error("Missing GITHUB_TOKEN");
}

if (!repository) {
  throw new Error("Missing GITHUB_REPOSITORY");
}

if (!Number.isInteger(prNumber) || prNumber <= 0) {
  throw new Error(`Invalid PR_NUMBER: ${process.env.PR_NUMBER ?? "undefined"}`);
}

const [owner, repo] = repository.split("/");
if (!owner || !repo) {
  throw new Error(`Invalid GITHUB_REPOSITORY: ${repository}`);
}

const githubRequest = createGithubClient(githubToken);

/** Validate that a URL is a trusted Vercel deployment (*.vercel.app over HTTPS). */
const toTrustedPreviewUrl = (raw) => {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:") return "";
    if (!parsed.hostname.endsWith(".vercel.app")) return "";
    return parsed.origin;
  } catch {
    return "";
  }
};

/** Parse the deployment URL out of a Vercel check run's output summary. */
const extractPreviewUrl = (checkRun) => {
  const summary = checkRun?.output?.summary ?? "";

  // Vercel feedback URLs embed the deployment hostname after /open-feedback/
  // e.g. https://vercel.live/open-feedback/my-app-git-branch.vercel.app?via=...
  const feedbackMatch = summary.match(
    /https:\/\/vercel\.live\/open-feedback\/([a-z0-9-]+\.vercel\.app)/i,
  );
  if (feedbackMatch) {
    const trusted = toTrustedPreviewUrl(`https://${feedbackMatch[1]}`);
    if (trusted) return trusted;
  }

  // Fallback: grab any URL from the summary text, validate hostname
  const fromSummary = summary.match(/https:\/\/[^\s)]+/i)?.[0];
  if (fromSummary) {
    const trusted = toTrustedPreviewUrl(fromSummary);
    if (trusted) return trusted;
  }
  return "";
};

const main = async () => {
  const regex = new RegExp(checkNamePatternRaw, "i");

  // Need the PR's head SHA to query the Checks API
  const pullRequest = await githubRequest(`/repos/${owner}/${repo}/pulls/${prNumber}`);
  const headSha = pullRequest?.head?.sha;
  const prUrl = pullRequest?.html_url ?? "";

  if (!headSha) {
    setOutput("is_ready", "false");
    setOutput("reason", `Missing head SHA for PR #${prNumber}`);
    return;
  }

  // Fetch all check runs for the head commit and filter to Vercel ones
  const checksResponse = await githubRequest(
    `/repos/${owner}/${repo}/commits/${headSha}/check-runs?per_page=100`,
  );

  const checks = Array.isArray(checksResponse?.check_runs) ? checksResponse.check_runs : [];
  const matchingChecks = checks.filter((checkRun) => regex.test(checkRun?.name ?? ""));
  const successfulChecks = matchingChecks.filter(
    (checkRun) => checkRun?.status === "completed" && checkRun?.conclusion === "success",
  );

  // Pick the most recently completed successful check (in case of re-deploys)
  const latestSuccessfulCheck = successfulChecks.sort((a, b) => {
    const aCompleted = Date.parse(a?.completed_at ?? "");
    const bCompleted = Date.parse(b?.completed_at ?? "");
    return bCompleted - aCompleted;
  })[0];

  if (!latestSuccessfulCheck) {
    // Give a diagnostic message distinguishing "no matches" from "matches but pending"
    const availableCheckNames = checks.map((checkRun) => checkRun?.name).filter(Boolean);
    const reason = matchingChecks.length
      ? `Found Vercel checks but none are successful yet for pattern ${checkNamePatternRaw}.`
      : `No checks matched Vercel pattern ${checkNamePatternRaw}. Available checks: ${availableCheckNames.join(", ")}`;
    setOutput("is_ready", "false");
    setOutput("reason", reason);
    setOutput("head_sha", headSha);
    setOutput("pr_url", prUrl);
    return;
  }

  const previewUrl = extractPreviewUrl(latestSuccessfulCheck);

  if (!previewUrl) {
    setOutput("is_ready", "false");
    setOutput("reason", "Vercel check succeeded but could not extract a preview URL");
    return;
  }

  setOutput("is_ready", "true");
  setOutput("reason", "");
  setOutput("preview_url", previewUrl);
  setOutput("check_name", latestSuccessfulCheck?.name ?? "");
  setOutput("details_url", latestSuccessfulCheck?.details_url ?? "");
  setOutput("head_sha", headSha);
  setOutput("pr_url", prUrl);
};

// Catch-all: surface the error as a "not ready" output rather than crashing
// the workflow step, so the "Post blocked reason" step can still run
main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  setOutput("is_ready", "false");
  setOutput("reason", message);
  console.error(message);
});
