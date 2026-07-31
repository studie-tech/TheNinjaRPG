import * as SentryNext from "@sentry/nextjs";
import * as SentryNode from "@sentry/node";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, publicProcedure } from "@/api/trpc";

/**
 * Temporary router used to verify whether backend errors raised inside tRPC
 * procedures reach Sentry when running on Vercel. Not part of the game.
 */
export const debugSentryRouter = createTRPCRouter({
  info: publicProcedure.query(() => {
    const nextClient = SentryNext.getClient();
    const nodeClient = SentryNode.getClient();
    return {
      vercelEnv: process.env.VERCEL_ENV ?? null,
      nodeEnv: process.env.NODE_ENV,
      nextRuntime: process.env.NEXT_RUNTIME ?? null,
      registerMarker:
        (globalThis as Record<string, unknown>).__TNR_SENTRY_REGISTER__ ?? null,
      nextjsClientInitialized: !!nextClient,
      nodeClientInitialized: !!nodeClient,
      sameClientInstance: !!nextClient && nextClient === nodeClient,
      environmentOption: nextClient?.getOptions().environment ?? null,
    };
  }),
  throw: publicProcedure.query(() => {
    const marker = `SENTRY_PROBE_TRPC_${process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local"}_${Date.now()}`;
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: marker });
  }),
});
