import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { cookies, headers } from "next/headers";
import type { NextRequest } from "next/server";
import { appRouter } from "@/api/root";
import { BOTID_CHALLENGE_HEADER } from "@/libs/botid";
import { BUILD_ID, BUILD_ID_HEADER } from "@/libs/buildVersion";
import { diagnosticTrpcInput } from "@/libs/trpcLogging";
import { createAppTRPCContext } from "@/server/api/trpc";
import { withRequestScope } from "@/server/requestScope";
import {
  createBotIdGuard,
  shouldGuardTrpcRequest,
  trpcPathsFromUrl,
  withBotIdGuard,
} from "@/server/utils/botid";
import { flushSafe, isExpectedTrpcRouteError, logError } from "@/server/utils/sentry";

export const runtime = "nodejs";
// Reference-image evolution includes generation, cutout and content verification.
// Pet provider calls stop before this deadline so their failure remains retryable.
export const maxDuration = 300;

const procedureTypes = new Map(
  Object.entries(appRouter._def.procedures).map(([path, procedure]) => {
    const def = (procedure as { _def?: { type?: string } })._def;
    return [path, def?.type ?? "unknown"];
  }),
);

const handler = async (req: NextRequest) => {
  // Mutations wait for BotID's verdict (see @/server/utils/botid). Starting the check
  // here overlaps its round trip with the session lookup in createContext.
  const trpcPaths = trpcPathsFromUrl(req.url);
  const botIdGuard = shouldGuardTrpcRequest(req.method, trpcPaths)
    ? createBotIdGuard(trpcPaths, {
        hasChallenge: req.headers.has(BOTID_CHALLENGE_HEADER),
        userAgent: req.headers.get("user-agent"),
      })
    : undefined;
  // Without a challenge BotID can only answer "bot", so the request is not sent to it.
  if (botIdGuard?.hasChallenge) void botIdGuard.verify();

  const readCookies = await cookies();
  const readHeaders = await headers();

  let shouldFlush = false;

  // One memo per HTTP request, shared by every procedure in the batch: httpBatchLink
  // packs a page's whole mount into a single POST, and the shared helpers those
  // procedures call would otherwise re-read the same global rows once per procedure.
  const response = await withRequestScope(() =>
    withBotIdGuard(botIdGuard, () =>
      fetchRequestHandler({
        endpoint: "/api/trpc",
        req,
        router: appRouter,
        createContext() {
          return createAppTRPCContext({
            readHeaders,
            readCookies,
            procedureTypes,
          });
        },
        // Lets a tab running an older bundle notice the deploy and reload onto it.
        responseMeta: () => ({ headers: { [BUILD_ID_HEADER]: BUILD_ID } }),
        onError: ({ error, path, input, ctx }) => {
          const diagnosticInput = diagnosticTrpcInput(path, input);
          if (
            !isExpectedTrpcRouteError({
              code: error.code,
              message: error.message,
              userId: ctx?.userId,
              method: req.method,
            })
          ) {
            logError(
              error,
              `❌ tRPC failed with ${error.code} on ${path ?? "<no-path>"}. Message: ${error.message}. Input: ${JSON.stringify(diagnosticInput)}. Stack: ${error.stack}`,
              { input: diagnosticInput, path, error, ctx },
            );
            shouldFlush = true;
          }
        },
      }),
    ),
  );
  if (shouldFlush || botIdGuard?.needsFlush) {
    console.error("Error Detected. Flushing Sentry");
    await flushSafe();
  }

  return response;
};

export { handler as GET, handler as POST };
