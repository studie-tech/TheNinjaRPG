/**
 * Posts or updates the TNR reviewer result comment on the PR.
 *
 * If COMMENT_ID is set, updates that comment (PATCH); otherwise creates a new
 * issue comment on ISSUE_NUMBER (POST). The comment body is built from RESULT
 * (success | failed | blocked), the Codex agent's FINAL_MESSAGE, and links to
 * the workflow run and uploaded artifacts.
 *
 * Env vars consumed:
 *   GITHUB_TOKEN, ISSUE_NUMBER, COMMENT_ID, RUN_URL,
 *   RESULT, FINAL_MESSAGE, ARTIFACT_URL, BLOCK_REASON, MODE
 */
const githubToken = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const issueNumber = Number(process.env.ISSUE_NUMBER);
const commentId = Number(process.env.COMMENT_ID);
const runUrl = process.env.RUN_URL ?? "";
const result = process.env.RESULT ?? "failed";
const finalMessage = process.env.FINAL_MESSAGE ?? "";
const artifactUrl = process.env.ARTIFACT_URL ?? "";
const blockReason = process.env.BLOCK_REASON ?? "";
const mode = process.env.MODE ?? "pr-review";

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

/** Authenticated request against the GitHub REST API (supports GET, POST, PATCH). */
const githubRequest = async (path, options = {}) => {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${githubToken}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "tnr-reviewer-comment-updater",
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API ${path} failed (${response.status}): ${body}`);
  }

  return response.json();
};

/** Join lines, dropping null/undefined but keeping empty strings as spacers. */
const joinLines = (lines) =>
  lines.filter((line) => line !== null && line !== undefined).join("\n");

/** Build the markdown body for the PR comment based on the outcome. */
const buildBody = () => {
  // Codex passes literal "\n" in the output — convert to real newlines
  const normalizedFinalMessage = finalMessage.replace(/\\n/g, "\n").trim();

  if (result === "blocked") {
    return joinLines([
      "## TNR reviewer blocked",
      "",
      `Mode: \`${mode}\``,
      blockReason ? `Reason: ${blockReason}` : "Reason: unknown",
      runUrl ? `Run: [View workflow run](${runUrl})` : null,
    ]);
  }

  // On success, prefer the agent's own report; fall back to a generic header
  if (result === "success") {
    return joinLines([
      normalizedFinalMessage || "## TNR reviewer completed",
      "",
      artifactUrl ? `Artifacts (screenshots/logs): [Open artifact](${artifactUrl})` : null,
      runUrl ? `Run: [View workflow run](${runUrl})` : null,
    ]);
  }

  return joinLines([
    "## TNR reviewer failed",
    "",
    `Mode: \`${mode}\``,
    runUrl ? `Run: [View workflow run](${runUrl})` : null,
    artifactUrl ? `Partial artifacts: [Open artifact](${artifactUrl})` : null,
  ]);
};

const main = async () => {
  const body = buildBody();

  // Preferred path: update the "started" comment in-place
  if (Number.isInteger(commentId) && commentId > 0) {
    await githubRequest(`/repos/${owner}/${repo}/issues/comments/${commentId}`, {
      method: "PATCH",
      body: JSON.stringify({ body }),
    });
    return;
  }

  // Fallback: create a new comment if the initial comment couldn't be posted
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    throw new Error("Missing valid ISSUE_NUMBER for fallback comment creation");
  }

  await githubRequest(`/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
