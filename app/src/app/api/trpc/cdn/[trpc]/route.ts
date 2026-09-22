import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { headers } from "next/headers";
import type { NextRequest } from "next/server";
import { appRouter, CDN_CACHED_QUERY_PATHS } from "@/api/root";
import { createCdnTRPCContext } from "@/server/api/trpc";
import { withRequestScope } from "@/server/requestScope";
import { flushSafe, logError } from "@/server/utils/sentry";

export const runtime = "nodejs";
export const maxDuration = 90;

/** How old a copy served by an HTTP cache may be. */
const CACHE_SECONDS = 60;

const cdnCachedQueries = new Set(CDN_CACHED_QUERY_PATHS);

/**
 * The cacheable half of the tRPC API: the client sends the queries built with
 * cdnCachedProcedure here as their own GET batch, the context carries no identity, and
 * the batch is answered with `s-maxage`, so an HTTP cache in front of the app serves the
 * next visitor asking for the same URL. It answers for those queries alone, so what the
 * endpoint can do is exactly what may be cached. It sits outside the Clerk matcher in
 * proxy.ts, so no session is attached here even when the caller has one.
 */
const handler = async (req: NextRequest) => {
  const readHeaders = await headers();
  const requested = decodeRequested(
    new URL(req.url).pathname.replace(/^\/api\/trpc\/cdn\//, ""),
  );
  if (!requested?.every((path) => cdnCachedQueries.has(path))) {
    return new Response("Not found", {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  }

  let shouldFlush = false;

  const response = await withRequestScope(() =>
    fetchRequestHandler({
      endpoint: "/api/trpc/cdn",
      req,
      router: appRouter,
      createContext() {
        return createCdnTRPCContext(readHeaders);
      },
      responseMeta({ errors, eagerGeneration }) {
        // A streamed response reports its errors only after this has run.
        const isCacheable = !eagerGeneration && errors.length === 0;
        return {
          headers: {
            "cache-control": isCacheable
              ? `public, s-maxage=${CACHE_SECONDS}`
              : "no-store",
          },
        };
      },
      onError: ({ error, path, input }) => {
        if (!["UNAUTHORIZED", "TOO_MANY_REQUESTS"].includes(error.code)) {
          logError(
            error,
            `❌ cached tRPC failed with ${error.code} on ${path ?? "<no-path>"}. Message: ${error.message}. Input: ${JSON.stringify(input)}. Stack: ${error.stack}`,
            { input, path, error },
          );
          shouldFlush = true;
        }
      },
    }),
  );
  if (shouldFlush) {
    await flushSafe();
  }

  return response;
};

export { handler as GET };

/**
 * Next rejects a malformed escape before routing, so this is belt-and-braces: an
 * undecodable path is unknown, which the caller answers the same way as an unlisted one.
 */
const decodeRequested = (path: string) => {
  try {
    return decodeURIComponent(path).split(",");
  } catch {
    return null;
  }
};
