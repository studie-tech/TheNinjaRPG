/**
 * Create (or reuse) an on-demand Vercel preview for a pull request.
 *
 * Regular PR branches do not auto-deploy (see git.deploymentEnabled in
 * app/vercel.json). This script snapshots the PR head onto `tnr-preview/pr-{N}`
 * so Vercel's GitHub integration builds a preview of that exact tree, then
 * waits until the deployment is ready.
 *
 * Env vars consumed:
 *   GITHUB_TOKEN, GITHUB_REPOSITORY, PUSH_TOKEN (PAT, contents:write),
 *   PR_NUMBER, PREVIEW_BRANCH (optional),
 *   POLL_INTERVAL_MS, POLL_TIMEOUT_MS
 *
 * Outputs (via GITHUB_OUTPUT):
 *   is_ready, preview_url, reason, check_name, details_url, head_sha
 */
import { createGithubClient } from "./ci-helpers.mjs";
import {
  createPreviewDeploymentClient,
  ensureSnapshotPreview,
  reportPreviewNotReady,
  reportPreviewReady,
} from "./preview-deployments.mjs";

const githubToken = process.env.GITHUB_TOKEN;
const pushToken = process.env.PUSH_TOKEN || "";
const repository = process.env.GITHUB_REPOSITORY;
const prNumber = Number(process.env.PR_NUMBER);
const pollIntervalMs = Number(process.env.POLL_INTERVAL_MS ?? 15_000);
const pollTimeoutMs = Number(process.env.POLL_TIMEOUT_MS ?? 25 * 60 * 1000);
const waitBudgetDeadline = Date.now() + pollTimeoutMs;

if (!githubToken) {
  throw new Error("Missing GITHUB_TOKEN");
}

if (!repository) {
  throw new Error("Missing GITHUB_REPOSITORY");
}

if (!Number.isInteger(prNumber) || prNumber <= 0) {
  throw new Error(`Invalid PR_NUMBER: ${process.env.PR_NUMBER ?? "undefined"}`);
}

const previewBranch =
  process.env.PREVIEW_BRANCH || `tnr-preview/pr-${prNumber}`;

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

const fetchPullRequestHead = async () => {
  const pullRequest = await githubRequest(
    `/repos/${owner}/${repo}/pulls/${prNumber}`,
  );
  const headSha = pullRequest?.head?.sha;
  if (!headSha) {
    throw new Error(`Missing head SHA for PR #${prNumber}`);
  }
  if (pullRequest?.state !== "open") {
    throw new Error(`PR #${prNumber} is not open`);
  }
  return headSha;
};

const main = async () => {
  const headSha = await fetchPullRequestHead();
  const result = await ensureSnapshotPreview({
    preview,
    sourceSha: headSha,
    branch: previewBranch,
    label: `PR #${prNumber}`,
    snapshotMessage: `tnr-preview: snapshot of PR #${prNumber} ${headSha.slice(0, 7)}`,
    waitOptions,
  });
  reportPreviewReady({ ...result, headSha });
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  reportPreviewNotReady(message);
  console.error(message);
});
