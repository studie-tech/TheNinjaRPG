/**
 * Resolve a Vercel *preview* URL for the latest default-branch commit.
 *
 * Why this exists (and why we do not just grab "the latest preview"):
 *   • Production deploys of `main` have VERCEL_ENV=production. The AI
 *     test-user broker is preview-only, so production cannot host a repro.
 *   • The newest Vercel Preview GitHub deployment is almost always a PR
 *     head, i.e. unmerged code. Reproducing an issue there tests the wrong
 *     tree.
 *
 * Strategy:
 *   1. Reuse a successful Vercel Preview GitHub deployment of a snapshot commit
 *      of the main SHA left on `tnr-preview/main` by a prior run
 *   2. Otherwise create an empty snapshot commit (same tree as main) and point
 *      `tnr-preview/main` at it. The snapshot SHA is unique, so Vercel's
 *      GitHub integration always builds a preview for it — no reliance on
 *      whether Vercel deduplicates SHAs it already deployed to production.
 *   3. Poll until that preview succeeds, fails, or times out
 *
 * Env vars consumed:
 *   GITHUB_TOKEN, GITHUB_REPOSITORY, PUSH_TOKEN (PAT, contents:write),
 *   MAIN_SHA (optional), PREVIEW_BRANCH (optional),
 *   POLL_INTERVAL_MS, POLL_TIMEOUT_MS
 *
 * Outputs (via GITHUB_OUTPUT):
 *   is_ready, preview_url, reason, check_name, details_url, head_sha
 */
import { createGithubClient, encodeHeadsRef } from "./ci-helpers.mjs";
import {
  createPreviewDeploymentClient,
  ensureSnapshotPreview,
  reportPreviewNotReady,
  reportPreviewReady,
} from "./preview-deployments.mjs";

const githubToken = process.env.GITHUB_TOKEN;
const pushToken = process.env.PUSH_TOKEN || "";
const repository = process.env.GITHUB_REPOSITORY;
const previewBranch = process.env.PREVIEW_BRANCH || "tnr-preview/main";
const pollIntervalMs = Number(process.env.POLL_INTERVAL_MS ?? 15_000);
const pollTimeoutMs = Number(process.env.POLL_TIMEOUT_MS ?? 25 * 60 * 1000);
// One shared budget for ALL waiting in this run: chained fallbacks (waiting on
// an in-progress build, then on its replacement snapshot) must together stay
// under the job timeout, not each claim the full window.
const waitBudgetDeadline = Date.now() + pollTimeoutMs;

if (!githubToken) {
  throw new Error("Missing GITHUB_TOKEN");
}

if (!repository) {
  throw new Error("Missing GITHUB_REPOSITORY");
}

const [owner, repo] = repository.split("/");
if (!owner || !repo) {
  throw new Error(`Invalid GITHUB_REPOSITORY: ${repository}`);
}

const githubRequest = createGithubClient(githubToken);
const pushRequest = pushToken ? createGithubClient(pushToken) : null;
const preview = createPreviewDeploymentClient({
  githubRequest,
  pushRequest,
  owner,
  repo,
});

const waitOptions = { pollIntervalMs, deadline: waitBudgetDeadline };

const fetchDefaultBranchSha = async () => {
  const repoInfo = await githubRequest(`/repos/${owner}/${repo}`);
  const defaultBranch = repoInfo?.default_branch;
  if (!defaultBranch) {
    throw new Error("Could not determine the repository default branch");
  }
  const ref = await githubRequest(
    `/repos/${owner}/${repo}/git/refs/heads/${encodeHeadsRef(defaultBranch)}`,
  );
  const sha = ref?.object?.sha;
  if (!sha) {
    throw new Error(`Missing SHA for default branch ${defaultBranch}`);
  }
  return { defaultBranch, sha };
};

const main = async () => {
  const { sha: resolvedSha } = process.env.MAIN_SHA
    ? { sha: process.env.MAIN_SHA }
    : await fetchDefaultBranchSha();

  const result = await ensureSnapshotPreview({
    preview,
    sourceSha: resolvedSha,
    branch: previewBranch,
    label: "main",
    snapshotMessage: `tnr-preview: snapshot of ${resolvedSha.slice(0, 7)}`,
    waitOptions,
  });
  reportPreviewReady({ ...result, headSha: resolvedSha });
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  reportPreviewNotReady(message);
  console.error(message);
});
