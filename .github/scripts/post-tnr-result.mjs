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
 *   RESULT, FINAL_MESSAGE, ARTIFACT_URL, SCREENSHOT_MARKDOWN,
 *   BLOCK_REASON, MODE
 */
import { createGithubClient } from "./ci-helpers.mjs";

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
const screenshotMarkdown = process.env.SCREENSHOT_MARKDOWN ?? "";

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

/** Join lines, dropping null/undefined but keeping empty strings as spacers. */
const joinLines = (lines) =>
  lines.filter((line) => line !== null && line !== undefined).join("\n");

/**
 * Replace local file-path references that are meaningless in a PR comment:
 * - Markdown images:  ![caption](./artifacts/...) or ![caption](/home/runner/...)
 * - Markdown links:   [text](./artifacts/...) or [text](/home/runner/...)
 * Converts them to plain text (keeps the link text, drops the dead URL).
 */
const stripLocalPaths = (text) =>
  text
    .replace(/!?\[([^\]]*)\]\((?:\.?\/?\.?artifacts\/|\/home\/runner\/)[^)]+\)/g, "$1")
    .trim();

/** Build the markdown body for the PR comment based on the outcome. */
const buildBody = () => {
  // Codex passes literal "\n" in the output — convert to real newlines
  const rawMessage = finalMessage.replace(/\\n/g, "\n").trim();
  const cleanMessage = stripLocalPaths(rawMessage);

  if (result === "blocked") {
    return joinLines([
      "## TNR reviewer blocked",
      "",
      `Mode: \`${mode}\``,
      blockReason ? `Reason: ${blockReason}` : "Reason: unknown",
      runUrl ? `Run: [View workflow run](${runUrl})` : null,
    ]);
  }

  const screenshotSection = screenshotMarkdown.trim()
    ? ["", "---", "", "### Screenshots", "", screenshotMarkdown.trim()]
    : [];

  const footerLinks = [
    "",
    "---",
    artifactUrl ? `Artifacts (screenshots/logs): [Download artifacts](${artifactUrl})` : null,
    runUrl ? `Run: [View workflow run](${runUrl})` : null,
  ];

  if (result === "success") {
    return joinLines([
      cleanMessage || "## TNR reviewer completed",
      ...screenshotSection,
      ...footerLinks,
    ]);
  }

  return joinLines([
    "## TNR reviewer failed",
    "",
    `Mode: \`${mode}\``,
    cleanMessage ? ["", "Agent output:", "", cleanMessage] : null,
    ...screenshotSection,
    ...footerLinks,
  ].flat());
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
