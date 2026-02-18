/**
 * YOU PROBABLY DON'T NEED TO EDIT THIS FILE, UNLESS:
 * 1. You want to modify request context (see Part 1)
 * 2. You want to create a new middleware or type of procedure (see Part 3)
 *
 * tl;dr - this is where all the tRPC server stuff is created and plugged in.
 * The pieces you will need to use are documented accordingly near the end
 */

import { auth } from "@clerk/nextjs/server";
import * as Sentry from "@sentry/node";
import { initTRPC, TRPCError } from "@trpc/server";
import type { TRPC_ERROR_CODE_KEY } from "@trpc/server/rpc";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { eq, sql } from "drizzle-orm";
import type { ReadonlyHeaders } from "next/dist/server/web/spec-extension/adapters/headers";
import type { ReadonlyRequestCookies } from "next/dist/server/web/spec-extension/adapters/request-cookies";
import type { NextRequest } from "next/server";
import superjson from "superjson";
import { ZodError, z } from "zod";
import { userData } from "@/drizzle/schema";
import type { McpMeta } from "@/libs/mcp";
/**
 * 1. CONTEXT
 *
 * This section defines the "contexts" that are available in the backend API
 *
 * These allow you to access things like the database, the session, etc, when
 * processing a request
 *
 */
import { drizzleDB } from "@/server/db";
import { getClientIp } from "@/utils/network";

/**
 * This is the actual context you will use in your router. It will be used to process every request
 * that goes through your tRPC endpoint. This is for the app router.
 * @see https://trpc.io/docs/context
 */
export const createAppTRPCContext = async (options: {
  req: NextRequest;
  readHeaders: ReadonlyHeaders;
  readCookies: ReadonlyRequestCookies;
}) => {
  // Get user ID - SIMPLE
  const session = await auth();
  const userId = session.userId;
  // Get IP
  const { readHeaders } = options;
  const userIp = getClientIp(readHeaders);
  // Get agent
  const userAgent = readHeaders.get("user-agent") ?? undefined;
  // AB testing cookies
  const abLemuReplacementVariant = options.readCookies.get(
    "ab_lemu_replacement_2",
  )?.value;
  return {
    drizzle: drizzleDB,
    userIp,
    userId,
    userAgent,
    abLemuReplacementVariant,
  };
};

/**
 * 2. INITIALIZATION
 *
 * This is where the tRPC API is initialized, connecting the context and transformer.
 */

const t = initTRPC
  .context<typeof createAppTRPCContext>()
  .meta<McpMeta>()
  .create({
    transformer: superjson,
    errorFormatter({ shape, error }) {
      // If a database error, extract & format error message better
      if (error?.cause?.cause) {
        const cause = error.cause.cause as { name?: string; body: unknown };
        if (cause?.name === "DatabaseError" && cause?.body) {
          const message = JSON.stringify(cause.body);
          // Remove everything after (including) "sqlstate" from the error message
          const cleanMessage =
            typeof message === "string"
              ? message.replace(/\s*\(sqlstate.*$/i, "")
              : message;
          shape.message = cleanMessage;
        }
      }

      return {
        ...shape,
        data: {
          ...shape.data,
          zodError: error.cause instanceof ZodError ? error.cause.issues : null,
        },
      };
    },
  });

/**
 * 3. ROUTER & PROCEDURE (THE IMPORTANT BIT)
 *
 * These are the pieces you use to build your tRPC API. You should import these a lot in the
 * "/src/server/api/routers" directory.
 */
const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(60, "60 s"),
  analytics: true,
  prefix: "trpc-ratelimit",
});

export const sentryMiddleware = t.middleware(
  Sentry.trpcMiddleware({
    attachRpcInput: true,
  }),
);

export const ratelimitMiddleware = t.middleware(
  async ({ ctx: context, path, next }) => {
    if (!context.userId && !context.userIp) {
      throw new TRPCError({
        message: `No user ID or IP found for rate limit middleware`,
        code: "UNAUTHORIZED",
      });
    }
    const identifier = `${path}-${context.userId ?? context.userIp}`;
    const { success } = await ratelimit.limit(identifier);
    if (!success) {
      if (context.userId) {
        const result = await context.drizzle
          .update(userData)
          .set({
            movedTooFastCount: sql`${userData.movedTooFastCount} + 1`,
            money: sql`GREATEST(${userData.money} * 0.99, 0)`,
            bank: sql`GREATEST(${userData.bank} * 0.99, 0)`,
          })
          .where(eq(userData.userId, context.userId));
        if (result.rowsAffected === 0) {
          throw new TRPCError({
            message: `User not found for rate limit penalty`,
            code: "NOT_FOUND",
          });
        }
      }
      throw serverError(
        "TOO_MANY_REQUESTS",
        `You are acting too fast. Incident logged for review on path ${path}. 1% money reduced.`,
      );
    }
    return next({ ctx: { userId: context.userId } });
  },
);

export const hasUserMiddleware = t.middleware(async ({ ctx: context, path, next }) => {
  if (!context.userId) {
    throw new TRPCError({
      message: `No user ID found for path ${path}`,
      code: "UNAUTHORIZED",
    });
  }
  return next({ ctx: { userId: context.userId } });
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
  .use(ratelimitMiddleware)
  .use(sentryMiddleware);

const enforceUserIsAuthed = t.middleware(
  async ({ ctx: context, path, getRawInput, next }) => {
    // Check that the user is authed
    if (!context.userId) {
      const rawInput = await getRawInput();
      throw new TRPCError({
        message: `Unauthorized for tRPC endpoint. Path: ${path}. Data: ${JSON.stringify(rawInput)}`,
        code: "UNAUTHORIZED",
        cause: rawInput,
      });
    }
    return next({ ctx: { userId: context.userId } });
  },
);

export const protectedProcedure = t.procedure
  .use(enforceUserIsAuthed)
  .use(sentryMiddleware);

/**
 * 4. EXPORTS
 */
export const serverError = (code: TRPC_ERROR_CODE_KEY, message: string) => {
  return new TRPCError({
    code,
    message,
  });
};

export const baseServerResponse = z.object({
  success: z.boolean(),
  message: z.string(),
});
export type BaseServerResponse = z.infer<typeof baseServerResponse>;

export const errorResponse = (msg: string) => {
  return { success: false as const, message: msg };
};
