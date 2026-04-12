import { appendFileSync } from "node:fs";

const githubToken = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const prNumber = Number(process.env.PR_NUMBER);
const checkNamePatternRaw = process.env.VERCEL_CHECK_NAME_PATTERN ?? "vercel";

if (!githubToken) {
  throw new Error("Missing GITHUB_TOKEN");
}

if (!repository) {
  throw new Error("Missing GITHUB_REPOSITORY");
}

if (!Number.isInteger(prNumber) || prNumber <= 0) {
  throw new Error(`Invalid PR_NUMBER: ${process.env.PR_NUMBER ?? "undefined"}`);
}

const [owner, repo] = repository.split("/");
if (!owner || !repo) {
  throw new Error(`Invalid GITHUB_REPOSITORY: ${repository}`);
}

const setOutput = (key, value) => {
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${String(value ?? "")}\n`);
};

const githubRequest = async (path) => {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${githubToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "tnr-reviewer-preview-check",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API ${path} failed (${response.status}): ${body}`);
  }

  return response.json();
};

const extractPreviewUrl = (checkRun) => {
  const summary = checkRun?.output?.summary ?? "";

  // Vercel feedback URLs embed the deployment hostname after /open-feedback/
  // e.g. https://vercel.live/open-feedback/my-app-git-branch.vercel.app?via=...
  const feedbackMatch = summary.match(
    /https:\/\/vercel\.live\/open-feedback\/([a-z0-9-]+\.vercel\.app)/i,
  );
  if (feedbackMatch) return `https://${feedbackMatch[1]}`;

  const fromSummary = summary.match(/https:\/\/[^\s)]+/i)?.[0];
  if (fromSummary) return fromSummary;
  if (checkRun?.details_url?.includes("http")) return checkRun.details_url;
  return "";
};

const main = async () => {
  const regex = new RegExp(checkNamePatternRaw, "i");

  const pullRequest = await githubRequest(`/repos/${owner}/${repo}/pulls/${prNumber}`);
  const headSha = pullRequest?.head?.sha;
  const prUrl = pullRequest?.html_url ?? "";

  if (!headSha) {
    setOutput("is_ready", "false");
    setOutput("reason", `Missing head SHA for PR #${prNumber}`);
    return;
  }

  const checksResponse = await githubRequest(
    `/repos/${owner}/${repo}/commits/${headSha}/check-runs?per_page=100`,
  );

  const checks = Array.isArray(checksResponse?.check_runs) ? checksResponse.check_runs : [];
  const matchingChecks = checks.filter((checkRun) => regex.test(checkRun?.name ?? ""));
  const successfulChecks = matchingChecks.filter(
    (checkRun) => checkRun?.status === "completed" && checkRun?.conclusion === "success",
  );
  const latestSuccessfulCheck = successfulChecks.sort((a, b) => {
    const aCompleted = Date.parse(a?.completed_at ?? "");
    const bCompleted = Date.parse(b?.completed_at ?? "");
    return bCompleted - aCompleted;
  })[0];

  if (!latestSuccessfulCheck) {
    const availableCheckNames = checks.map((checkRun) => checkRun?.name).filter(Boolean);
    const reason = matchingChecks.length
      ? `Found Vercel checks but none are successful yet for pattern ${checkNamePatternRaw}.`
      : `No checks matched Vercel pattern ${checkNamePatternRaw}. Available checks: ${availableCheckNames.join(", ")}`;
    setOutput("is_ready", "false");
    setOutput("reason", reason);
    setOutput("head_sha", headSha);
    setOutput("pr_url", prUrl);
    return;
  }

  const previewUrl = extractPreviewUrl(latestSuccessfulCheck);

  setOutput("is_ready", "true");
  setOutput("reason", "");
  setOutput("preview_url", previewUrl);
  setOutput("check_name", latestSuccessfulCheck?.name ?? "");
  setOutput("details_url", latestSuccessfulCheck?.details_url ?? "");
  setOutput("head_sha", headSha);
  setOutput("pr_url", prUrl);
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  setOutput("is_ready", "false");
  setOutput("reason", message);
  console.error(message);
  process.exitCode = 1;
});
