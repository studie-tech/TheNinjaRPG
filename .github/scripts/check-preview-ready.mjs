/**
 * Checks whether a Vercel preview deployment is ready for a given PR.
 *
 * Previews are built only from snapshot commits (see create-pr-preview.mjs), so
 * this looks for a Vercel Preview GitHub deployment of the snapshot commit on
 * `tnr-preview/pr-{N}` whose parent is the PR head.
 *
 * Env vars consumed:
 *   GITHUB_TOKEN, PR_NUMBER, PREVIEW_BRANCH (optional)
 *
 * Outputs (via GITHUB_OUTPUT):
 *   is_ready    — "true" | "false"
 *   preview_url — the extracted deployment URL (only when ready)
 *   reason      — human-readable explanation when not ready
 *   check_name, details_url, head_sha, pr_url — supplementary metadata
 */
import { setOutput, createGithubClient } from "./ci-helpers.mjs";
import {
  createPreviewDeploymentClient,
  withRetry,
} from "./preview-deployments.mjs";

const githubToken = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const prNumber = Number(process.env.PR_NUMBER);

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
const preview = createPreviewDeploymentClient({
  githubRequest,
  owner,
  repo,
});

const notReady = (reason, extras = {}) => {
  setOutput("is_ready", "false");
  setOutput("reason", reason);
  setOutput("preview_url", extras.preview_url ?? "");
  setOutput("check_name", extras.check_name ?? "");
  setOutput("details_url", extras.details_url ?? "");
  setOutput("head_sha", extras.head_sha ?? "");
  setOutput("pr_url", extras.pr_url ?? "");
};

const ready = ({ previewUrl, checkName, detailsUrl, headSha, prUrl }) => {
  setOutput("is_ready", "true");
  setOutput("reason", "");
  setOutput("preview_url", previewUrl);
  setOutput("check_name", checkName ?? "");
  setOutput("details_url", detailsUrl ?? "");
  setOutput("head_sha", headSha);
  setOutput("pr_url", prUrl ?? "");
};

const createPreviewHint =
  "A collaborator with write access can comment `/tnr-create-preview` to deploy one.";

const main = async () => {
  const pullRequest = await githubRequest(
    `/repos/${owner}/${repo}/pulls/${prNumber}`,
  );
  const headSha = pullRequest?.head?.sha;
  const prUrl = pullRequest?.html_url ?? "";

  if (!headSha) {
    notReady(`Missing head SHA for PR #${prNumber}`);
    return;
  }

  const snapshotSha = await preview.readBranchSha(previewBranch);
  if (snapshotSha) {
    const snapshotOfHead = await preview.isSnapshotOf(snapshotSha, headSha);
    if (snapshotOfHead) {
      const snapshotPreview = await withRetry(() =>
        preview.inspectPreview(snapshotSha),
      );
      if (snapshotPreview.successful) {
        ready({
          previewUrl: snapshotPreview.successful.url,
          checkName: snapshotPreview.successful.environment,
          detailsUrl: snapshotPreview.successful.detailsUrl,
          headSha,
          prUrl,
        });
        return;
      }
      if (snapshotPreview.inProgress) {
        notReady(
          `A preview of this PR head is still building on ${previewBranch}. Wait for it to finish, or comment \`/tnr-create-preview\` again.`,
          { head_sha: headSha, pr_url: prUrl },
        );
        return;
      }
      if (snapshotPreview.allTerminal) {
        notReady(
          `The last preview build for this PR head failed. ${createPreviewHint}`,
          { head_sha: headSha, pr_url: prUrl },
        );
        return;
      }
    } else {
      notReady(
        `The existing preview on ${previewBranch} is for an older commit. ${createPreviewHint}`,
        { head_sha: headSha, pr_url: prUrl },
      );
      return;
    }
  }

  notReady(`No Vercel preview is deployed for this PR. ${createPreviewHint}`, {
    head_sha: headSha,
    pr_url: prUrl,
  });
};

// Catch-all: surface the error as a "not ready" output rather than crashing
// the workflow step, so the "Post blocked reason" step can still run
main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  notReady(message);
  console.error(message);
});
