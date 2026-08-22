import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { platform } from "node:os";
import { type ClaimNextJobOutput, GameApi, TrpcError } from "./api";
import { todayUtc, tokensUsedToday } from "./budget";
import { detectAllClis } from "./clis";
import { buildConnectUrl, generatePkce, generateState, type PkcePair } from "./oauth";
import { canClaim, runJob, terminateActiveAgent } from "./runner";
import {
  appendHistory,
  clearToken,
  loadHistory,
  loadSettings,
  loadToken,
  saveSettings,
  saveToken,
} from "./state";
import type {
  Agent,
  CliInfo,
  HistoryEntry,
  RunPhase,
  RunState,
  SerializedJob,
  Settings,
  StatusResponse,
} from "./types";

export const SIDECAR_VERSION = "0.1.0";
export const DEFAULT_PORT = Number(process.env.TNR_DEV_CLIENT_PORT ?? 49200);

// Origins allowed to talk to the loopback API. The Tauri webview serves the UI
// from a custom scheme; nothing else has any business calling us.
const ALLOWED_ORIGINS = new Set([
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
  // vite dev server (bun run dev)
  "http://localhost:1420",
  "http://127.0.0.1:1420",
]);

/**
 * Every endpoint except /callback requires this bearer token, which is minted
 * per launch and handed to the UI through the Tauri shell.
 *
 * Binding to 127.0.0.1 is not an access control: any web page the user visits
 * can issue cross-origin requests to loopback. Without this a malicious site
 * could repoint apiBase and walk off with the device token.
 */
const resolveAuthToken = (): string =>
  process.env.TNR_DEV_CLIENT_AUTH_TOKEN || randomBytes(32).toString("hex");

const isLoopbackHost = (host: string | null): boolean => {
  if (!host) return false;
  const hostname = host.split(":")[0]?.toLowerCase() ?? "";
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
};

interface PendingFlow {
  state: string;
  verifier: string;
  startedAt: number;
}

export interface SidecarContext {
  api: GameApi;
  port: number;
  authToken: string;
  pendingFlow: PendingFlow | null;
  run: RunState;
  abortController: AbortController | null;
  autoRunTimer: ReturnType<typeof setTimeout> | null;
  log: (line: string) => void;
}

function openInBrowser(url: string): void {
  if (process.env.TNR_DEV_CLIENT_NO_BROWSER) return;
  const command =
    platform() === "darwin" ? "open" : platform() === "win32" ? "cmd" : "xdg-open";
  const args = platform() === "win32" ? ["/c", "start", "", url] : [url];
  spawn(command, args, { stdio: "ignore", detached: true }).unref();
}

function publicRun(run: RunState): RunState {
  // Cap the in-memory log tail that clients can pull.
  return { ...run, log: run.log.slice(-300) };
}

function buildStatus(ctx: SidecarContext): StatusResponse {
  const settings = loadSettings();
  const token = loadToken();
  const now = Date.now();
  const budgetFor = (agent: Agent) => {
    const cap =
      agent === "CLAUDE" ? settings.claudeDailyTokenCap : settings.codexDailyTokenCap;
    const used = tokensUsedToday(agent);
    return {
      used,
      cap,
      remaining: cap > 0 ? Math.max(0, cap - used) : 0,
    };
  };
  return {
    sidecar: "ok",
    version: SIDECAR_VERSION,
    port: ctx.port,
    auth: {
      connected: Boolean(token?.deviceToken),
      // Mirrors what the server last told us; it is only ever set by the
      // verified challenge flow on the website, never locally.
      githubLogin: token?.githubLogin ?? null,
      tokenExpiresAt: token?.expiresAt ?? null,
      tokenExpired: token ? token.expiresAt < now : false,
    },
    settings,
    clis: {
      claude: null,
      codex: null,
    },
    budget: {
      today: todayUtc(),
      byAgent: {
        CLAUDE: budgetFor("CLAUDE"),
        CODEX: budgetFor("CODEX"),
      },
    },
    run: publicRun(ctx.run),
  };
}

// ── Handlers ─────────────────────────────────────────────────────────────────

// /status is polled by the UI; avoid re-spawning `which`/`--version` on every
// poll by caching detection results for a short window.
const CLI_CACHE_TTL_MS = 30_000;
let cliCache: {
  at: number;
  value: { claude: CliInfo | null; codex: CliInfo | null };
} | null = null;

async function cachedClis(): Promise<{
  claude: CliInfo | null;
  codex: CliInfo | null;
}> {
  if (cliCache && Date.now() - cliCache.at < CLI_CACHE_TTL_MS) return cliCache.value;
  cliCache = { at: Date.now(), value: await detectAllClis() };
  return cliCache.value;
}

async function handleStatus(ctx: SidecarContext): Promise<StatusResponse> {
  const status = buildStatus(ctx);
  status.clis = await cachedClis();
  return status;
}

function handleSignIn(ctx: SidecarContext): { connectUrl: string; port: number } {
  const settings = loadSettings();
  const pkce: PkcePair = generatePkce();
  const state = generateState();
  const connectUrl = buildConnectUrl({
    apiBase: settings.apiBase,
    state,
    codeChallenge: pkce.challenge,
    loopbackPort: ctx.port,
  });
  ctx.pendingFlow = { state, verifier: pkce.verifier, startedAt: Date.now() };
  ctx.log("Connect flow started, opening browser");
  openInBrowser(connectUrl);
  return { connectUrl, port: ctx.port };
}

async function handleCallback(
  ctx: SidecarContext,
  url: URL,
): Promise<{ status: number; body: string }> {
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const flow = ctx.pendingFlow;

  if (!flow || flow.state !== state) {
    return {
      status: 400,
      body: "Connect failed: state mismatch. Start sign-in again.",
    };
  }
  ctx.pendingFlow = null;

  try {
    const result = await ctx.api.exchangeConnectCode({
      code,
      codeVerifier: flow.verifier,
    });
    if (!result.success || !result.deviceToken) {
      return {
        status: 401,
        body: `Connect failed: ${result.message ?? "unknown error"}`,
      };
    }
    saveToken({
      deviceToken: result.deviceToken,
      expiresAt: result.expiresAt ?? Date.now() + 7 * 24 * 60 * 60 * 1000,
    });
    ctx.log("Connected to game server");
    return {
      status: 200,
      body: "<!doctype html><html><body style='font-family:system-ui;text-align:center;padding-top:15vh'><h2>Connected</h2><p>You can close this window and return to the TNR Dev Client.</p></body></html>",
    };
  } catch (error) {
    const message = error instanceof TrpcError ? error.message : "Connect failed";
    return { status: 500, body: `<pre>${message}</pre>` };
  }
}

async function handleSignOut(ctx: SidecarContext): Promise<{ revoked: boolean }> {
  const token = loadToken();
  let revoked = false;
  if (token) {
    try {
      await ctx.api.revokeDeviceToken();
      revoked = true;
    } catch {
      revoked = false;
    }
  }
  clearToken();
  ctx.log("Signed out");
  return { revoked };
}

async function handleSaveSettings(
  ctx: SidecarContext,
  body: Partial<Settings>,
): Promise<Settings> {
  const settings = saveSettings(body);
  if (loadToken()?.deviceToken) {
    // Best-effort server sync; a stale token must not block local settings.
    try {
      await ctx.api.updateProfile({
        claudeDailyTokenCap: body.claudeDailyTokenCap,
        codexDailyTokenCap: body.codexDailyTokenCap,
        autoRun: body.autoRun,
      });
    } catch {
      // ignore
    }
  }
  return settings;
}

async function handleClaim(
  ctx: SidecarContext,
  agent: Agent,
): Promise<{ claimed: boolean; message?: string }> {
  if (!loadToken()?.deviceToken) return { claimed: false, message: "Sign in first" };

  const preflight = canClaim(agent, ctx.run);
  if (!preflight.ok) return { claimed: false, message: preflight.reason };

  const clis = await detectAllClis();
  const cli: CliInfo | null = agent === "CLAUDE" ? clis.claude : clis.codex;
  if (!cli)
    return {
      claimed: false,
      message: `${agent.toLowerCase()} CLI not found. Install it and restart the app.`,
    };

  let result: ClaimNextJobOutput;
  try {
    result = await ctx.api.claimNextJob(agent);
  } catch (error) {
    const message =
      error instanceof TrpcError ? error.message : "Could not reach the game server";
    return { claimed: false, message };
  }
  if (!result.claimed || !result.job)
    return { claimed: false, message: result.message ?? "No jobs available" };

  const job: SerializedJob = result.job;
  ctx.run = {
    job,
    agent,
    phase: "preparing",
    log: [`Claimed job ${job.id}: ${job.jobType} ${job.refUrl}`],
    startedAt: Date.now(),
    finishedAt: null,
    error: null,
  };
  ctx.abortController = new AbortController();
  ctx.log(`Claimed job ${job.id}`);

  // Run in the background; progress is observable via /status.
  void (async () => {
    const setPhase = (phase: RunPhase) => {
      ctx.run = { ...ctx.run, phase };
    };
    setPhase("agent");
    const result = await runJob({
      api: ctx.api,
      agent,
      job,
      cliPath: cli.path,
      log: (line) => {
        ctx.run = { ...ctx.run, log: [...ctx.run.log, line] };
        ctx.log(line);
      },
      isAborted: () => ctx.abortController?.signal.aborted ?? false,
      abort: () => ctx.abortController?.abort(),
    });

    const entry: HistoryEntry = {
      jobId: job.id,
      jobType: job.jobType,
      refUrl: job.refUrl,
      refNumber: job.refNumber,
      agent,
      status: result.ok ? "COMPLETED" : "FAILED",
      verified: result.verified,
      reward: result.reward,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      resultUrl: result.resultUrl,
      finishedAt: Date.now(),
      error: result.error ?? undefined,
    };
    appendHistory(entry);
    ctx.run = {
      ...ctx.run,
      phase: result.ok ? "completed" : "failed",
      finishedAt: Date.now(),
      error: result.error,
    };

    // autoRun: keep the queue warm. The timer handle is retained so Stop (and
    // shutdown) can cancel a queued re-claim; without that, aborting in the gap
    // between runs silently starts another job.
    const settings = loadSettings();
    const wasAborted = ctx.abortController?.signal.aborted ?? false;
    // Drop the controller so aborts after a finished run report "not running"
    // instead of aborting a stale, already-settled signal.
    ctx.abortController = null;
    if (settings.autoRun && result.ok && !wasAborted) {
      ctx.autoRunTimer = setTimeout(() => {
        ctx.autoRunTimer = null;
        void handleClaim(ctx, agent);
      }, 5000);
    }
  })();

  return { claimed: true };
}

function handleAbort(ctx: SidecarContext): { aborted: boolean } {
  let aborted = false;
  if (ctx.autoRunTimer) {
    clearTimeout(ctx.autoRunTimer);
    ctx.autoRunTimer = null;
    aborted = true;
  }
  if (ctx.abortController) {
    ctx.abortController.abort();
    aborted = true;
  }
  return { aborted };
}

// ── HTTP server ──────────────────────────────────────────────────────────────

/**
 * CORS headers for an allowlisted origin only. A wildcard here would let any
 * page the user visits read these responses.
 */
function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = { vary: "Origin" };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers["access-control-allow-origin"] = origin;
    headers["access-control-allow-headers"] = "content-type, authorization";
    headers["access-control-allow-methods"] = "GET, POST, OPTIONS";
    headers["access-control-max-age"] = "600";
  }
  return headers;
}

function json(body: unknown, status = 200, origin: string | null = null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders(origin) },
  });
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

async function readJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

export function startServer(port: number, log: (line: string) => void): Server {
  const ctx: SidecarContext = {
    api: new GameApi({
      getApiBase: () => loadSettings().apiBase,
      getDeviceToken: () => loadToken()?.deviceToken ?? null,
    }),
    port,
    authToken: resolveAuthToken(),
    autoRunTimer: null,
    pendingFlow: null,
    run: {
      job: null,
      agent: null,
      phase: "idle",
      log: [],
      startedAt: null,
      finishedAt: null,
      error: null,
    },
    abortController: null,
    log,
  };

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch: async (req) => {
      const url = new URL(req.url);
      const path = url.pathname;
      const origin = req.headers.get("origin");

      // Reject anything not addressed to loopback: a DNS-rebinding host header
      // is the standard way around a 127.0.0.1 bind.
      if (!isLoopbackHost(req.headers.get("host"))) {
        return json({ error: "Forbidden" }, 403, origin);
      }
      // A non-allowlisted Origin means a web page is calling us, never the UI.
      if (origin && !ALLOWED_ORIGINS.has(origin)) {
        return json({ error: "Forbidden" }, 403, null);
      }

      if (req.method === "OPTIONS") return json({ ok: true }, 200, origin);

      // /callback is the browser landing after the connect flow, so it cannot
      // carry the header. It is protected by the PKCE state match instead.
      const isPublic = req.method === "GET" && path === "/callback";
      if (!isPublic) {
        const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
        if (bearer !== ctx.authToken) {
          return json({ error: "Unauthorized" }, 401, origin);
        }
      }

      try {
        if (req.method === "GET" && path === "/status") {
          return json(await handleStatus(ctx), 200, origin);
        }
        if (isPublic) {
          const result = await handleCallback(ctx, url);
          return html(result.body, result.status);
        }
        if (req.method === "GET" && path === "/jobs/history") {
          return json({ history: loadHistory() }, 200, origin);
        }
        if (req.method === "POST" && path === "/auth/signin") {
          return json(handleSignIn(ctx), 200, origin);
        }
        if (req.method === "POST" && path === "/auth/signout") {
          return json(await handleSignOut(ctx), 200, origin);
        }
        if (req.method === "POST" && path === "/setup/detect-clis") {
          return json(await detectAllClis(), 200, origin);
        }
        if (req.method === "POST" && path === "/setup/save") {
          const body = await readJson<Partial<Settings>>(req);
          if (!body) return json({ error: "Invalid body" }, 400, origin);
          return json(await handleSaveSettings(ctx, body), 200, origin);
        }
        if (req.method === "POST" && path === "/jobs/claim") {
          const body = await readJson<{ agent?: string }>(req);
          const agent = body?.agent;
          if (agent !== "CLAUDE" && agent !== "CODEX")
            return json({ error: "agent must be CLAUDE or CODEX" }, 400, origin);
          return json(await handleClaim(ctx, agent), 200, origin);
        }
        if (req.method === "POST" && path === "/jobs/abort") {
          return json(handleAbort(ctx), 200, origin);
        }
        return json({ error: "Not found" }, 404, origin);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`Handler error: ${message}`);
        // Log the detail locally; do not hand internals back over HTTP.
        return json({ error: "Internal error" }, 500, origin);
      }
    },
  });

  // port 0 lets the OS pick a free port; report the one that was actually
  // bound so the connect URL always points at the live server.
  ctx.port = server.port ?? port;

  return {
    port: ctx.port,
    authToken: ctx.authToken,
    stop: async () => {
      if (ctx.autoRunTimer) clearTimeout(ctx.autoRunTimer);
      ctx.autoRunTimer = null;
      ctx.abortController?.abort();
      // Aborting only signals the run; wait for the agent process itself to be
      // gone before the sidecar exits, or it outlives us as an orphan.
      await terminateActiveAgent();
      server.stop(true);
    },
  };
}

export interface Server {
  port: number;
  authToken: string;
  stop: () => Promise<void>;
}
