import * as Sentry from "@sentry/node";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { cookies, headers } from "next/headers";
import type { NextRequest } from "next/server";
import { appRouter } from "@/api/root";
import { createAppTRPCContext } from "@/api/trpc";

export const runtime = "nodejs";
export const maxDuration = 90;

const handler = async (req: NextRequest) => {
  const readCookies = await cookies();
  const readHeaders = await headers();

  let shouldFlush = false;

  const response = await fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext() {
      return createAppTRPCContext({ req, readHeaders, readCookies });
    },
    onError: ({ error, path, input, ctx }) => {
      if (!["UNAUTHORIZED", "TOO_MANY_REQUESTS"].includes(error.code)) {
        logError(
          error,
          `❌ tRPC failed with ${error.code} on ${path ?? "<no-path>"}. Message: ${error.message}. Input: ${JSON.stringify(input)}. Stack: ${error.stack}`,
          { input, path, error, ctx },
        );
        shouldFlush = true;
      }
    },
  });
  if (shouldFlush) {
    console.error("Error Detected. Flushing Sentry");
    await flushSafe();
  }

  return response;
};

export { handler as GET, handler as POST };

/**
 * @param error - The error to log
 * @param message - The message to log
 * @param attributes - The attributes to log
 */
export const logError = (
  error: unknown,
  message: string,
  attributes: Record<string, unknown> = {},
) => {
  console.error(error);
  Sentry.captureException(error, {
    extra: {
      message,
      ...attributes,
    },
  });
};

/**
 * Flushes Sentry queue in a safe way.
 *
 * It's necessary to flush all Sentry events on the server, because Vercel runs on AWS Lambda, see https://vercel.com/docs/platform/limits#streaming-responses
 * If you don't flush, then it's possible the Sentry events won't be sent.
 * This helper is meant to be used for backend-only usage. (not frontend)
 *
 * There is a potential bug in Sentry that throws an exception when flushing times out, causing API endpoints to fail.
 * @see https://github.com/getsentry/sentry/issues/26870
 */
export const flushSafe = async (timeout = 5000): Promise<boolean> => {
  try {
    return await Sentry.flush(timeout);
  } catch (e) {
    console.error(
      `[flushSafe] An exception was thrown while running Sentry.flush()`,
      e,
    );
    return false;
  }
};
