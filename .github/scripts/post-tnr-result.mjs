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

const joinLines = (lines) =>
  lines.filter((line) => line !== null && line !== undefined).join("\n");

const buildBody = () => {
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

  if (Number.isInteger(commentId) && commentId > 0) {
    await githubRequest(`/repos/${owner}/${repo}/issues/comments/${commentId}`, {
      method: "PATCH",
      body: JSON.stringify({ body }),
    });
    return;
  }

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
