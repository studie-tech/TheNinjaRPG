/**
 * Resolve a Vercel *preview* URL for the latest default-branch commit.
 *
 * Why this exists (and why we do not just grab "the latest preview"):
 *   • Production deploys of `main` have VERCEL_ENV=production. The AI
 *     test-user broker is preview-only, so production cannot host a repro.
 *   • The newest GitHub "Preview – tnr" deployment is almost always a PR
 *     head, i.e. unmerged code. Reproducing an issue there tests the wrong
 *     tree.
 *
 * Strategy:
 *   1. Optional override: TNR_MAIN_PREVIEW_URL (must be https://*.vercel.app)
 *   2. Reuse a successful "Preview – tnr" GitHub deployment of the main SHA,
 *      or of a snapshot commit of it left on `tnr-preview/main` by a prior run
 *   3. Otherwise create an empty snapshot commit (same tree as main) and point
 *      `tnr-preview/main` at it. The snapshot SHA is unique, so Vercel's
 *      GitHub integration always builds a preview for it — no reliance on
 *      whether Vercel deduplicates SHAs it already deployed to production.
 *   4. Poll until that preview succeeds, fails, or times out
 *
 * Env vars consumed:
 *   GITHUB_TOKEN, GITHUB_REPOSITORY, PUSH_TOKEN (PAT, contents:write),
 *   MAIN_SHA (optional), TNR_MAIN_PREVIEW_URL (optional),
 *   PREVIEW_BRANCH, PREVIEW_ENVIRONMENT_PATTERN,
 *   POLL_INTERVAL_MS, POLL_TIMEOUT_MS
 *
 * Outputs (via GITHUB_OUTPUT):
 *   is_ready, preview_url, reason, check_name, details_url, head_sha
 */
import { setOutput, createGithubClient, toTrustedPreviewUrl } from "./ci-helpers.mjs";
import {
  createPreviewDeploymentClient,
  requirePreview,
  withRetry,
} from "./preview-deployments.mjs";

const githubToken = process.env.GITHUB_TOKEN;
const pushToken = process.env.PUSH_TOKEN || "";
const repository = process.env.GITHUB_REPOSITORY;
const overrideUrl = (process.env.TNR_MAIN_PREVIEW_URL ?? "").trim();
const previewBranch = process.env.PREVIEW_BRANCH || "tnr-preview/main";
const environmentPatternRaw =
  process.env.PREVIEW_ENVIRONMENT_PATTERN || "^Preview\\s+[–-]\\s+tnr$";
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
const environmentRegex = new RegExp(environmentPatternRaw, "i");
const preview = createPreviewDeploymentClient({
  githubRequest,
  pushRequest,
  owner,
  repo,
  environmentRegex,
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

const fetchDefaultBranchSha = async () => {
  const repoInfo = await githubRequest(`/repos/${owner}/${repo}`);
  const defaultBranch = repoInfo?.default_branch;
  if (!defaultBranch) {
    throw new Error("Could not determine the repository default branch");
  }
  const encoded = defaultBranch.split("/").map(encodeURIComponent).join("/");
  const ref = await githubRequest(
    `/repos/${owner}/${repo}/git/refs/heads/${encoded}`,
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

  if (overrideUrl) {
    const normalized = overrideUrl.startsWith("http")
      ? overrideUrl
      : `https://${overrideUrl}`;
    const trusted = toTrustedPreviewUrl(normalized);
    if (!trusted) {
      notReady(
        "TNR_MAIN_PREVIEW_URL is not a trusted https://*.vercel.app URL",
        { head_sha: resolvedSha },
      );
      return;
    }
    ready({
      previewUrl: trusted,
      reason: "Using TNR_MAIN_PREVIEW_URL override",
      checkName: "TNR_MAIN_PREVIEW_URL",
      detailsUrl: trusted,
      headSha: resolvedSha,
    });
    return;
  }

  const existing = await withRetry(() => preview.inspectPreview(resolvedSha));
  if (existing.successful) {
    ready({
      previewUrl: existing.successful.url,
      reason: `Reusing existing ${existing.successful.environment} of main`,
      checkName: existing.successful.environment,
      detailsUrl: existing.successful.detailsUrl,
      headSha: resolvedSha,
    });
    return;
  }

  if (existing.inProgress) {
    console.log(
      `Preview already in progress (${existing.inProgress.state}); waiting`,
    );
    const waited = await preview.waitForPreview(resolvedSha, waitOptions);
    if (waited.successful) {
      ready({
        previewUrl: waited.successful.url,
        reason: `Waited for in-progress ${waited.successful.environment} of main`,
        checkName: waited.successful.environment,
        detailsUrl: waited.successful.detailsUrl,
        headSha: resolvedSha,
      });
      return;
    }
    if (!waited.failed) requirePreview(waited, resolvedSha);
    console.log(
      `In-progress preview of main failed (${waited.failed}); falling back to a fresh snapshot build`,
    );
  }

  // A previous run may already have a unique snapshot commit of this main SHA.
  const currentBranchSha = await preview.readBranchSha(previewBranch);
  if (currentBranchSha && currentBranchSha !== resolvedSha) {
    const snapshotOfMain = await preview.isSnapshotOf(
      currentBranchSha,
      resolvedSha,
    );
    if (snapshotOfMain) {
      const snapshotPreview = await withRetry(() =>
        preview.inspectPreview(currentBranchSha),
      );
      if (snapshotPreview.successful) {
        ready({
          previewUrl: snapshotPreview.successful.url,
          reason: `Reusing snapshot preview of main on ${previewBranch}`,
          checkName: snapshotPreview.successful.environment,
          detailsUrl: snapshotPreview.successful.detailsUrl,
          headSha: resolvedSha,
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
            reason: `Waited for in-progress snapshot preview of main`,
            checkName: waited.successful.environment,
            detailsUrl: waited.successful.detailsUrl,
            headSha: resolvedSha,
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

  // No reusable preview: build one from a fresh snapshot commit. The unique
  // SHA guarantees Vercel treats it as new work, even though the tree is
  // identical to main.
  const snapshotSha = await preview.createSnapshotCommit(
    resolvedSha,
    `tnr-preview: snapshot of ${resolvedSha.slice(0, 7)}`,
  );
  await preview.pointBranchAtSha(previewBranch, snapshotSha);
  console.log(
    `Created snapshot ${snapshotSha.slice(0, 7)} of main ${resolvedSha.slice(0, 7)} on ${previewBranch}`,
  );
  const successful = requirePreview(
    await preview.waitForPreview(snapshotSha, waitOptions),
    snapshotSha,
  );
  ready({
    previewUrl: successful.url,
    reason: `Created Preview – tnr snapshot of main via ${previewBranch}`,
    checkName: successful.environment,
    detailsUrl: successful.detailsUrl,
    headSha: resolvedSha,
  });
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  notReady(message);
  console.error(message);
});
