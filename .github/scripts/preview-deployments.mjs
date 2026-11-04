/**
 * Shared GitHub Deployment helpers for TNR Vercel preview snapshots.
 *
 * Vercel previews for this repo are discovered via GitHub Deployments whose
 * environment matches PREVIEW_ENVIRONMENT_REGEX. On-demand previews are created by
 * pointing a `tnr-preview/*` branch at an empty snapshot commit (same tree as
 * the source SHA) so the GitHub integration builds a unique preview SHA.
 */
import { encodeHeadsRef, setOutput, toTrustedPreviewUrl } from "./ci-helpers.mjs";

/** Vercel names the preview environment `Preview` or `Preview – tnr`. */
export const PREVIEW_ENVIRONMENT_REGEX = /^Preview(\s+[–-]\s+tnr)?$/i;

export const REUSABLE_STATES = ["success", "inactive"];
export const TERMINAL_STATES = ["failure", "error", "inactive"];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Retry a GitHub API call across transient failures (rate limits, 5xx).
 * 404 is a real answer, not a transient failure, so it is rethrown immediately.
 */
export const withRetry = async (fn, { attempts = 3, delayMs = 5_000 } = {}) => {
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

/** Write the outputs of a snapshot preview that could not be made ready. */
export const reportPreviewNotReady = (reason) => {
  setOutput("is_ready", "false");
  setOutput("reason", reason);
  setOutput("preview_url", "");
  setOutput("check_name", "");
  setOutput("details_url", "");
  setOutput("head_sha", "");
};

/** Write the outputs of a ready snapshot preview. */
export const reportPreviewReady = ({ url, reason, checkName, detailsUrl, headSha }) => {
  setOutput("is_ready", "true");
  setOutput("reason", reason ?? "");
  setOutput("preview_url", url);
  setOutput("check_name", checkName ?? "");
  setOutput("details_url", detailsUrl ?? "");
  setOutput("head_sha", headSha ?? "");
};

/**
 * Reuse or wait on the snapshot of `sourceSha` already on `branch`, otherwise build a fresh
 * one. The snapshot SHA is unique, so Vercel treats it as new work even with an identical tree.
 *
 * @param {object} options
 * @param {ReturnType<typeof createPreviewDeploymentClient>} options.preview
 * @param {string} options.sourceSha
 * @param {string} options.branch
 * @param {string} options.label - How outputs and logs name the source, such as `main`
 * @param {string} options.snapshotMessage
 * @param {{ pollIntervalMs: number, deadline: number }} options.waitOptions
 * @returns {Promise<{ url: string, reason: string, checkName: string, detailsUrl: string }>}
 */
export const ensureSnapshotPreview = async ({
  preview,
  sourceSha,
  branch,
  label,
  snapshotMessage,
  waitOptions,
}) => {
  const describe = (successful, reason) => ({
    url: successful.url,
    reason,
    checkName: successful.environment,
    detailsUrl: successful.detailsUrl,
  });

  // A previous run may already have a unique snapshot commit of this SHA.
  const currentBranchSha = await preview.readBranchSha(branch);
  if (currentBranchSha && (await preview.isSnapshotOf(currentBranchSha, sourceSha))) {
    const snapshotPreview = await withRetry(() =>
      preview.inspectPreview(currentBranchSha),
    );
    if (snapshotPreview.successful) {
      return describe(
        snapshotPreview.successful,
        `Reusing snapshot preview of ${label} on ${branch}`,
      );
    }
    if (snapshotPreview.inProgress) {
      const waited = await preview.waitForPreview(currentBranchSha, waitOptions);
      if (waited.successful) {
        return describe(
          waited.successful,
          `Waited for in-progress snapshot preview of ${label}`,
        );
      }
      if (!waited.failed) requirePreview(waited, currentBranchSha);
      console.log(
        `Snapshot preview build failed (${waited.failed}); creating a fresh snapshot`,
      );
    }
  }

  const snapshotSha = await preview.createSnapshotCommit(sourceSha, snapshotMessage);
  await preview.pointBranchAtSha(branch, snapshotSha);
  console.log(
    `Created snapshot ${snapshotSha.slice(0, 7)} of ${label} ${sourceSha.slice(0, 7)} on ${branch}`,
  );
  const successful = requirePreview(
    await preview.waitForPreview(snapshotSha, waitOptions),
    snapshotSha,
  );
  return describe(successful, `Created Vercel Preview snapshot of ${label} via ${branch}`);
};

/**
 * @param {object} options
 * @param {(path: string, options?: RequestInit) => Promise<any>} options.githubRequest
 * @param {((path: string, options?: RequestInit) => Promise<any>) | null} [options.pushRequest]
 * @param {string} options.owner
 * @param {string} options.repo
 */
export const createPreviewDeploymentClient = ({
  githubRequest,
  pushRequest = null,
  owner,
  repo,
}) => {
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
      PREVIEW_ENVIRONMENT_REGEX.test(deployment?.environment ?? ""),
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
      (item) => REUSABLE_STATES.includes(item.state) && item.url,
    );
    const inProgress = inspected.find((item) =>
      ["pending", "queued", "in_progress"].includes(item.state),
    );
    const allTerminal =
      inspected.length > 0 &&
      !successful &&
      !inProgress &&
      inspected.every((item) => TERMINAL_STATES.includes(item.state));
    return { successful, inProgress, inspected, allTerminal };
  };

  const readBranchSha = async (branch) => {
    const reader = pushRequest || githubRequest;
    try {
      const ref = await withRetry(() =>
        reader(`/repos/${owner}/${repo}/git/ref/heads/${encodeHeadsRef(branch)}`),
      );
      return ref?.object?.sha ?? "";
    } catch (error) {
      if (error?.status === 404) return "";
      throw error;
    }
  };

  const pointBranchAtSha = async (branch, sha) => {
    if (!pushRequest) {
      throw new Error(
        `PUSH_TOKEN is required to update ${branch} so Vercel can build a preview`,
      );
    }

    const currentSha = await readBranchSha(branch);
    if (currentSha === sha) return;

    if (currentSha) {
      await pushRequest(
        `/repos/${owner}/${repo}/git/refs/heads/${encodeHeadsRef(branch)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ sha, force: true }),
        },
      );
      return;
    }

    await pushRequest(`/repos/${owner}/${repo}/git/refs`, {
      method: "POST",
      body: JSON.stringify({
        ref: `refs/heads/${branch}`,
        sha,
      }),
    });
  };

  const waitForPreview = async (sha, { pollIntervalMs, deadline }) => {
    const maxConsecutiveErrors = 5;
    let lastNote = "waiting for Vercel to create a Preview deployment";
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
          : "No Vercel Preview deployment yet for this SHA";
      console.log(lastNote);
      await sleep(pollIntervalMs);
    }

    return { successful: null, lastNote };
  };

  const createSnapshotCommit = async (baseSha, message) => {
    if (!pushRequest) {
      throw new Error(
        "PUSH_TOKEN is required to create a unique preview snapshot commit",
      );
    }
    const baseCommit = await withRetry(() =>
      pushRequest(`/repos/${owner}/${repo}/git/commits/${baseSha}`),
    );
    const snapshot = await pushRequest(`/repos/${owner}/${repo}/git/commits`, {
      method: "POST",
      body: JSON.stringify({
        message,
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
      if (error?.status === 404) return false;
      throw error;
    }
  };

  return {
    inspectPreview,
    waitForPreview,
    readBranchSha,
    pointBranchAtSha,
    createSnapshotCommit,
    isSnapshotOf,
  };
};

export const requirePreview = (result, sha) => {
  if (result.successful) return result.successful;
  if (result.failed) {
    throw new Error(
      `Vercel preview build failed for ${sha.slice(0, 7)}: ${result.failed}`,
    );
  }
  throw new Error(
    `Timed out waiting for a Vercel Preview deployment of ${sha.slice(0, 7)}. Last status: ${result.lastNote}`,
  );
};
