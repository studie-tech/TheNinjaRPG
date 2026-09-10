/**
 * Checks whether a Vercel preview deployment is ready for a given PR.
 *
 * Looks for a preview in this order:
 *   1. Successful Vercel check runs on the PR head SHA (legacy auto-deploys)
 *   2. A reusable "Preview – tnr" GitHub deployment of the PR head SHA
 *   3. A snapshot commit on `tnr-preview/pr-{N}` whose parent is the PR head
 *
 * Env vars consumed:
 *   GITHUB_TOKEN, PR_NUMBER, VERCEL_CHECK_NAME_PATTERN,
 *   PREVIEW_BRANCH (optional), PREVIEW_ENVIRONMENT_PATTERN
 *
 * Outputs (via GITHUB_OUTPUT):
 *   is_ready    — "true" | "false"
 *   preview_url — the extracted deployment URL (only when ready)
 *   reason      — human-readable explanation when not ready
 *   check_name, details_url, head_sha, pr_url — supplementary metadata
 */
import { setOutput, createGithubClient, toTrustedPreviewUrl } from "./ci-helpers.mjs";
import {
  createPreviewDeploymentClient,
  withRetry,
} from "./preview-deployments.mjs";

const githubToken = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const prNumber = Number(process.env.PR_NUMBER);
const checkNamePatternRaw = process.env.VERCEL_CHECK_NAME_PATTERN ?? "vercel";
const environmentPatternRaw =
  process.env.PREVIEW_ENVIRONMENT_PATTERN || "^Preview\\s+[–-]\\s+tnr$";

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
  environmentRegex: new RegExp(environmentPatternRaw, "i"),
});

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

const findSuccessfulCheck = async (headSha) => {
  const regex = new RegExp(checkNamePatternRaw, "i");
  const checksResponse = await githubRequest(
    `/repos/${owner}/${repo}/commits/${headSha}/check-runs?per_page=100`,
  );

  const checks = Array.isArray(checksResponse?.check_runs)
    ? checksResponse.check_runs
    : [];
  const matchingChecks = checks.filter((checkRun) =>
    regex.test(checkRun?.name ?? ""),
  );
  const successfulChecks = matchingChecks.filter(
    (checkRun) =>
      checkRun?.status === "completed" && checkRun?.conclusion === "success",
  );

  const latestSuccessfulCheck = successfulChecks.sort((a, b) => {
    const aCompleted = Date.parse(a?.completed_at ?? "");
    const bCompleted = Date.parse(b?.completed_at ?? "");
    return bCompleted - aCompleted;
  })[0];

  return { checks, matchingChecks, latestSuccessfulCheck };
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

  const { matchingChecks, latestSuccessfulCheck } =
    await findSuccessfulCheck(headSha);
  if (latestSuccessfulCheck) {
    const previewUrl = extractPreviewUrl(latestSuccessfulCheck);
    if (previewUrl) {
      ready({
        previewUrl,
        checkName: latestSuccessfulCheck?.name ?? "",
        detailsUrl: latestSuccessfulCheck?.details_url ?? "",
        headSha,
        prUrl,
      });
      return;
    }
  }

  const headDeployment = await withRetry(() => preview.inspectPreview(headSha));
  if (headDeployment.successful) {
    ready({
      previewUrl: headDeployment.successful.url,
      checkName: headDeployment.successful.environment,
      detailsUrl: headDeployment.successful.detailsUrl,
      headSha,
      prUrl,
    });
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

  const reason = matchingChecks.length
    ? `Found Vercel checks but none are successful yet for pattern ${checkNamePatternRaw}. ${createPreviewHint}`
    : `No Vercel preview is deployed for this PR. ${createPreviewHint}`;
  notReady(reason, { head_sha: headSha, pr_url: prUrl });
};

// Catch-all: surface the error as a "not ready" output rather than crashing
// the workflow step, so the "Post blocked reason" step can still run
main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  notReady(message);
  console.error(message);
});
