import { auth } from "@clerk/nextjs/server";
import * as Sentry from "@sentry/nextjs";
import { initTRPC, TRPCError } from "@trpc/server";
import type { TRPC_ERROR_CODE_KEY } from "@trpc/server/rpc";
import { middlewareMarker } from "@trpc/server/unstable-core-do-not-import";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import type { ReadonlyHeaders } from "next/dist/server/web/spec-extension/adapters/headers";
import type { ReadonlyRequestCookies } from "next/dist/server/web/spec-extension/adapters/request-cookies";
import superjson from "superjson";
import { ZodError } from "zod";
import { LEMU_EXPERIMENT, normalizeLemuVariant } from "@/libs/lemuExperiment";
import type { McpMeta } from "@/libs/mcp";
import {
  parseQueryMetricsHeader,
  QUERY_METRICS_HEADER,
  type QueryAttribution,
} from "@/libs/queryTelemetry";
import {
  ISOLATED_PYRAMID_MESSAGE,
  isPyramidRestrictedProcedure,
} from "@/libs/questRun";
import { hasSensitiveTrpcInput } from "@/libs/trpcLogging";
import { trpcSessionUserId } from "@/libs/trpcSession";
import {
  parseWallpaperVariant,
  WALLPAPER_EXPERIMENT,
} from "@/libs/wallpaperExperiment";
import { fetchIsolatedPyramid } from "@/queries/quests";
import { drizzleDB } from "@/server/db";
import { enforceBotId } from "@/server/utils/botid";
import { clientErrorMessage } from "@/server/utils/mysqlErrors";
import { measureTrpcCall } from "@/server/utils/trpcMetrics";
import { getClientIp } from "@/utils/network";

/**
 * This is the actual context you will use in your router. It will be used to process every request
 * that goes through your tRPC endpoint. This is for the app router.
 * @see https://trpc.io/docs/context
 */
export const createAppTRPCContext = async (options: {
  readHeaders: ReadonlyHeaders;
  readCookies: ReadonlyRequestCookies;
  procedureTypes: ReadonlyMap<string, string>;
}) => {
  const session = await auth();
  const userId = trpcSessionUserId(session.userId, options.readHeaders);
  // Get IP
  const { readHeaders } = options;
  const userIp = getClientIp(readHeaders);
  // Get agent
  const userAgent = readHeaders.get("user-agent") ?? undefined;
  // Optional for server-side callers and older clients, which have no browser attribution.
  const telemetry: { queryMetrics?: ReadonlyMap<string, QueryAttribution> } = {
    queryMetrics: parseQueryMetricsHeader(
      readHeaders.get(QUERY_METRICS_HEADER),
      options.procedureTypes,
    ),
  };
  // AB testing cookies
  const abLemuReplacementVariant = normalizeLemuVariant(
    options.readCookies.get(LEMU_EXPERIMENT)?.value,
  );
  return {
    ...telemetry,
    drizzle: drizzleDB,
    userIp,
    userId,
    userAgent,
    abLemuReplacementVariant,
    wallpaperVariant: parseWallpaperVariant(
      options.readCookies.get(WALLPAPER_EXPERIMENT)?.value,
    ),
  };
};

/**
 * Context for /api/trpc/cdn, whose responses the CDN shares between visitors: nothing
 * per-request survives but the IP the rate limiter keys on.
 */
export const createCdnTRPCContext = (readHeaders: ReadonlyHeaders) => ({
  drizzle: drizzleDB,
  userIp: getClientIp(readHeaders),
  userId: null,
  userAgent: undefined,
  abLemuReplacementVariant: undefined,
  wallpaperVariant: undefined,
});

const t = initTRPC
  .context<typeof createAppTRPCContext>()
  .meta<ProcedureMeta>()
  .create({
    transformer: superjson,
    errorFormatter({ shape, error }) {
      return {
        ...shape,
        message: clientErrorMessage(error),
        data: {
          ...shape.data,
          zodError: error.cause instanceof ZodError ? error.cause.issues : null,
        },
      };
    },
  });

const ratelimitRedis = Redis.fromEnv();
const ratelimit = new Ratelimit({
  redis: ratelimitRedis,
  limiter: Ratelimit.slidingWindow(60, "60 s"),
  analytics: true,
  prefix: "trpc-ratelimit",
});

export const sentryMiddleware = t.middleware((opts) =>
  measureTrpcCall(
    {
      path: opts.path,
      type: opts.type,
      attribution: opts.ctx.queryMetrics?.get(opts.path),
    },
    () =>
      Sentry.trpcMiddleware({
        // Parental settings contain PIN credentials; keep them out of error telemetry.
        attachRpcInput: !hasSensitiveTrpcInput(opts.path),
      })(opts),
  ),
);

/** Enforce the shared limiter before running a handler. */
export const ratelimitMiddleware = t.middleware(
  async ({ ctx: context, path, type, next }) => {
    await enforceRateLimit(context, path, type);
    return next();
  },
);

/** Only handlers that await this gate with their first read may defer rate limiting. */
export const deferredRatelimitMiddleware = t.middleware(
  async ({ ctx, path, type, next }) => {
    // Observe rejection immediately: input validation or the initial read may fail before
    // the handler awaits the gate. Keep the original limiter error in that case too.
    const rateLimit = enforceRateLimit(ctx, path, type);
    void rateLimit.catch(() => {});
    try {
      return await next({ ctx: { waitForRateLimit: () => rateLimit } });
    } finally {
      await rateLimit;
    }
  },
);

/** Player-facing message for a rate-limited read. */
export const QUERY_RATE_LIMIT_MESSAGE =
  "Too many requests for this page. Please wait a moment and try again.";

/** Player-facing message for a rate-limited action. */
export const MUTATION_RATE_LIMIT_MESSAGE =
  "You're moving too fast! Please wait a moment and try again.";

/**
 * Sliding-window rate limit keyed per procedure path + identity (userId, or IP
 * for anonymous callers). Every procedure type is limited without changing player
 * balances or recording infractions. If the Redis limiter is unreachable,
 * development fails open (the local shim may not be running) while production
 * fails closed. The SDK resolves its own timeout as success, so a slow Redis lets
 * requests through rather than failing every one;
 * tavern image uploads deliberately refuse that case instead.
 */
const enforceRateLimit = async (
  context: Pick<Awaited<ReturnType<typeof createAppTRPCContext>>, "userId" | "userIp">,
  path: string,
  type: string,
) => {
  if (!context.userId && !context.userIp) {
    throw new TRPCError({
      message: `No user ID or IP found for rate limit middleware`,
      code: "UNAUTHORIZED",
    });
  }
  const identifier = `${path}-${context.userId ?? context.userIp}`;
  let success = true;
  try {
    success = (await ratelimit.limit(identifier)).success;
  } catch (error) {
    // In development the limiter's Redis is a local shim that may simply not
    // be running (e.g. Docker is down); failing open beats bricking every
    // rate-limited endpoint. Production keeps failing closed.
    if (process.env.NODE_ENV !== "development") throw error;
    console.warn(
      `Rate limiter unreachable in dev, allowing ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!success) {
    if (path.startsWith("nativeAuth.")) {
      // Sign-in attempts keep their authentication-specific retry guidance.
      throw serverError(
        "TOO_MANY_REQUESTS",
        "Too many sign-in attempts. Please wait a minute and try again.",
      );
    }
    throw serverError(
      "TOO_MANY_REQUESTS",
      type === "mutation" ? MUTATION_RATE_LIMIT_MESSAGE : QUERY_RATE_LIMIT_MESSAGE,
    );
  }
};

/**
 * Vercel BotID on mutations served by /api/trpc; a no-op for queries and for
 * server-side callers (see @/server/utils/botid).
 */
export const botIdMiddleware = t.middleware(async ({ ctx, type, path, next }) => {
  await enforceBotId({ type, path, userId: ctx.userId });
  return next();
});

/**
 * This is how you create new routers and sub-routers in your tRPC API.
 *
 * @see https://trpc.io/docs/router
 */
export const createTRPCRouter = t.router;

/**
 * Public (unauthenticated) procedure
 *
 * This is the base piece you use to build new queries and mutations on your tRPC API. It does not
 * guarantee that a user querying is authorized, but you can still access user session data if they
 * are logged in.
 */
export const publicProcedure = t.procedure
  .use(botIdMiddleware)
  .use(ratelimitMiddleware)
  .use(sentryMiddleware);

/**
 * A public query whose result the CDN caches and shares between visitors (see
 * /api/trpc/cdn). The context is stripped of everything per-request on every endpoint,
 * so the result cannot depend on who asked; only build a query with it when no client
 * code invalidates or refetches it after an action, since the refetch would be served
 * the cached copy (tests/server/api/cdnCachedQueries.test.ts enforces this).
 */
export const cdnCachedProcedure = publicProcedure
  .meta({ cdnCached: true })
  .use(({ next }) =>
    next({
      ctx: {
        userId: null,
        // Nulled after the rate limiter, which is the only thing that reads it: a
        // shared copy must not be able to depend on who asked for it.
        userIp: undefined,
        userAgent: undefined,
        abLemuReplacementVariant: undefined,
        wallpaperVariant: undefined,
      },
    }),
  );

const enforceUserIsAuthed = t.middleware(async ({ ctx: context, path, next }) => {
  // Check that the user is authed
  if (!context.userId) {
    throw new TRPCError({
      // Expired sessions can still submit credentials; never echo unauthenticated input.
      message: `Unauthorized for tRPC endpoint. Path: ${path}.`,
      code: "UNAUTHORIZED",
    });
  }
  return next({ ctx: { userId: context.userId } });
});

/** Enforce persisted isolation even when hidden content or stale client state omits its tracker. */
const enforcePyramidIsolation = t.middleware(async ({ ctx, path, type, next }) => {
  if (type === "mutation" && ctx.userId && isPyramidRestrictedProcedure(path)) {
    const isolated = await fetchIsolatedPyramid(ctx.drizzle, ctx.userId);
    if (isolated) {
      // Some activities allow ordinary BATTLE players. Restrict isolated runs to their
      // own progression and combat controls. Answering with errorResponse without running
      // the procedure needs tRPC's internal middlewareMarker result shape.
      return {
        ok: true,
        data: errorResponse(ISOLATED_PYRAMID_MESSAGE),
        marker: middlewareMarker,
      };
    }
  }
  return next();
});

export const protectedProcedure = t.procedure
  .use(enforceUserIsAuthed)
  .use(enforcePyramidIsolation)
  .use(botIdMiddleware)
  .use(sentryMiddleware);

export const serverError = (code: TRPC_ERROR_CODE_KEY, message: string) => {
  return new TRPCError({
    code,
    message,
  });
};

export { type BaseServerResponse, baseServerResponse } from "@/validators/base";

export const errorResponse = (msg: string) => {
  return { success: false as const, message: msg };
};

/** Procedure meta: MCP presentation, and whether /api/trpc/cdn may cache the result. */
export type ProcedureMeta = McpMeta & { cdnCached?: true };
