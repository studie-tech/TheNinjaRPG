import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import superjson from "superjson";
import { recordUsage, tokensUsedToday } from "../budget";
import { sha256Base64Url } from "../oauth";
import { type Server, startServer } from "../server";
import { tokenPath } from "../state";
import type { SerializedJob } from "../types";

// End-to-end test: boots the real sidecar in-process against a fake game
// server (tRPC + /dev-connect) and fake claude/gh CLIs on PATH. Exercises the
// full loop: settings, PKCE connect, token storage, claim preflight/caps,
// agent runs, GitHub submission, history, abort, sign-out.

const REWARD = "500 gold";
const DEVICE_TOKEN = "devtok-123";

type FakeConnect = {
  state?: string;
  codeChallenge?: string;
  loopbackPort?: string;
};

type CompleteInput = {
  jobId: number;
  tokensIn?: number;
  tokensOut?: number;
  resultUrl?: string;
};

type FailInput = { jobId: number; error?: string };

type Recorded = {
  connect: FakeConnect | null;
  exchanges: { code: string; verifier: string; auth?: string }[];
  updateProfile: unknown[];
  claims: { agent?: string; auth?: string }[];
  heartbeats: number[];
  completes: CompleteInput[];
  fails: FailInput[];
  revokes: string[];
  authViolations: string[];
};

const recorded: Recorded = {
  connect: null,
  exchanges: [],
  updateProfile: [],
  claims: [],
  heartbeats: [],
  completes: [],
  fails: [],
  revokes: [],
  authViolations: [],
};

let nextClaim: (() => SerializedJob) | null = null;

const triageJob = (): SerializedJob => ({
  id: 42,
  jobType: "ISSUE_TRIAGE",
  refKind: "ISSUE",
  refNumber: 7,
  refUrl: "https://github.com/studie-tech/TheNinjaRPG/issues/7",
  context: { title: "Ninja stuck in tree", labels: ["bug"] },
  agent: "CLAUDE",
  claimedAt: new Date(),
  heartbeatAt: null,
  staleThresholdMs: 600_000,
});

const prJob = (): SerializedJob => ({
  id: 43,
  jobType: "PR_REVIEW",
  refKind: "PULL_REQUEST",
  refNumber: 5,
  refUrl: "https://github.com/studie-tech/TheNinjaRPG/pull/5",
  context: { title: "Combat damage fix" },
  agent: "CLAUDE",
  claimedAt: new Date(),
  heartbeatAt: null,
  staleThresholdMs: 600_000,
});

function handleFake(
  proc: string,
  input: unknown,
  auth: string | null,
): { data: unknown } | { error: { message: string; code: string } } {
  switch (proc) {
    case "exchangeConnectCode": {
      const { code, codeVerifier } = input as { code: string; codeVerifier: string };
      recorded.exchanges.push({
        code,
        verifier: codeVerifier,
        auth: auth ?? undefined,
      });
      const challenge = recorded.connect?.codeChallenge;
      if (
        !challenge ||
        code !== "code-abc" ||
        sha256Base64Url(codeVerifier) !== challenge
      )
        return { error: { message: "PKCE validation failed", code: "UNAUTHORIZED" } };
      return {
        data: {
          success: true,
          deviceToken: DEVICE_TOKEN,
          expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
        },
      };
    }
    case "updateProfile":
      recorded.updateProfile.push(input);
      return { data: { success: true, message: "ok" } };
    case "claimNextJob":
      recorded.claims.push({
        agent: (input as { agent?: string })?.agent,
        auth: auth ?? undefined,
      });
      return nextClaim
        ? { data: { success: true, claimed: true, job: nextClaim() } }
        : { data: { success: true, claimed: false, message: "No jobs available" } };
    case "heartbeat":
      recorded.heartbeats.push((input as { jobId: number }).jobId);
      return { data: { success: true, message: "ok" } };
    case "completeJob":
      recorded.completes.push(input as CompleteInput);
      return { data: { success: true, reward: REWARD, verified: true } };
    case "failJob":
      recorded.fails.push(input as FailInput);
      return { data: { success: true, message: "ok" } };
    case "revokeDeviceToken":
      recorded.revokes.push(auth ?? "none");
      return { data: { success: true, message: "revoked" } };
    default:
      throw new Error(`fake server: unknown procedure ${proc}`);
  }
}

let home: string;
let fakeDir: string;
let fakePort: number;
let repoDir: string;
let sidecar: Server;

const FAKE_CLAUDE = `#!/bin/sh
# Fake claude CLI for integration tests.
for a in "$@"; do
  [ "$a" = "--version" ] && { echo "9.9.9-fake (Claude Code)"; exit 0; }
done
echo "fake-claude args: $*" >> "$TNR_FAKE_DIR/claude-calls.log"
[ -f "$TNR_FAKE_DIR/hang" ] && { sleep 30; exit 0; }
echo '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"partial"}],"usage":{"input_tokens":100,"output_tokens":50}}}'
echo '{"type":"result","result":"FAKE AGENT WRITE-UP","usage":{"input_tokens":111,"cache_creation_input_tokens":389,"cache_read_input_tokens":1000,"output_tokens":222}}'
exit 0
`;

const FAKE_CODEX = `#!/bin/sh
# Fake codex CLI for integration tests.
for a in "$@"; do
  [ "$a" = "--version" ] && { echo "fake-codex-cli 9.9.9"; exit 0; }
done
echo "fake-codex args: $*" >> "$TNR_FAKE_DIR/codex-calls.log"
echo '{"last_agent_message":"FAKE CODEX WRITE-UP","usage":{"input_tokens":111,"cache_read_input_tokens":1389,"output_tokens":222}}'
exit 0
`;

const FAKE_GH = `#!/bin/sh
# Fake gh CLI for integration tests.
echo "fake-gh args: $*" >> "$TNR_FAKE_DIR/gh-calls.log"
case "$1" in
  api)
    echo "fake-login"
    exit 0
    ;;
  pr)
    if [ "$2" = "view" ]; then
      echo '{"title":"Fake PR","body":"Fake PR body","author":{"login":"upstream-dev"},"url":"https://github.com/studie-tech/TheNinjaRPG/pull/5"}'
    fi
    if [ "$2" = "diff" ]; then
      echo 'diff --git a/src/fake.ts b/src/fake.ts'
      echo '@@ -1 +1 @@'
      echo '-const a = 1;'
      echo '+const a = 2;'
    fi
    exit 0
    ;;
esac
exit 0
`;

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "tnr-dev-client-it-"));
  process.env.TNR_DEV_CLIENT_HOME = home;
  process.env.TNR_DEV_CLIENT_NO_BROWSER = "1";

  fakeDir = mkdtempSync(join(tmpdir(), "tnr-dev-client-fake-"));
  process.env.TNR_FAKE_DIR = fakeDir;
  writeFileSync(join(fakeDir, "claude"), FAKE_CLAUDE, "utf8");
  writeFileSync(join(fakeDir, "codex"), FAKE_CODEX, "utf8");
  writeFileSync(join(fakeDir, "gh"), FAKE_GH, "utf8");
  for (const name of ["claude", "codex", "gh"]) {
    chmodSync(join(fakeDir, name), 0o755);
  }
  process.env.PATH = `${fakeDir}:${process.env.PATH}`;

  // Every job type now runs inside a throwaway git worktree, so the fixture
  // needs to be a real repository with an origin/main to branch from.
  repoDir = mkdtempSync(join(tmpdir(), "tnr-dev-client-repo-"));
  const run = (args: string[], cwd = repoDir) =>
    Bun.spawnSync(["git", ...args], {
      cwd,
      env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" },
    });
  run(["init", "--initial-branch=main", "."]);
  run(["config", "user.email", "test@example.com"]);
  run(["config", "user.name", "Test"]);
  writeFileSync(join(repoDir, "README.md"), "fixture\n", "utf8");
  run(["add", "-A"]);
  run(["commit", "-m", "init"]);
  // A self-referencing origin gives the worktree an origin/main to base on.
  run(["remote", "add", "origin", repoDir]);
  run(["fetch", "origin", "main"]);

  const fake = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (req: Request) => {
      const url = new URL(req.url);
      const auth = req.headers.get("authorization");
      if (url.pathname === "/dev-connect") {
        recorded.connect = {
          state: url.searchParams.get("state") ?? undefined,
          codeChallenge: url.searchParams.get("code_challenge") ?? undefined,
          loopbackPort: url.searchParams.get("loopback_port") ?? undefined,
        };
        return new Response("fake sign-in page", { status: 200 });
      }
      const match = url.pathname.match(/^\/api\/trpc\/devContribution\.(\w+)$/);
      const proc = match?.[1];
      if (!proc)
        return Response.json([{ error: { message: "Not found" } }], { status: 404 });
      if (proc !== "exchangeConnectCode" && auth !== `Bearer ${DEVICE_TOKEN}`)
        recorded.authViolations.push(`${proc}:${auth ?? "none"}`);
      let input: unknown;
      try {
        if (req.method === "POST") {
          const text = await req.text();
          // Some mutations (revokeDeviceToken) are sent without a body.
          input = text ? superjson.parse(text) : undefined;
        } else {
          const raw = url.searchParams.get("input");
          input = raw ? superjson.parse(raw) : undefined;
        }
      } catch (error) {
        return Response.json(
          [{ error: { message: `bad input: ${String(error)}`, code: "BAD_REQUEST" } }],
          { status: 400 },
        );
      }
      let out: { data: unknown } | { error: { message: string; code: string } };
      try {
        out = handleFake(proc, input, auth);
      } catch (error) {
        return Response.json(
          [{ error: { message: String(error), code: "INTERNAL_SERVER_ERROR" } }],
          { status: 500 },
        );
      }
      if ("error" in out) return Response.json([{ error: out.error }], { status: 401 });
      return Response.json([{ result: { data: superjson.serialize(out.data) } }]);
    },
  });
  fakePort = fake.port ?? 0;

  sidecar = startServer(0, () => {});
}, 30_000);

afterAll(() => {
  sidecar?.stop();
  rmSync(repoDir, { recursive: true, force: true });
  delete process.env.TNR_DEV_CLIENT_HOME;
  delete process.env.TNR_DEV_CLIENT_NO_BROWSER;
  delete process.env.TNR_FAKE_DIR;
  rmSync(home, { recursive: true, force: true });
  rmSync(fakeDir, { recursive: true, force: true });
});

const base = () => `http://127.0.0.1:${sidecar.port}`;

async function call(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  opts: { auth?: boolean; origin?: string } = {},
): Promise<{ status: number; text: string; json: <T>() => T }> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (opts.auth !== false) headers.authorization = `Bearer ${sidecar.authToken}`;
  if (opts.origin) headers.origin = opts.origin;
  const res = await fetch(`${base()}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return {
    status: res.status,
    text,
    json: () => JSON.parse(text) as never,
  };
}

async function status(): Promise<Record<string, any>> {
  return (await call("GET", "/status")).json<Record<string, any>>();
}

async function waitFor(
  fn: () => boolean | Promise<boolean>,
  label: string,
  timeoutMs = 60_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

const readLog = (name: string): string => {
  try {
    return readFileSync(join(fakeDir, name), "utf8");
  } catch {
    return "";
  }
};

test("initial status: disconnected, fake CLIs detected, unknown routes 404", async () => {
  const s = await status();
  expect(s.sidecar).toBe("ok");
  expect(s.auth.connected).toBe(false);
  expect(s.clis.claude?.path).toBe(join(fakeDir, "claude"));
  expect(s.clis.claude?.version).toBe("9.9.9");
  expect(s.clis.codex?.version).toBe("9.9.9");
  expect(s.settings.apiBase).toBe("https://www.theninja-rpg.com");

  const notFound = await call("GET", "/nope");
  expect(notFound.status).toBe(404);
  const options = await fetch(`${base()}/status`, { method: "OPTIONS" });
  expect(options.status).toBe(200);
});

test("settings save persists locally without a token (no server sync)", async () => {
  const fakeBase = `http://127.0.0.1:${fakePort}`;
  const res = await call("POST", "/setup/save", {
    apiBase: fakeBase,
    repoPath: repoDir,
  });
  expect(res.status).toBe(200);
  const settings = res.json<Record<string, unknown>>();
  expect(settings.apiBase).toBe(fakeBase);
  expect(settings.repoPath).toBe(repoDir);
  expect(recorded.updateProfile).toHaveLength(0); // no token yet

  const s = await status();
  expect(s.settings.apiBase).toBe(fakeBase);
  // The GitHub login is server-verified now; the client cannot set it.
  expect(s.auth.githubLogin).toBeNull();
});

test("sign-in generates a PKCE connect URL for the fake server", async () => {
  const res = await call("POST", "/auth/signin");
  expect(res.status).toBe(200);
  const { connectUrl, port } = res.json<{ connectUrl: string; port: number }>();
  expect(port).toBe(sidecar.port);

  const url = new URL(connectUrl);
  expect(url.origin).toBe(`http://127.0.0.1:${fakePort}`);
  expect(url.pathname).toBe("/dev-connect");
  expect(url.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
  expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("loopback_port")).toBe(String(sidecar.port));
});

test("browser visit lands on the fake /dev-connect page", async () => {
  const s = await status();
  const connectUrl = (await call("POST", "/auth/signin")).json<{ connectUrl: string }>()
    .connectUrl;
  const res = await fetch(connectUrl);
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("fake sign-in page");
  expect(recorded.connect?.state).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
  expect(recorded.connect?.loopbackPort).toBe(String(sidecar.port));
  expect(s.auth.connected).toBe(false);
});

test("callback with a wrong state is rejected and the flow survives", async () => {
  const res = await call("GET", "/callback?state=definitely-wrong&code=code-abc");
  expect(res.status).toBe(400);
  expect(res.text).toContain("state mismatch");
  expect(recorded.exchanges).toHaveLength(0);
});

test("callback with the right state exchanges the code and stores the token", async () => {
  const state = recorded.connect?.state;
  expect(state).toBeDefined();
  const res = await call("GET", `/callback?state=${state}&code=code-abc`);
  expect(res.status).toBe(200);
  expect(res.text).toContain("Connected");

  expect(recorded.exchanges).toHaveLength(1);
  expect(recorded.exchanges[0]?.code).toBe("code-abc");
  // The fake server already verified S256(verifier) === challenge; a mismatch
  // would have produced a 401 above.
  expect(recorded.exchanges[0]?.auth).toBeUndefined(); // public procedure
});

test("status shows the stored token, fresh and owner-only on disk", async () => {
  const s = await status();
  expect(s.auth.connected).toBe(true);
  expect(s.auth.tokenExpired).toBe(false);
  expect(s.auth.tokenExpiresAt).toBeGreaterThan(Date.now());
  expect(s.auth.tokenExpiresAt).toBeLessThanOrEqual(
    Date.now() + 7 * 24 * 60 * 60 * 1000 + 1000,
  );

  const mode = statSync(tokenPath()).mode & 0o777;
  expect(mode).toBe(0o600);
});

test("claim rejects bad agents and reports an empty queue", async () => {
  const bad = await call("POST", "/jobs/claim", { agent: "GPT" });
  expect(bad.status).toBe(400);

  nextClaim = null;
  const empty = await call("POST", "/jobs/claim", { agent: "CLAUDE" });
  expect(empty.status).toBe(200);
  expect(empty.json<{ claimed: boolean; message?: string }>().claimed).toBe(false);
  expect(recorded.claims).toHaveLength(1);
  expect(recorded.claims[0]?.agent).toBe("CLAUDE");
  expect(recorded.claims[0]?.auth).toBe(`Bearer ${DEVICE_TOKEN}`);
  expect(recorded.authViolations).toHaveLength(0);
});

test("daily token cap blocks claiming locally", async () => {
  recordUsage("CLAUDE", 1000, new Date());
  await call("POST", "/setup/save", { claudeDailyTokenCap: 500 });

  const blocked = await call("POST", "/jobs/claim", { agent: "CLAUDE" });
  const body = blocked.json<{ claimed: boolean; message?: string }>();
  expect(body.claimed).toBe(false);
  expect(body.message).toMatch(/cap reached \(1000\/500\)/);
  expect(recorded.claims).toHaveLength(1); // never reached the server

  await call("POST", "/setup/save", { claudeDailyTokenCap: 0 }); // back to unlimited
});

test("end-to-end ISSUE_TRIAGE: fake agent runs, triage comment posted, reward paid", async () => {
  nextClaim = triageJob;
  const claim = await call("POST", "/jobs/claim", { agent: "CLAUDE" });
  expect(claim.json<{ claimed: boolean }>().claimed).toBe(true);

  await waitFor(
    async () =>
      (await status()).run.phase === "completed" ||
      (await status()).run.phase === "failed",
    "triage job to finish",
  );
  const s = await status();
  expect(s.run.phase).toBe("completed");
  expect(s.run.log.join("\n")).toContain("Triage comment posted");

  expect(recorded.completes).toHaveLength(1);
  expect(recorded.completes[0]).toEqual({
    jobId: 42,
    tokensIn: 1500,
    tokensOut: 222,
    resultUrl: "https://github.com/studie-tech/TheNinjaRPG/issues/7",
  });

  const ghLog = readLog("gh-calls.log");
  expect(ghLog).toContain("issue comment 7 --repo studie-tech/TheNinjaRPG --body-file");
  const claudeLog = readLog("claude-calls.log");
  expect(claudeLog).toContain("-p");
  expect(claudeLog).toContain("Triage this issue");
  expect(claudeLog).toContain("Ninja stuck in tree");

  // 1000 seeded + (111 input + 389 cache-create + 1000 cache-read + 222 output).
  expect(tokensUsedToday("CLAUDE")).toBe(2722);

  const history = (await call("GET", "/jobs/history")).json<{
    history: Array<Record<string, unknown>>;
  }>().history;
  expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({
    jobId: 42,
    jobType: "ISSUE_TRIAGE",
    agent: "CLAUDE",
    status: "COMPLETED",
    verified: true,
    reward: REWARD,
    tokensIn: 1500,
    tokensOut: 222,
    resultUrl: "https://github.com/studie-tech/TheNinjaRPG/issues/7",
  });
});

test("end-to-end PR_REVIEW: PR read via gh, review posted, second job recorded", async () => {
  nextClaim = prJob;
  const claim = await call("POST", "/jobs/claim", { agent: "CLAUDE" });
  expect(claim.json<{ claimed: boolean }>().claimed).toBe(true);

  await waitFor(
    async () =>
      (await status()).run.phase === "completed" ||
      (await status()).run.phase === "failed",
    "review job to finish",
  );
  const s = await status();
  expect(s.run.phase).toBe("completed");
  expect(s.run.log.join("\n")).toContain("Review posted");

  expect(recorded.completes).toHaveLength(2);
  expect(recorded.completes[1]).toEqual({
    jobId: 43,
    tokensIn: 1500,
    tokensOut: 222,
    resultUrl: "https://github.com/studie-tech/TheNinjaRPG/pull/5",
  });

  const ghLog = readLog("gh-calls.log");
  expect(ghLog).toContain("pr view 5 --repo studie-tech/TheNinjaRPG --json");
  expect(ghLog).toContain("pr review 5 --repo studie-tech/TheNinjaRPG --comment");

  const history = (await call("GET", "/jobs/history")).json<{
    history: Array<Record<string, unknown>>;
  }>().history;
  expect(history).toHaveLength(2);
  expect(history[0]).toMatchObject({
    jobId: 43,
    jobType: "PR_REVIEW",
    status: "COMPLETED",
  });
});

test("abort stops a running job and reports the failure to the server", async () => {
  writeFileSync(join(fakeDir, "hang"), "", "utf8");
  nextClaim = triageJob;
  const claim = await call("POST", "/jobs/claim", { agent: "CLAUDE" });
  expect(claim.json<{ claimed: boolean }>().claimed).toBe(true);

  await waitFor(
    async () => (await status()).run.phase === "agent",
    "job to reach the agent phase",
  );
  const abort = await call("POST", "/jobs/abort");
  expect(abort.json<{ aborted: boolean }>().aborted).toBe(true);

  await waitFor(
    async () => (await status()).run.phase === "failed",
    "job to be marked failed",
  );
  const s = await status();
  expect(s.run.error).toBe("Aborted by user");

  expect(recorded.fails).toHaveLength(1);
  expect(recorded.fails[0]).toMatchObject({
    jobId: 42,
    error: "Aborted by user",
  });
  rmSync(join(fakeDir, "hang"), { force: true });

  const idle = await call("POST", "/jobs/abort");
  expect(idle.json<{ aborted: boolean }>().aborted).toBe(false);
});

test("sign-out revokes the token on the server and clears local state", async () => {
  const res = await call("POST", "/auth/signout");
  expect(res.json<{ revoked: boolean }>().revoked).toBe(true);
  expect(recorded.revokes).toHaveLength(1);
  expect(recorded.revokes[0]).toBe(`Bearer ${DEVICE_TOKEN}`);

  const s = await status();
  expect(s.auth.connected).toBe(false);
  expect(s.auth.tokenExpiresAt).toBeNull();
  expect(existsSync(tokenPath())).toBe(false);

  const claim = await call("POST", "/jobs/claim", { agent: "CLAUDE" });
  expect(claim.json<{ claimed: boolean; message?: string }>().message).toBe(
    "Sign in first",
  );
});

test("rejects requests without the per-launch auth token", async () => {
  // Binding to loopback is not access control: any page the user visits can
  // reach this port, so every endpoint requires the shell-issued bearer.
  const res = await call("GET", "/status", undefined, { auth: false });
  expect(res.status).toBe(401);

  const save = await call(
    "POST",
    "/setup/save",
    { apiBase: "https://evil.tld" },
    { auth: false },
  );
  expect(save.status).toBe(401);
  // ...and the malicious apiBase must not have been persisted.
  expect((await status()).settings.apiBase).not.toContain("evil.tld");
});

test("rejects requests carrying a foreign Origin even with the token", async () => {
  const res = await call("GET", "/status", undefined, { origin: "https://evil.tld" });
  expect(res.status).toBe(403);
  expect(res.text).not.toContain("repoPath");
});

test("never sets a wildcard CORS origin", async () => {
  const res = await fetch(`${base()}/status`, {
    headers: { authorization: `Bearer ${sidecar.authToken}` },
  });
  expect(res.headers.get("access-control-allow-origin")).not.toBe("*");
});

test("refuses an apiBase that is not a known game host", async () => {
  const before = (await status()).settings.apiBase;
  const res = await call("POST", "/setup/save", { apiBase: "https://evil.tld" });
  expect(res.status).toBe(200);
  // The patch is ignored rather than accepted: apiBase decides where the
  // device token is sent as a bearer.
  expect(res.json<Record<string, unknown>>().apiBase).toBe(before);
});

test("a PR review job is given the pull request diff, not just its metadata", () => {
  // The review worktree is checked out at origin/main, so without an explicit
  // diff the agent would be reviewing an unchanged tree.
  const ghLog = readLog("gh-calls.log");
  expect(ghLog).toContain("pr diff 5");
  const claudeLog = readLog("claude-calls.log");
  expect(claudeLog).toContain("untrusted_pull_request_diff");
  expect(claudeLog).toContain("const a = 2;");
});
