import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const outputPromptPath = process.env.PROMPT_FILE ?? "/tmp/tnr-review-prompt.txt";
const rawPreviewUrl = process.env.PREVIEW_URL ?? "";
const vercelBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? "";
const brokerToken = process.env.AI_TEST_USER_BROKER_TOKEN ?? "";
const prNumber = process.env.PR_NUMBER ?? "";
const prTitle = process.env.PR_TITLE ?? "";
const prBody = process.env.PR_BODY ?? "";
const prAuthor = process.env.PR_AUTHOR ?? "";
const commandAuthor = process.env.COMMAND_AUTHOR ?? "";
const repository = process.env.REPOSITORY ?? "";
const extraInstructions = process.env.EXTRA_INSTRUCTIONS ?? "";

const bypassParams = vercelBypass
  ? `x-vercel-protection-bypass=${vercelBypass}&x-vercel-set-bypass-cookie=true`
  : "";

const previewUrl =
  rawPreviewUrl && bypassParams
    ? `${rawPreviewUrl}?${bypassParams}`
    : rawPreviewUrl;

const brokerUrl = rawPreviewUrl ? `${rawPreviewUrl}/api/ai-test-user` : "";

const instructionsBlock = extraInstructions.trim()
  ? [
      "",
      "Additional review instructions from command:",
      extraInstructions.trim(),
      "",
    ].join("\n")
  : "";

const authBlock =
  brokerUrl && brokerToken
    ? [
        "",
        "## Authentication: AI test-user broker",
        "",
        "Clerk sign-in UI will NOT work in headless CI. Use the broker instead.",
        "",
        "To provision test users from shell, first seed a bypass cookie, then POST to the broker:",
        "```",
        `curl -s -c /tmp/vercel.cookie "${rawPreviewUrl}?${bypassParams}" -o /dev/null`,
        `curl -s -b /tmp/vercel.cookie -X POST "${brokerUrl}?${bypassParams}" \\`,
        `  -H "Content-Type: application/json" \\`,
        `  -H "x-tnr-reviewer-token: ${brokerToken}" \\`,
        `  -d '{"users":[{"key":"player1","level":100,"rank":"JONIN","villageName":"Shine"}]}'`,
        "```",
        "",
        "Alternatively, you can provision users from inside the browser context using Playwright's `browser_network_request` or `browser_run_code` after navigating to the preview with bypass params (which sets the cookie automatically).",
        "",
        "The response will be JSON:",
        "```json",
        '{ "success": true, "users": [{ "key": "player1", "userId": "...", "username": "...", "email": "...", "password": "...", "level": 100, "rank": "JONIN", "villageId": "...", "villageName": "Shine", "isBanned": false, "signInToken": "..." }], "testingToken": "..." }',
        "```",
        "",
        "Valid village names are: Shine, Tsukimori, Glacier, Shroud, Current.",
        "",
        "## Logging in as a provisioned user",
        "",
        "Each user in the response includes a `signInToken`. To authenticate in the browser, navigate Playwright to:",
        "```",
        `${rawPreviewUrl}/login?__clerk_ticket=<signInToken>&${bypassParams}`,
        "```",
        "This performs a one-time Clerk ticket sign-in. After navigation, wait a few seconds for the redirect to complete, then take a snapshot to confirm the user is logged in.",
        "",
        "IMPORTANT: The app mounts Clerk at /login, NOT /sign-in. Always use /login for authentication URLs.",
        "",
        "If the broker returns an error, log the full response and continue with whatever testing is possible.",
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
  "- Use the Playwright MCP tools for browser automation (navigate, click, fill, screenshot, etc.).",
  "- The Playwright MCP runs headless Chromium — use `browser_navigate` to open URLs, `browser_snapshot` to read page structure, and `browser_take_screenshot` for visual evidence.",
  `- IMPORTANT: The preview is protected. Always append these query params when navigating: \`?${bypassParams}\`. The Preview URL below already includes them. After the first page load the bypass cookie is set and subsequent navigations should work without them.`,
  "- Take screenshots for key checkpoints and failures.",
  "- Save screenshots under `.artifacts/screenshots/` by downloading from Playwright.",
  "- Save a short step log under `.artifacts/tnr-review/test-steps.md`.",
  "- If blocked, document exactly what blocked testing and what evidence was collected.",
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
  `Preview base URL: ${rawPreviewUrl}`,
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
