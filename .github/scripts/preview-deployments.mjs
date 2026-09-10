/**
 * Shared GitHub Deployment helpers for TNR Vercel preview snapshots.
 *
 * Vercel previews for this repo are discovered via GitHub Deployments whose
 * environment matches `Preview – tnr`. On-demand previews are created by
 * pointing a `tnr-preview/*` branch at an empty snapshot commit (same tree as
 * the source SHA) so the GitHub integration builds a unique preview SHA.
 */
import { toTrustedPreviewUrl } from "./ci-helpers.mjs";

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

export const encodeHeadsRef = (branch) =>
  branch.split("/").map(encodeURIComponent).join("/");

/**
 * @param {object} options
 * @param {(path: string, options?: RequestInit) => Promise<any>} options.githubRequest
 * @param {((path: string, options?: RequestInit) => Promise<any>) | null} [options.pushRequest]
 * @param {string} options.owner
 * @param {string} options.repo
 * @param {RegExp} options.environmentRegex
 */
export const createPreviewDeploymentClient = ({
  githubRequest,
  pushRequest = null,
  owner,
  repo,
  environmentRegex,
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
    if (currentSha === sha) {
      return { changed: false };
    }

    if (currentSha) {
      await pushRequest(
        `/repos/${owner}/${repo}/git/refs/heads/${encodeHeadsRef(branch)}`,
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
        ref: `refs/heads/${branch}`,
        sha,
      }),
    });
    return { changed: true, action: "created" };
  };

  const waitForPreview = async (
    sha,
    { pollIntervalMs, deadline, timeoutMs } = {},
  ) => {
    const interval = pollIntervalMs ?? 15_000;
    const waitDeadline =
      deadline ?? (timeoutMs ? Date.now() + timeoutMs : Date.now() + 25 * 60 * 1000);
    const maxConsecutiveErrors = 5;
    let lastNote = "waiting for Vercel to create a Preview – tnr deployment";
    let consecutiveErrors = 0;

    while (Date.now() < waitDeadline) {
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
        await sleep(interval);
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
      await sleep(interval);
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
    `Timed out waiting for a Preview – tnr deployment of ${sha.slice(0, 7)}. Last status: ${result.lastNote}`,
  );
};
