import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { cookies, headers } from "next/headers";
import type { NextRequest } from "next/server";
import { appRouter } from "@/api/root";
import { createAppTRPCContext } from "@/server/api/trpc";
import { withRequestScope } from "@/server/requestScope";
import { flushSafe, logError } from "@/server/utils/sentry";

export const runtime = "nodejs";
export const maxDuration = 90;

const handler = async (req: NextRequest) => {
  const readCookies = await cookies();
  const readHeaders = await headers();

  let shouldFlush = false;

  // One memo per HTTP request, shared by every procedure in the batch: httpBatchLink
  // packs a page's whole mount into a single POST, and the shared helpers those
  // procedures call would otherwise re-read the same global rows once per procedure.
  const response = await withRequestScope(() =>
    fetchRequestHandler({
      endpoint: "/api/trpc",
      req,
      router: appRouter,
      createContext() {
        return createAppTRPCContext({ req, readHeaders, readCookies });
      },
      onError: ({ error, path, input, ctx }) => {
        // tRPC rejects a GET against a mutation path with METHOD_NOT_SUPPORTED before any
        // resolver runs, and only crawlers reach it: httpBatchLink always POSTs mutations,
        // so an anonymous caller is a bot ignoring the /api/ disallow in robots.ts and there
        // is no user-facing failure to surface. An authenticated caller would mean genuine
        // client/server skew, so those keep reporting here, and the client still surfaces
        // them through the global error toast in _trpc/Provider.tsx.
        const isCrawlerMethodRejection =
          error.code === "METHOD_NOT_SUPPORTED" && !ctx?.userId;
        // A Clerk session with no UserData row of its OWN: character creation was never
        // finished, or the character was deleted while the tab stayed open. The client
        // forwards to /register off profile.getUser's undefined user, so the guard firing
        // elsewhere in the same request is expected. fetchUser raises the identical message
        // for a missing *target* user, so match the session id rather than the shape.
        const isUnregisteredUser =
          error.code === "NOT_FOUND" &&
          !!ctx?.userId &&
          error.message ===
            `User not found: ${ctx.userId}. Please complete registration.`;
        if (
          !isCrawlerMethodRejection &&
          !isUnregisteredUser &&
          !["UNAUTHORIZED", "TOO_MANY_REQUESTS"].includes(error.code)
        ) {
          logError(
            error,
            `❌ tRPC failed with ${error.code} on ${path ?? "<no-path>"}. Message: ${error.message}. Input: ${JSON.stringify(input)}. Stack: ${error.stack}`,
            { input, path, error, ctx },
          );
          shouldFlush = true;
        }
      },
    }),
  );
  if (shouldFlush) {
    console.error("Error Detected. Flushing Sentry");
    await flushSafe();
  }

  return response;
};

export { handler as GET, handler as POST };
