import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type GameApi, TrpcError } from "./api";
import { isTokenCapExceeded, recordUsage, tokensUsedToday } from "./budget";
import {
  checkoutBranch,
  commitAll,
  createPullRequest,
  createWorktree,
  ghLogin,
  hasChanges,
  postIssueComment,
  postPullRequestReview,
  pullRequestBody,
  pushBranch,
  removeWorktree,
  slugFromUrl,
} from "./git";
import { jobsDir, loadSettings } from "./state";
import type { Agent, RunState, SerializedJob } from "./types";

// How long a single agent run may take before we give up.
const AGENT_TIMEOUT_MS = 30 * 60 * 1000;
// Keep the claim alive: the server marks claims stale after ~10 min of silence.
const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000;

export interface RunnerDeps {
  api: GameApi;
  agent: Agent;
  job: SerializedJob;
  cliPath: string;
  log: (line: string) => void;
  isAborted: () => boolean;
  abort: () => void;
}

export interface RunnerResult {
  ok: boolean;
  tokensIn: number;
  tokensOut: number;
  resultUrl: string | null;
  verified: boolean | null;
  reward: string | null;
  error: string | null;
}

interface AgentRun {
  ok: boolean;
  output: string;
  lines: string[];
  error: string | null;
}

// Runs the agent CLI headlessly with a scrubbed environment: no GitHub
// credentials, no git credential prompts. The agent's own LLM auth (stored in
// the CLI's config dir) is left untouched.
function runAgent(
  cliPath: string,
  agent: Agent,
  prompt: string,
  cwd: string,
  isAborted: () => boolean,
): Promise<AgentRun> {
  const args =
    agent === "CLAUDE"
      ? [
          "-p",
          prompt,
          "--output-format",
          "stream-json",
          "--verbose",
          "--dangerously-skip-permissions",
        ]
      : ["exec", "--json", prompt];

  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.GITHUB_TOKEN;
  delete env.GH_TOKEN;
  delete env.GITHUB_ISSUE_TOKEN;
  env.GIT_TERMINAL_PROMPT = "0";

  return new Promise((resolve) => {
    const child = spawn(cliPath, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    const lines: string[] = [];
    let stdout = "";
    let stderr = "";
    let settled = false;
    let aborted = false;

    const finish = (ok: boolean, error: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(pollAbort);
      if (!ok) child.kill("SIGTERM");
      resolve({ ok, output: stdout, lines, error });
    };

    const timeout = setTimeout(() => {
      aborted = true;
      finish(false, `Agent timed out after ${AGENT_TIMEOUT_MS / 60000} minutes`);
    }, AGENT_TIMEOUT_MS);

    // Poll for external aborts (stop button / sidecar shutdown).
    const pollAbort = setInterval(() => {
      if (isAborted()) {
        aborted = true;
        finish(false, "Aborted by user");
      }
    }, 1000);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      for (const line of stdout.split("\n")) {
        if (line.trim()) lines.push(line);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      finish(false, `Failed to start agent: ${error.message}`);
    });
    child.on("close", (code) => {
      if (aborted) return;
      if (code === 0) finish(true, null);
      else
        finish(
          false,
          `Agent exited with code ${code}${stderr ? `: ${stderr.slice(-500)}` : ""}`,
        );
    });
  });
}

// Both CLIs emit a cumulative usage object on their final JSON event; take the
// last one. Missing/unknown output degrades to zero rather than failing.
export function parseAgentUsage(lines: string[]): {
  tokensIn: number;
  tokensOut: number;
} {
  let tokensIn = 0;
  let tokensOut = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const ev = event as { usage?: unknown; message?: { usage?: unknown } };
    const usage = ev?.usage ?? ev?.message?.usage;
    if (typeof usage !== "object" || usage === null) continue;
    const u = usage as { input_tokens?: unknown; output_tokens?: unknown };
    const input = Number(u.input_tokens);
    const output = Number(u.output_tokens);
    if (Number.isFinite(input)) tokensIn = input;
    if (Number.isFinite(output)) tokensOut = output;
  }
  return { tokensIn, tokensOut };
}

function buildPrompt(job: SerializedJob): string {
  const { title, labels = [], body } = job.context;
  const header = [
    `Job: ${job.jobType} for ${job.refUrl}`,
    title ? `Title: ${title}` : null,
    labels.length ? `Labels: ${labels.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  switch (job.jobType) {
    case "ISSUE_IMPLEMENT":
      return [
        header,
        "",
        body ? `Issue body:\n${body}` : null,
        "",
        "Implement the fix in this repository. Make focused, minimal changes.",
        "Run the project's tests and linters if they are set up, and make sure they pass.",
        "Do not push or open pull requests yourself; commit your work and stop.",
      ]
        .filter(Boolean)
        .join("\n");
    case "PR_REVIEW":
      return [
        header,
        "",
        "Review this pull request. Focus on correctness, security, and maintainability.",
        "Produce a concise review: overall verdict, key issues (with file references where",
        "possible), and concrete suggestions. End with a short summary.",
      ].join("\n");
    case "ISSUE_TRIAGE":
      return [
        header,
        "",
        body ? `Issue body:\n${body}` : null,
        "",
        "Triage this issue: is it well-formed and reproducible, which component is affected,",
        "what is the likely root cause, and what are the recommended next steps?",
      ]
        .filter(Boolean)
        .join("\n");
  }
}

// Orchestrate one claimed job: worktree (for implementation), agent run,
// GitHub submission via gh, and the server-side completion/failure report.
export async function runJob(deps: RunnerDeps): Promise<RunnerResult> {
  const { api, agent, job, cliPath, log } = deps;
  const settings = loadSettings();
  const repoPath = settings.repoPath;

  const slug = slugFromUrl(job.refUrl);
  if (!slug) {
    await safeFail(api, job.id, "Job has no valid GitHub URL");
    return {
      ok: false,
      tokensIn: 0,
      tokensOut: 0,
      resultUrl: null,
      verified: null,
      reward: null,
      error: "Invalid refUrl",
    };
  }

  const heartbeat = setInterval(() => {
    void api
      .heartbeat(job.id)
      .catch(() => log("Heartbeat failed (job may have been released)"));
  }, HEARTBEAT_INTERVAL_MS);

  const stopHeartbeat = () => clearInterval(heartbeat);

  log(`Starting ${job.jobType} ${job.refUrl} with ${agent}`);

  // Token usage consumed so far, recorded even when the run later fails.
  let consumedIn = 0;
  let consumedOut = 0;
  const noteConsumed = (inTokens: number, outTokens: number) => {
    consumedIn = inTokens;
    consumedOut = outTokens;
  };

  try {
    let tokensIn = 0;
    let tokensOut = 0;
    let resultUrl: string | null = null;

    if (job.jobType === "ISSUE_IMPLEMENT") {
      if (!repoPath) throw new Error("No repository path configured");

      const worktree = join(jobsDir(), `job-${job.id}-${Date.now()}`);
      mkdirSync(worktree, { recursive: true });
      const created = await createWorktree(repoPath, worktree);
      if (!created.ok) {
        await removeWorktree(repoPath, worktree);
        throw new Error(`Failed to create worktree: ${created.stderr}`);
      }
      log(`Worktree ready at ${worktree}`);

      try {
        const run = await runAgent(
          cliPath,
          agent,
          buildPrompt(job),
          worktree,
          deps.isAborted,
        );
        const usage = parseAgentUsage(run.lines);
        tokensIn = usage.tokensIn;
        tokensOut = usage.tokensOut;
        noteConsumed(tokensIn, tokensOut);
        if (!run.ok) throw new Error(run.error ?? "Agent run failed");
        log(`Agent finished (in=${tokensIn} out=${tokensOut} tokens)`);

        const changed = await hasChanges(worktree);
        if (!changed) throw new Error("Agent made no changes");

        const branch = `tnr-dev/job-${job.id}-${Date.now().toString(36)}`;
        const committed = await commitAll(
          worktree,
          `Fix ${slug} #${job.refNumber}\n\nTheNinja-RPG dev job ${job.id}`,
        );
        if (!committed.ok) throw new Error(`Commit failed: ${committed.stderr}`);
        await checkoutBranch(worktree, branch);
        const pushed = await pushBranch(worktree, branch);
        if (!pushed.ok) throw new Error(`Push failed: ${pushed.stderr}`);

        const login = (await ghLogin()) || settings.githubLogin || "unknown";
        const pr = await createPullRequest({
          slug,
          base: "main",
          head: `${login}:${branch}`,
          title: `Fix #${job.refNumber}: ${job.context.title ?? "dev-client job"}`,
          body: [
            `Fixes https://github.com/${slug}/issues/${job.refNumber}`,
            "",
            "Generated by a TheNinja-RPG dev contribution run.",
          ].join("\n"),
        });
        if (!pr.ok) throw new Error(pr.error);
        resultUrl = pr.url;
        log(`PR created: ${resultUrl}`);
      } finally {
        await removeWorktree(repoPath, worktree).catch(() => {});
      }
    } else if (job.jobType === "PR_REVIEW") {
      const prInfo = await pullRequestBody({ number: job.refNumber, slug });
      const run = await runAgent(
        cliPath,
        agent,
        `${buildPrompt(job)}\n\nPull request metadata:\n${prInfo}`,
        process.cwd(),
        deps.isAborted,
      );
      const usage = parseAgentUsage(run.lines);
      tokensIn = usage.tokensIn;
      tokensOut = usage.tokensOut;
      noteConsumed(tokensIn, tokensOut);
      if (!run.ok) throw new Error(run.error ?? "Agent run failed");

      const post = await postPullRequestReview({
        number: job.refNumber,
        slug,
        body: `## Dev-client review\n\n${run.output.trim()}`,
      });
      if (!post.ok) throw new Error(post.error);
      resultUrl = post.url;
      log(`Review posted: ${resultUrl}`);
    } else {
      const run = await runAgent(
        cliPath,
        agent,
        buildPrompt(job),
        process.cwd(),
        deps.isAborted,
      );
      const usage = parseAgentUsage(run.lines);
      tokensIn = usage.tokensIn;
      tokensOut = usage.tokensOut;
      noteConsumed(tokensIn, tokensOut);
      if (!run.ok) throw new Error(run.error ?? "Agent run failed");

      const post = await postIssueComment({
        number: job.refNumber,
        slug,
        body: `## Dev-client triage\n\n${run.output.trim()}`,
      });
      if (!post.ok) throw new Error(post.error);
      resultUrl = post.url;
      log(`Triage comment posted: ${resultUrl}`);
    }

    recordUsage(agent, tokensIn + tokensOut);
    const complete = await api.completeJob({
      jobId: job.id,
      tokensIn,
      tokensOut,
      resultUrl: resultUrl ?? undefined,
    });
    log(
      complete.verified
        ? `Job verified and rewarded: ${complete.reward ?? "no reward"}`
        : "Job completed (not verified yet, no reward)",
    );
    return {
      ok: true,
      tokensIn,
      tokensOut,
      resultUrl,
      verified: complete.verified,
      reward: complete.reward,
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Job failed: ${message}`);
    recordUsage(agent, consumedIn + consumedOut);
    await safeFail(api, job.id, message);
    return {
      ok: false,
      tokensIn: consumedIn,
      tokensOut: consumedOut,
      resultUrl: null,
      verified: null,
      reward: null,
      error: message,
    };
  } finally {
    stopHeartbeat();
  }
}

async function safeFail(api: GameApi, jobId: number, error: string): Promise<void> {
  try {
    await api.failJob({ jobId, error: error.slice(0, 2000) });
  } catch (e) {
    if (e instanceof TrpcError && e.httpStatus === 401) return; // token expired; nothing to do
  }
}

// Pre-flight checks before claiming: local budget + configured repo.
export function canClaim(
  agent: Agent,
  run: RunState,
): { ok: boolean; reason?: string } {
  // Terminal phases (completed/failed) keep the last run visible in the UI but
  // must not block the next claim.
  if (run.phase === "preparing" || run.phase === "agent" || run.phase === "submitting")
    return { ok: false, reason: "A job is already running" };
  const settings = loadSettings();
  if (!settings.repoPath)
    return { ok: false, reason: "Configure a local repository path in Settings" };
  const cap =
    agent === "CLAUDE" ? settings.claudeDailyTokenCap : settings.codexDailyTokenCap;
  const used = tokensUsedToday(agent);
  if (isTokenCapExceeded(used, cap))
    return {
      ok: false,
      reason: `Daily ${agent.toLowerCase()} token cap reached (${used}/${cap})`,
    };
  return { ok: true };
}
