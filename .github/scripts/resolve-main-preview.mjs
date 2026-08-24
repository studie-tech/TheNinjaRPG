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
import {
  setOutput,
  createGithubClient,
  toTrustedPreviewUrl,
} from "./ci-helpers.mjs";

const githubToken = process.env.GITHUB_TOKEN;
const pushToken = process.env.PUSH_TOKEN || "";
const repository = process.env.GITHUB_REPOSITORY;
const overrideUrl = (process.env.TNR_MAIN_PREVIEW_URL ?? "").trim();
const previewBranch = process.env.PREVIEW_BRANCH || "tnr-preview/main";
const environmentPatternRaw =
  process.env.PREVIEW_ENVIRONMENT_PATTERN || "^Preview\\s+[–-]\\s+tnr$";
const pollIntervalMs = Number(process.env.POLL_INTERVAL_MS ?? 15_000);
const pollTimeoutMs = Number(process.env.POLL_TIMEOUT_MS ?? 25 * 60 * 1000);

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

// Deployment statuses that can never become a usable preview.
const TERMINAL_STATES = ["failure", "error"];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Retry a read-only GitHub API call across transient failures (rate limits,
 * 5xx). 404 is a real answer, not a transient failure, so it is rethrown
 * immediately for callers that branch on it.
 */
const withRetry = async (fn, { attempts = 3, delayMs = 5_000 } = {}) => {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (error?.status === 404) throw error;
      lastError = error;
      if (attempt < attempts) {
        console.log(
          `Transient GitHub API error (attempt ${attempt}/${attempts}): ${error.message}`,
        );
        await sleep(delayMs);
      }
    }
  }
  throw lastError;
};

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

const listDeploymentsForSha = async (sha) => {
  const deployments = await githubRequest(
    `/repos/${owner}/${repo}/deployments?sha=${encodeURIComponent(sha)}&per_page=30`,
  );
  return Array.isArray(deployments) ? deployments : [];
};

const getLatestStatus = async (deploymentId) => {
  const statuses = await githubRequest(
    `/repos/${owner}/${repo}/deployments/${deploymentId}/statuses?per_page=10`,
  );
  return Array.isArray(statuses) ? statuses[0] : null;
};

const matchingDeployments = (deployments) =>
  deployments.filter((deployment) =>
    environmentRegex.test(deployment?.environment ?? ""),
  );

const inspectPreview = async (sha) => {
  const matching = matchingDeployments(await listDeploymentsForSha(sha));
  const statuses = await Promise.all(
    matching.map((deployment) => getLatestStatus(deployment.id)),
  );
  const inspected = matching.map((deployment, index) => {
    const status = statuses[index];
    return {
      id: deployment.id,
      environment: deployment.environment ?? "",
      state: status?.state ?? "unknown",
      url: toTrustedPreviewUrl(
        status?.environment_url || status?.target_url || "",
      ),
      detailsUrl: status?.target_url ?? "",
    };
  });
  const successful = inspected.find(
    (item) => item.state === "success" && item.url,
  );
  const inProgress = inspected.find((item) =>
    ["pending", "queued", "in_progress"].includes(item.state),
  );
  // Every matching deployment is dead — waiting longer cannot help.
  const allTerminal =
    inspected.length > 0 &&
    !successful &&
    !inProgress &&
    inspected.every((item) => TERMINAL_STATES.includes(item.state));
  return { successful, inProgress, inspected, allTerminal };
};

const encodeHeadsRef = (branch) =>
  branch.split("/").map(encodeURIComponent).join("/");

const readPreviewBranchSha = async () => {
  if (!pushRequest) return "";
  try {
    const ref = await withRetry(() =>
      pushRequest(
        `/repos/${owner}/${repo}/git/refs/heads/${encodeHeadsRef(previewBranch)}`,
      ),
    );
    return ref?.object?.sha ?? "";
  } catch (error) {
    if (error?.status === 404) return "";
    throw error;
  }
};

const pointPreviewBranchAtSha = async (sha) => {
  if (!pushRequest) {
    throw new Error(
      "PUSH_TOKEN is required to update the tnr-preview/main ref so Vercel can build a preview of main",
    );
  }

  const currentSha = await readPreviewBranchSha();
  if (currentSha === sha) {
    return { changed: false };
  }

  if (currentSha) {
    await pushRequest(
      `/repos/${owner}/${repo}/git/refs/heads/${encodeHeadsRef(previewBranch)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ sha, force: true }),
      },
    );
    return { changed: true, action: "updated" };
  }

  await pushRequest(`/repos/${owner}/${repo}/git/refs`, {
    method: "POST",
    body: JSON.stringify({
      ref: `refs/heads/${previewBranch}`,
      sha,
    }),
  });
  return { changed: true, action: "created" };
};

/**
 * Poll until the preview for `sha` succeeds, dies, or the timeout expires.
 * Returns { successful } on success, { failed } when every matching
 * deployment reached a terminal state, and { lastNote } alone on timeout.
 * Transient API errors are tolerated; only a persistent streak aborts.
 */
const waitForPreview = async (sha, timeoutMs = pollTimeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  const maxConsecutiveErrors = 5;
  let lastNote = "waiting for Vercel to create a Preview – tnr deployment";
  let consecutiveErrors = 0;

  while (Date.now() < deadline) {
    let inspection;
    try {
      inspection = await inspectPreview(sha);
    } catch (error) {
      consecutiveErrors += 1;
      if (consecutiveErrors >= maxConsecutiveErrors) {
        throw new Error(
          `GitHub API kept failing while polling for the preview: ${error.message}`,
        );
      }
      console.log(
        `Transient GitHub API error while polling (${consecutiveErrors}/${maxConsecutiveErrors}): ${error.message}`,
      );
      await sleep(pollIntervalMs);
      continue;
    }
    consecutiveErrors = 0;

    const { successful, inProgress, inspected, allTerminal } = inspection;
    if (successful) {
      return { successful };
    }
    if (allTerminal) {
      const failed = inspected
        .map((item) => `${item.environment}=${item.state}`)
        .join(", ");
      console.log(`Preview build reached a terminal state: ${failed}`);
      return { successful: null, failed };
    }
    lastNote = inProgress
      ? `Vercel preview is ${inProgress.state} (${inProgress.environment})`
      : inspected.length
        ? `Preview deployments exist but none are successful yet: ${inspected
            .map((item) => `${item.environment}=${item.state}`)
            .join(", ")}`
        : "No Preview – tnr deployment yet for this SHA";
    console.log(lastNote);
    await sleep(pollIntervalMs);
  }

  return { successful: null, lastNote };
};

const requirePreview = (result, sha) => {
  if (result.successful) return result.successful;
  if (result.failed) {
    throw new Error(
      `Vercel preview build failed for ${sha.slice(0, 7)}: ${result.failed}`,
    );
  }
  throw new Error(
    `Timed out waiting for a Preview – tnr deployment of ${sha.slice(0, 7)}. Last status: ${result.lastNote}`,
  );
};

/** Empty commit on top of main so Vercel sees a unique non-production SHA. */
const createMainSnapshotSha = async (baseSha) => {
  if (!pushRequest) {
    throw new Error(
      "PUSH_TOKEN is required to create a unique preview snapshot of main",
    );
  }
  const baseCommit = await withRetry(() =>
    pushRequest(`/repos/${owner}/${repo}/git/commits/${baseSha}`),
  );
  const snapshot = await pushRequest(`/repos/${owner}/${repo}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: `tnr-preview: snapshot of ${baseSha.slice(0, 7)}`,
      tree: baseCommit.tree.sha,
      parents: [baseSha],
    }),
  });
  if (!snapshot?.sha) {
    throw new Error("Failed to create tnr-preview snapshot commit");
  }
  return snapshot.sha;
};

const isSnapshotOf = async (candidateSha, parentSha) => {
  try {
    const commit = await withRetry(() =>
      githubRequest(`/repos/${owner}/${repo}/git/commits/${candidateSha}`),
    );
    return (commit?.parents ?? []).some((parent) => parent.sha === parentSha);
  } catch (error) {
    // A missing commit genuinely isn't a snapshot; anything else (rate limit,
    // 5xx) must propagate rather than silently forcing a redundant rebuild.
    if (error?.status === 404) return false;
    throw error;
  }
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

  const existing = await withRetry(() => inspectPreview(resolvedSha));
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
    const waited = await waitForPreview(resolvedSha);
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
  const currentBranchSha = await readPreviewBranchSha();
  if (currentBranchSha && currentBranchSha !== resolvedSha) {
    const snapshotOfMain = await isSnapshotOf(currentBranchSha, resolvedSha);
    if (snapshotOfMain) {
      const snapshotPreview = await withRetry(() =>
        inspectPreview(currentBranchSha),
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
        const waited = await waitForPreview(currentBranchSha);
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
  const snapshotSha = await createMainSnapshotSha(resolvedSha);
  await pointPreviewBranchAtSha(snapshotSha);
  console.log(
    `Created snapshot ${snapshotSha.slice(0, 7)} of main ${resolvedSha.slice(0, 7)} on ${previewBranch}`,
  );
  const successful = requirePreview(
    await waitForPreview(snapshotSha),
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
