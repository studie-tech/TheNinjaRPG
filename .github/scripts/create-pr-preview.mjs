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
import { setOutput, createGithubClient } from "./ci-helpers.mjs";
import {
  createPreviewDeploymentClient,
  requirePreview,
  withRetry,
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

const notReady = (reason, extras = {}) => {
  setOutput("is_ready", "false");
  setOutput("reason", reason);
  setOutput("preview_url", extras.preview_url ?? "");
  setOutput("check_name", extras.check_name ?? "");
  setOutput("details_url", extras.details_url ?? "");
  setOutput("head_sha", extras.head_sha ?? "");
};

const ready = ({ previewUrl, reason, checkName, detailsUrl, headSha }) => {
  setOutput("is_ready", "true");
  setOutput("reason", reason ?? "");
  setOutput("preview_url", previewUrl);
  setOutput("check_name", checkName ?? "");
  setOutput("details_url", detailsUrl ?? "");
  setOutput("head_sha", headSha ?? "");
};

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

  const currentBranchSha = await preview.readBranchSha(previewBranch);
  if (currentBranchSha) {
    const snapshotOfHead = await preview.isSnapshotOf(currentBranchSha, headSha);
    if (snapshotOfHead) {
      const snapshotPreview = await withRetry(() =>
        preview.inspectPreview(currentBranchSha),
      );
      if (snapshotPreview.successful) {
        ready({
          previewUrl: snapshotPreview.successful.url,
          reason: `Reusing snapshot preview of PR #${prNumber} on ${previewBranch}`,
          checkName: snapshotPreview.successful.environment,
          detailsUrl: snapshotPreview.successful.detailsUrl,
          headSha,
        });
        return;
      }
      if (snapshotPreview.inProgress) {
        const waited = await preview.waitForPreview(
          currentBranchSha,
          waitOptions,
        );
        if (waited.successful) {
          ready({
            previewUrl: waited.successful.url,
            reason: `Waited for in-progress snapshot preview of PR #${prNumber}`,
            checkName: waited.successful.environment,
            detailsUrl: waited.successful.detailsUrl,
            headSha,
          });
          return;
        }
        if (!waited.failed) requirePreview(waited, currentBranchSha);
        console.log(
          `Snapshot preview build failed (${waited.failed}); creating a fresh snapshot`,
        );
      }
    }
  }

  const snapshotSha = await preview.createSnapshotCommit(
    headSha,
    `tnr-preview: snapshot of PR #${prNumber} ${headSha.slice(0, 7)}`,
  );
  await preview.pointBranchAtSha(previewBranch, snapshotSha);
  console.log(
    `Created snapshot ${snapshotSha.slice(0, 7)} of PR #${prNumber} ${headSha.slice(0, 7)} on ${previewBranch}`,
  );
  const successful = requirePreview(
    await preview.waitForPreview(snapshotSha, waitOptions),
    snapshotSha,
  );
  ready({
    previewUrl: successful.url,
    reason: `Created Vercel Preview snapshot of PR #${prNumber} via ${previewBranch}`,
    checkName: successful.environment,
    detailsUrl: successful.detailsUrl,
    headSha,
  });
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  notReady(message);
  console.error(message);
});
