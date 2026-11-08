import { AsyncLocalStorage } from "node:async_hooks";
import * as Sentry from "@sentry/nextjs";
import { TRPCError } from "@trpc/server";
import { checkBotId } from "botid/server";
import { env } from "@/env/server.mjs";
import {
  BOTID_BLOCKED_MESSAGE,
  BOTID_CHECK_LEVEL,
  BOTID_RELOAD_REQUIRED_MESSAGE,
  type BotIdCheckLevel,
  botIdCheckLevelForPaths,
  isBotIdProtectedProcedure,
} from "@/libs/botid";

/**
 * Vercel BotID for a short list of high-value tRPC mutations
 * (`BOTID_PROTECTED_PROCEDURES` in `@/libs/botid`).
 *
 * The /api/trpc route opens a guard for every POST it serves on Vercel that names one of
 * those procedures; the tRPC middleware awaits it before a protected mutation runs. A guard calls `checkBotId()` at most once,
 * however many mutations the batch carries, and is only reachable through the route, so
 * server-side callers (`createCaller` from MCP, the AI test-user broker, the content
 * review desk, tests and scripts) never see BotID at all.
 *
 * A classification is never allowed to break gameplay on its own: an error or timeout
 * from BotID lets the request through, and blocking is limited to production by default
 * (see `isBotIdEnforced`).
 *
 * A request without a challenge header is not sent to BotID at all, which would only
 * answer "bot". Current pages always attach one, so it comes from a tab still running a
 * bundle from before its procedure was protected (players keep tabs open for days) or
 * from a script. Both are rejected the same way, before any side effect, with
 * `BOTID_RELOAD_REQUIRED_MESSAGE`: a reload loads the current bundle, and a script gains
 * nothing from the different wording.
 */

/**
 * Upper bound on the BotID round trip. In production `checkBotId()` POSTs to
 * api.vercel.com/bot-protection/v1/is-bot, and every mutation waits for it, so a slow
 * answer is treated as no answer. The check starts when the route receives the request and
 * overlaps `auth()`, so players only wait for whatever part of it outlasts auth.
 */
export const BOTID_TIMEOUT_MS = 400;

/**
 * Deep Analysis runs an ML model on top of the Basic check and is only used for account
 * creation, a one-off action, so it gets a longer budget before failing open.
 */
export const BOTID_DEEP_ANALYSIS_TIMEOUT_MS = 1500;

/** The fail-open budget for a check level. */
export const botIdTimeoutFor = (checkLevel: BotIdCheckLevel) =>
  checkLevel === "deepAnalysis" ? BOTID_DEEP_ANALYSIS_TIMEOUT_MS : BOTID_TIMEOUT_MS;

/** Share of production requests that log a `[botid-timing]` line; previews log every one. */
export const BOTID_TIMING_SAMPLE_RATE = 0.1;

export type BotIdVerdict =
  | {
      ok: true;
      isBot: boolean;
      isHuman: boolean;
      isVerifiedBot: boolean;
      verifiedBotName: string | undefined;
      bypassed: boolean;
    }
  | { ok: false; reason: string };

export type BotIdGuard = {
  /** Procedure paths named by the request URL, for the record of a detection. */
  paths: string[];
  /** Whether the request carries the BotID client's challenge header. */
  hasChallenge: boolean;
  /** The request's User-Agent, for the record of a detection. */
  userAgent: string | null;
  /** The level this request is checked at; it must match what the client attached. */
  checkLevel: BotIdCheckLevel;
  /** The memoized verdict for this HTTP request. */
  verify: () => Promise<BotIdVerdict>;
  /** Whether this request's outcome has been recorded, so a batch records it once. */
  reported: boolean;
  /** Whether a Sentry event was captured that the route must flush. */
  needsFlush: boolean;
  /** Round trip of the BotID check in ms, once it has settled. */
  checkMs: number | undefined;
  /** Whether this request's `[botid-timing]` line has been considered, so a batch logs once. */
  timingLogged: boolean;
};

const storage = new AsyncLocalStorage<BotIdGuard>();

/** Ask BotID about the current request; resolves to a failed verdict instead of throwing. */
export const runBotIdCheck = async (
  timeoutMs: number = BOTID_TIMEOUT_MS,
  checkLevel: BotIdCheckLevel = BOTID_CHECK_LEVEL,
): Promise<BotIdVerdict> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`checkBotId timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
    });
    const result = await Promise.race([
      checkBotId({ advancedOptions: { checkLevel } }),
      timeout,
    ]);
    return {
      ok: true,
      isBot: result.isBot,
      isHuman: result.isHuman,
      isVerifiedBot: result.isVerifiedBot,
      verifiedBotName: "verifiedBotName" in result ? result.verifiedBotName : undefined,
      bypassed: result.bypassed,
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
};

/** A per-request guard whose check runs at most once. */
export const createBotIdGuard = (
  paths: string[],
  {
    check,
    hasChallenge = true,
    userAgent = null,
  }: {
    check?: () => Promise<BotIdVerdict>;
    hasChallenge?: boolean;
    userAgent?: string | null;
  } = {},
): BotIdGuard => {
  const checkLevel = botIdCheckLevelForPaths(paths);
  const runCheck =
    check ?? (() => runBotIdCheck(botIdTimeoutFor(checkLevel), checkLevel));
  let pending: Promise<BotIdVerdict> | undefined;
  const guard: BotIdGuard = {
    paths,
    hasChallenge,
    userAgent,
    checkLevel,
    verify: () => {
      pending ??= (async () => {
        const startedAt = performance.now();
        try {
          return await runCheck();
        } finally {
          guard.checkMs = Math.round(performance.now() - startedAt);
        }
      })();
      return pending;
    },
    reported: false,
    needsFlush: false,
    checkMs: undefined,
    timingLogged: false,
  };
  return guard;
};

/** Every preview request logs its timing; production samples `BOTID_TIMING_SAMPLE_RATE`. */
export const shouldLogBotIdTiming = (
  vercelEnv: string | undefined = process.env.VERCEL_ENV,
  random: () => number = Math.random,
) => vercelEnv !== "production" || random() < BOTID_TIMING_SAMPLE_RATE;

/** Run `fn` with `guard` visible to the tRPC middleware; without one, `fn` runs unguarded. */
export const withBotIdGuard = <T>(guard: BotIdGuard | undefined, fn: () => T): T =>
  guard ? storage.run(guard, fn) : fn();

/**
 * Whether a request to /api/trpc gets a guard: mutations (always POST from httpBatchLink)
 * on a Vercel deployment whose batch names a protected procedure. Elsewhere BotID has
 * nothing to classify with: `next dev` answers "human" for every request, and a
 * production build outside Vercel has no OIDC token.
 */
export const shouldGuardTrpcRequest = (
  method: string,
  paths: string[],
  isOnVercel: boolean = process.env.VERCEL === "1",
) => method === "POST" && isOnVercel && paths.some(isBotIdProtectedProcedure);

/** `/api/trpc/a.b,c.d?batch=1` → `["a.b", "c.d"]`. An undecodable path stays whole. */
export const trpcPathsFromUrl = (url: string, endpoint = "/api/trpc"): string[] => {
  const pathname = new URL(url, "http://localhost").pathname;
  const joined = pathname.replace(new RegExp(`^${endpoint}/?`), "");
  try {
    return decodeURIComponent(joined).split(",").filter(Boolean);
  } catch {
    return [joined];
  }
};

/**
 * Whether a bot verdict blocks the mutation. `BOTID_ENFORCE=false` is the kill switch
 * (record only); `true` also enforces on preview deployments; unset enforces on the
 * production deployment only, so headless reviewer and audit runs against previews are
 * recorded but never blocked.
 */
export const isBotIdEnforced = (
  {
    setting,
    vercelEnv,
  }: {
    setting: "true" | "false" | undefined;
    vercelEnv: string | undefined;
  } = { setting: env.BOTID_ENFORCE, vercelEnv: process.env.VERCEL_ENV },
) => setting === "true" || (setting !== "false" && vercelEnv === "production");

/**
 * Called by the tRPC middleware before every procedure. Protected mutations inside a
 * guarded request wait for the verdict and, when enforcement is on, are rejected with
 * FORBIDDEN when BotID classifies the request as a bot, or with PRECONDITION_FAILED when
 * the request carries no challenge at all.
 * Anything else passes.
 */
export const enforceBotId = async (props: {
  type: string;
  path: string;
  userId: string | null | undefined;
}) => {
  if (props.type !== "mutation" || !isBotIdProtectedProcedure(props.path)) return;
  const guard = storage.getStore();
  if (!guard) return;
  const blocking = isBotIdEnforced();
  if (!guard.hasChallenge) {
    if (!guard.reported) {
      guard.reported = true;
      recordMissingChallenge(guard, { ...props, enforced: blocking });
    }
    if (blocking) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: BOTID_RELOAD_REQUIRED_MESSAGE,
      });
    }
    return;
  }
  const waitStartedAt = performance.now();
  const verdict = await guard.verify();
  if (!guard.timingLogged) {
    guard.timingLogged = true;
    if (shouldLogBotIdTiming()) {
      // checkMs is the BotID round trip; waitedMs is what the mutation actually waited.
      console.info(
        `[botid-timing] ${JSON.stringify({
          checkMs: guard.checkMs ?? null,
          waitedMs: Math.round(performance.now() - waitStartedAt),
          timeoutMs: botIdTimeoutFor(guard.checkLevel),
          checkLevel: guard.checkLevel,
          ok: verdict.ok,
          isBot: verdict.ok ? verdict.isBot : null,
          path: props.path,
          vercelEnv: process.env.VERCEL_ENV ?? null,
        })}`,
      );
    }
  }
  if (verdict.ok && !verdict.isBot) return;
  const enforced = verdict.ok && blocking;
  if (!guard.reported) {
    guard.reported = true;
    recordBotIdOutcome(guard, verdict, { ...props, enforced });
  }
  if (enforced) {
    throw new TRPCError({ code: "FORBIDDEN", message: BOTID_BLOCKED_MESSAGE });
  }
};

const recordBotIdOutcome = (
  guard: BotIdGuard,
  verdict: BotIdVerdict,
  details: { path: string; userId: string | null | undefined; enforced: boolean },
) => {
  const base = recordBase(guard, details);
  if (!verdict.ok) {
    // Logged only: a BotID outage would otherwise raise a Sentry event per mutation.
    console.warn(
      `[botid] ${JSON.stringify({ event: "check_failed", ...base, reason: verdict.reason })}`,
    );
    Sentry.addBreadcrumb({
      category: "botid",
      level: "warning",
      message: "BotID check failed; request allowed",
      data: { ...base, reason: verdict.reason },
    });
    return;
  }
  const action = details.enforced ? "blocked" : "observed";
  const record = {
    event: action,
    ...base,
    isBot: verdict.isBot,
    isHuman: verdict.isHuman,
    isVerifiedBot: verdict.isVerifiedBot,
    verifiedBotName: verdict.verifiedBotName ?? null,
    bypassed: verdict.bypassed,
  };
  console.warn(`[botid] ${JSON.stringify(record)}`);
  Sentry.addBreadcrumb({
    category: "botid",
    level: "warning",
    message: action,
    data: record,
  });
  Sentry.captureMessage(`BotID ${action} a tRPC mutation`, {
    level: "warning",
    fingerprint: ["botid", action],
    tags: { botid: action, botid_verified_bot: String(verdict.isVerifiedBot) },
    user: details.userId ? { id: details.userId } : undefined,
    extra: record,
  });
  guard.needsFlush = true;
};

const recordBase = (
  guard: BotIdGuard,
  details: { path: string; userId: string | null | undefined },
) => ({
  userId: details.userId ?? null,
  path: details.path,
  paths: guard.paths,
  checkLevel: guard.checkLevel,
  userAgent: guard.userAgent,
});

/**
 * Records a protected mutation that arrived without a challenge. It gets its own Sentry
 * issue, at info level, so stale tabs after a deploy stay apart from BotID's verdicts.
 */
const recordMissingChallenge = (
  guard: BotIdGuard,
  details: { path: string; userId: string | null | undefined; enforced: boolean },
) => {
  const record = {
    event: "missing_challenge",
    ...recordBase(guard, details),
    enforced: details.enforced,
  };
  console.warn(`[botid] ${JSON.stringify(record)}`);
  Sentry.addBreadcrumb({
    category: "botid",
    level: "info",
    message: "missing_challenge",
    data: record,
  });
  Sentry.captureMessage("BotID challenge missing on a tRPC mutation", {
    level: "info",
    fingerprint: ["botid", "missing_challenge"],
    tags: { botid: "missing_challenge", botid_enforced: String(details.enforced) },
    user: details.userId ? { id: details.userId } : undefined,
    extra: record,
  });
  guard.needsFlush = true;
};
