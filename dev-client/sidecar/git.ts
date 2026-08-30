import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Thin git / gh helpers. All GitHub I/O goes through the user's locally
// authenticated `gh` CLI; the AI agent itself never sees GitHub credentials.

// Long bodies go through temp files (--body-file) to avoid any shell quoting
// issues; gh is invoked via execFile (no shell) but files keep it simple.
// The directory is always removed afterwards, hence the callback form.
async function withBodyFile<T>(
  content: string,
  use: (file: string) => Promise<T>,
): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "tnr-dev-client-"));
  try {
    const file = join(dir, "body.md");
    writeFileSync(file, content, "utf8");
    return await use(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export interface CmdResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

// Well above MAX_DIFF_CHARS: the default 1 MiB makes execFile error out on a
// large `gh pr diff` before we get the chance to truncate it ourselves, which
// surfaced as "Could not read the pull request diff" on big PRs.
const EXEC_MAX_BUFFER_BYTES = 32 * 1024 * 1024;

/**
 * The abort signal for the git/gh work of the current run.
 *
 * Publication is several separate processes (push, then `gh pr create`, then the
 * review or comment post). Checking a flag between them only closes the gaps;
 * Stop landing *during* a push still published the branch. Passing the signal to
 * execFile lets Node terminate the child itself, so cancellation lands inside
 * the call rather than after it.
 */
let activeGitSignal: AbortSignal | undefined;

export const setGitAbortSignal = (signal: AbortSignal | undefined): void => {
  activeGitSignal = signal;
};

export const execFileAsync = (
  file: string,
  args: string[],
  opts?: { timeout?: number; cwd?: string; signal?: AbortSignal },
): Promise<CmdResult> =>
  new Promise((resolve) => {
    execFile(
      file,
      args,
      {
        timeout: opts?.timeout ?? 120_000,
        cwd: opts?.cwd,
        maxBuffer: EXEC_MAX_BUFFER_BYTES,
        signal: opts?.signal ?? activeGitSignal,
      },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
        });
      },
    );
  });

export const git = (repoPath: string, args: string[]): Promise<CmdResult> =>
  execFileAsync("git", ["-C", repoPath, ...args], { timeout: 300_000 });

export const gh = (args: string[]): Promise<CmdResult> =>
  execFileAsync("gh", args, { timeout: 120_000 });

// "owner/repo" from a GitHub URL (issue, PR, or repo URL).
export function slugFromUrl(url: string): string | null {
  const match = url.match(/github\.com[/:]([^/\s]+)\/([^/\s#?]+)/);
  if (!match?.[1] || !match[2]) return null;
  return `${match[1]}/${match[2].replace(/\.git$/, "")}`;
}

// The login of the account `gh` is authenticated as (the fork owner).
export async function ghLogin(): Promise<string | null> {
  const { ok, stdout } = await gh(["api", "user", "--jq", ".login"]);
  return ok && stdout.trim() ? stdout.trim() : null;
}

// Base the worktree on the UPSTREAM repository's default branch, fetched by URL
// into a dedicated ref.
//
// Setup asks the contributor for a clone of their fork, so `origin` is the fork
// and `origin/main` is whatever state it was last synced to. Building on that
// produces work against a stale base while the pull request targets upstream —
// avoidable conflicts, and sometimes a fix for code that has already changed.
//
// The fetch must succeed. Falling back to a pre-existing ref would silently
// reintroduce exactly the staleness this exists to avoid.
/**
 * Clone URL for the job's upstream repository.
 *
 * Overridable so the integration tests can stand a local repository in for
 * github.com; production always resolves to the real host.
 */
export const upstreamRemoteUrl = (slug: string): string => {
  const base = process.env.TNR_DEV_CLIENT_GIT_BASE;
  if (base) return `${base.replace(/\/+$/, "")}/${slug}`;
  return `https://github.com/${slug}.git`;
};

export async function createWorktree(
  repoPath: string,
  target: string,
  upstreamSlug: string,
  baseBranch = "main",
): Promise<CmdResult> {
  const ref = "refs/tnr-dev/base";
  const fetched = await git(repoPath, [
    "fetch",
    "--no-tags",
    upstreamRemoteUrl(upstreamSlug),
    `+refs/heads/${baseBranch}:${ref}`,
  ]);
  if (!fetched.ok) {
    return {
      ok: false,
      stdout: fetched.stdout,
      stderr:
        `Could not fetch ${baseBranch} from ${upstreamSlug}: ${fetched.stderr}`.trim(),
    };
  }
  return git(repoPath, ["worktree", "add", "--detach", target, ref]);
}

export async function removeWorktree(repoPath: string, target: string): Promise<void> {
  await git(repoPath, ["worktree", "remove", "--force", target]);
  await git(repoPath, ["worktree", "prune"]);
  rmSync(target, { recursive: true, force: true });
}

export async function hasChanges(worktreePath: string): Promise<boolean> {
  const { ok, stdout } = await git(worktreePath, ["status", "--porcelain"]);
  return ok && stdout.trim().length > 0;
}

export async function commitAll(
  worktreePath: string,
  message: string,
): Promise<CmdResult> {
  await git(worktreePath, ["add", "-A"]);
  return git(worktreePath, ["commit", "-m", message]);
}

export async function checkoutBranch(
  worktreePath: string,
  branch: string,
): Promise<CmdResult> {
  return git(worktreePath, ["checkout", "-b", branch]);
}

/**
 * Push the work branch to the contributor's own fork.
 *
 * `origin` is only correct when the configured clone is a fork; for a clone of
 * the upstream repository the push would be rejected for anyone without write
 * access. Prefer a remote that actually belongs to `login`, and fall back to
 * origin so an already-fork-shaped setup keeps working.
 */
export async function pushBranch(
  worktreePath: string,
  branch: string,
  login?: string,
): Promise<CmdResult> {
  const remote = (await forkRemote(worktreePath, login)) ?? "origin";
  return git(worktreePath, ["push", "-u", remote, branch]);
}

/** The first remote whose URL is owned by `login`, if any. */
export async function forkRemote(
  worktreePath: string,
  login: string | undefined,
): Promise<string | null> {
  if (!login) return null;
  const { ok, stdout } = await git(worktreePath, ["remote", "-v"]);
  if (!ok) return null;
  for (const line of stdout.split("\n")) {
    const [name, url] = line.trim().split(/\s+/);
    if (!name || !url) continue;
    const slug = slugFromUrl(url);
    if (slug?.split("/")[0]?.toLowerCase() === login.toLowerCase()) return name;
  }
  return null;
}

export async function createPullRequest(opts: {
  slug: string;
  base: string;
  head: string;
  title: string;
  body: string;
}): Promise<{ ok: boolean; url: string | null; error: string }> {
  const { ok, stdout, stderr } = await gh([
    "pr",
    "create",
    "--repo",
    opts.slug,
    "--base",
    opts.base,
    "--head",
    opts.head,
    "--title",
    opts.title,
    "--body",
    opts.body,
  ]);
  if (!ok)
    return { ok: false, url: null, error: stderr.trim() || "gh pr create failed" };
  const url = stdout.trim().split("\n").pop()?.trim();
  return { ok: true, url: url || null, error: "" };
}

export async function postPullRequestReview(opts: {
  number: number;
  slug: string;
  body: string;
}): Promise<{ ok: boolean; url: string | null; error: string }> {
  const { ok, stderr } = await withBodyFile(opts.body, (file) =>
    gh([
      "pr",
      "review",
      String(opts.number),
      "--repo",
      opts.slug,
      "--comment",
      "--body-file",
      file,
    ]),
  );
  if (!ok)
    return { ok: false, url: null, error: stderr.trim() || "gh pr review failed" };
  return {
    ok: true,
    url: `https://github.com/${opts.slug}/pull/${opts.number}`,
    error: "",
  };
}

export async function postIssueComment(opts: {
  number: number;
  slug: string;
  body: string;
}): Promise<{ ok: boolean; url: string | null; error: string }> {
  const { ok, stderr } = await withBodyFile(opts.body, (file) =>
    gh([
      "issue",
      "comment",
      String(opts.number),
      "--repo",
      opts.slug,
      "--body-file",
      file,
    ]),
  );
  if (!ok)
    return { ok: false, url: null, error: stderr.trim() || "gh issue comment failed" };
  return {
    ok: true,
    url: `https://github.com/${opts.slug}/issues/${opts.number}`,
    error: "",
  };
}

export async function pullRequestBody(opts: {
  number: number;
  slug: string;
}): Promise<string> {
  const { ok, stdout } = await gh([
    "pr",
    "view",
    String(opts.number),
    "--repo",
    opts.slug,
    "--json",
    "title,body,author,url",
  ]);
  if (!ok) return "";
  return stdout;
}

// Truncated so an enormous pull request cannot blow up the agent's context.
const MAX_DIFF_CHARS = 200_000;

/**
 * The pull request's diff.
 *
 * A review job runs in a worktree checked out at origin/main, so without this
 * the agent never sees the proposed change and would be reviewing nothing.
 */
export async function pullRequestDiff(opts: {
  number: number;
  slug: string;
}): Promise<string> {
  const { ok, stdout } = await gh([
    "pr",
    "diff",
    String(opts.number),
    "--repo",
    opts.slug,
  ]);
  if (!ok) return "";
  return stdout.length > MAX_DIFF_CHARS
    ? `${stdout.slice(0, MAX_DIFF_CHARS)}\n... (diff truncated)`
    : stdout;
}
