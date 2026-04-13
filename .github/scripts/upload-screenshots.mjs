/**
 * Uploads screenshots to a dedicated orphan branch via the GitHub Git Data API,
 * then outputs markdown image references that render inline in PR comments.
 *
 * Uses the Git Data API (blobs → tree → commit → ref) to avoid any local
 * branch switching. Each run gets its own orphan branch so images persist
 * after the workflow artifacts expire.
 *
 * Env vars consumed:
 *   GH_TOKEN (or GITHUB_TOKEN), GITHUB_REPOSITORY, GITHUB_RUN_ID,
 *   PR_NUMBER, SCREENSHOTS_DIR (defaults to .artifacts/screenshots)
 *
 * Outputs (via GITHUB_OUTPUT):
 *   screenshot_markdown — rendered markdown with ![caption](raw-url) blocks
 */
import { readdirSync, readFileSync, appendFileSync } from "node:fs";
import { join, extname } from "node:path";

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
const prNumber = process.env.PR_NUMBER;
const runId = process.env.GITHUB_RUN_ID;
const screenshotsDir = process.env.SCREENSHOTS_DIR || ".artifacts/screenshots";

if (!token || !repo) {
  console.log("Missing token or GITHUB_REPOSITORY — skipping screenshot upload");
  process.exit(0);
}

const BRANCH = `tnr-screenshots/pr-${prNumber}/${runId}`;
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

const apiRequest = async (path, options = {}) => {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API ${path} failed (${response.status}): ${body}`);
  }
  return response.json();
};

const setOutput = (key, value) => {
  if (!process.env.GITHUB_OUTPUT) return;
  const str = String(value ?? "");
  if (str.includes("\n")) {
    const delimiter = `ghadelimiter_${Date.now()}`;
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `${key}<<${delimiter}\n${str}\n${delimiter}\n`,
    );
  } else {
    appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${str}\n`);
  }
};

const main = async () => {
  let files;
  try {
    files = readdirSync(screenshotsDir)
      .filter((f) => IMAGE_EXTENSIONS.has(extname(f).toLowerCase()))
      .map((f) => ({ name: f, path: join(screenshotsDir, f) }));
  } catch {
    files = [];
  }

  if (files.length === 0) {
    console.log("No screenshots found in", screenshotsDir);
    setOutput("screenshot_markdown", "");
    return;
  }

  console.log(`Found ${files.length} screenshot(s), uploading to branch ${BRANCH}`);

  // Step 1: Create a blob for each image
  const treeEntries = [];
  for (const file of files) {
    const content = readFileSync(file.path).toString("base64");
    const blob = await apiRequest(`/repos/${repo}/git/blobs`, {
      method: "POST",
      body: JSON.stringify({ content, encoding: "base64" }),
    });
    treeEntries.push({
      path: file.name,
      mode: "100644",
      type: "blob",
      sha: blob.sha,
    });
    console.log(`  Blob for ${file.name}: ${blob.sha}`);
  }

  // Step 2: Create a tree containing all blobs
  const tree = await apiRequest(`/repos/${repo}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ tree: treeEntries }),
  });

  // Step 3: Create an orphan commit (no parents) pointing to the tree
  const commit = await apiRequest(`/repos/${repo}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: `TNR review screenshots for PR #${prNumber} (run ${runId})`,
      tree: tree.sha,
      parents: [],
    }),
  });

  // Step 4: Create the branch ref (or force-update if it already exists)
  try {
    await apiRequest(`/repos/${repo}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${BRANCH}`, sha: commit.sha }),
    });
  } catch {
    const encoded = BRANCH.split("/").map(encodeURIComponent).join("/");
    await apiRequest(`/repos/${repo}/git/refs/heads/${encoded}`, {
      method: "PATCH",
      body: JSON.stringify({ sha: commit.sha, force: true }),
    });
  }

  console.log(`Branch ${BRANCH} ready`);

  // Step 5: Build markdown image references using raw.githubusercontent.com
  const lines = files.map((file) => {
    const rawUrl = `https://raw.githubusercontent.com/${repo}/${BRANCH}/${encodeURIComponent(file.name)}`;
    const caption = file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
    return `**${caption}**\n![${caption}](${rawUrl})`;
  });

  setOutput("screenshot_markdown", lines.join("\n\n"));
};

main().catch((error) => {
  console.error("Screenshot upload failed:", error.message);
  setOutput("screenshot_markdown", "");
});
