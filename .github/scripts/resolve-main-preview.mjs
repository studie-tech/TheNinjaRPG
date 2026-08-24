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
 *   2. Reuse a successful "Preview – tnr" GitHub deployment of the main SHA
 *   3. Point the `tnr-preview/main` ref at that SHA so Vercel's existing
 *      GitHub integration creates a preview (same path PR previews use)
 *   4. Poll until that preview is successful, or time out
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  const inspected = [];
  for (const deployment of matching) {
    const status = await getLatestStatus(deployment.id);
    const url = toTrustedPreviewUrl(
      status?.environment_url || status?.target_url || "",
    );
    inspected.push({
      id: deployment.id,
      environment: deployment.environment ?? "",
      state: status?.state ?? "unknown",
      url,
      detailsUrl: status?.target_url ?? "",
    });
  }
  const successful = inspected.find(
    (item) => item.state === "success" && item.url,
  );
  const inProgress = inspected.find((item) =>
    ["pending", "queued", "in_progress"].includes(item.state),
  );
  return { successful, inProgress, inspected };
};

const encodeHeadsRef = (branch) =>
  branch.split("/").map(encodeURIComponent).join("/");

const readPreviewBranchSha = async () => {
  if (!pushRequest) return "";
  try {
    const ref = await pushRequest(
      `/repos/${owner}/${repo}/git/refs/heads/${encodeHeadsRef(previewBranch)}`,
    );
    return ref?.object?.sha ?? "";
  } catch (error) {
    if (String(error.message).includes("404")) return "";
    throw error;
  }
};

const pointPreviewBranchAtSha = async (sha) => {
  if (!pushRequest) {
    throw new Error(
      "PUSH_TOKEN is required to create the tnr-preview/main ref so Vercel can build a preview of main",
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

const waitForPreview = async (sha) => {
  const deadline = Date.now() + pollTimeoutMs;
  let lastNote = "waiting for Vercel to create a Preview – tnr deployment";

  while (Date.now() < deadline) {
    const { successful, inProgress, inspected } = await inspectPreview(sha);
    if (successful) {
      return successful;
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

  throw new Error(
    `Timed out after ${Math.round(pollTimeoutMs / 1000)}s waiting for a Preview – tnr deployment of ${sha.slice(0, 7)}. Last status: ${lastNote}`,
  );
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

  const existing = await inspectPreview(resolvedSha);
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
    const successful = await waitForPreview(resolvedSha);
    ready({
      previewUrl: successful.url,
      reason: `Waited for in-progress ${successful.environment} of main`,
      checkName: successful.environment,
      detailsUrl: successful.detailsUrl,
      headSha: resolvedSha,
    });
    return;
  }

  const branchResult = await pointPreviewBranchAtSha(resolvedSha);
  console.log(
    branchResult.changed
      ? `${branchResult.action} ${previewBranch} -> ${resolvedSha}`
      : `${previewBranch} already points at ${resolvedSha}; waiting for Vercel`,
  );

  const successful = await waitForPreview(resolvedSha);
  ready({
    previewUrl: successful.url,
    reason: branchResult.changed
      ? `Created Preview – tnr of main via ${previewBranch}`
      : `Waited for Preview – tnr of main on ${previewBranch}`,
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
