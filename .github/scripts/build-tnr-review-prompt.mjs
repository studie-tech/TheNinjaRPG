import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const outputPromptPath = process.env.PROMPT_FILE ?? "/tmp/tnr-review-prompt.txt";
const previewUrl = process.env.PREVIEW_URL ?? "";
const prNumber = process.env.PR_NUMBER ?? "";
const prTitle = process.env.PR_TITLE ?? "";
const prBody = process.env.PR_BODY ?? "";
const prAuthor = process.env.PR_AUTHOR ?? "";
const commandAuthor = process.env.COMMAND_AUTHOR ?? "";
const repository = process.env.REPOSITORY ?? "";
const extraInstructions = process.env.EXTRA_INSTRUCTIONS ?? "";
const testUserBrokerUrl = process.env.AI_TEST_USER_BROKER_URL ?? "";

const instructionsBlock = extraInstructions.trim()
  ? [
      "",
      "Additional review instructions from command:",
      extraInstructions.trim(),
      "",
    ].join("\n")
  : "";

const authBlock = testUserBrokerUrl.trim()
  ? [
      "Authentication and test-user setup:",
      `- If auth is required, request test users via \`${testUserBrokerUrl}\` using the provided machine token header.`,
      "- Request the minimum number of accounts needed, but support multi-account checks when user flows require it.",
      "",
    ].join("\n")
  : "";

const prompt = [
  "You are the TNR reviewer agent for a pull request.",
  "",
  "Goal:",
  "- Validate this PR from a player/user perspective using browser automation against the preview deployment.",
  "- Test all key functionality introduced or changed by the PR.",
  "",
  "Operating rules:",
  "- Use browser MCP tooling for navigation and interaction.",
  "- Take screenshots for key checkpoints and failures.",
  "- Save screenshots under `.artifacts/screenshots/`.",
  "- Save a short step log under `.artifacts/tnr-review/test-steps.md`.",
  "- If blocked, document exactly what blocked testing and what evidence was collected.",
  "",
  authBlock,
  "Output requirements:",
  "- Produce a final markdown report with these sections:",
  "  1. Scope covered",
  "  2. Test steps executed",
  "  3. Findings (pass/fail, bugs, risks)",
  "  4. Screenshot index (file paths + short captions)",
  "  5. Recommendation (approve/needs follow-up)",
  "",
  `Repository: ${repository}`,
  `PR: #${prNumber}`,
  `PR author: @${prAuthor}`,
  `Command author: @${commandAuthor}`,
  `Preview URL: ${previewUrl}`,
  `PR title: ${prTitle}`,
  "",
  "PR body:",
  prBody || "(empty)",
  instructionsBlock,
].join("\n");

mkdirSync(dirname(outputPromptPath), { recursive: true });
writeFileSync(outputPromptPath, prompt);

if (process.env.GITHUB_OUTPUT) {
  writeFileSync(process.env.GITHUB_OUTPUT, `prompt_file=${outputPromptPath}\n`, {
    flag: "a",
  });
}
