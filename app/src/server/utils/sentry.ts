import * as Sentry from "@sentry/nextjs";
import { BOTID_BLOCKED_MESSAGE, BOTID_RELOAD_REQUIRED_MESSAGE } from "@/libs/botid";
import { isDatabaseFailure } from "@/server/utils/mysqlErrors";

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
 * Report a failed statement that its caller turned into a response, since the error then
 * never reaches the tRPC route's `onError`. Other failures stay out of Sentry.
 */
export const logDatabaseFailure = (error: unknown, message: string) => {
  if (isDatabaseFailure(error)) logError(error, message);
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

/**
 * Whether a tRPC error the /api/trpc route handler sees is expected traffic rather than a
 * failure worth reporting from the route's onError.
 */
/** The NOT_FOUND text for a user without a character; the route filter matches on it. */
export const missingUserMessage = (userId: string) =>
  `User not found: ${userId}. Please complete registration.`;

export const isExpectedTrpcRouteError = (props: {
  code: string;
  message: string;
  userId: string | null | undefined;
  method: string;
}) => {
  const { code, message, userId, method } = props;
  // Rejected before or by auth/rate limiting; the client handles both without a report.
  if (code === "UNAUTHORIZED" || code === "TOO_MANY_REQUESTS") return true;
  // A BotID block is recorded once per request by @/server/utils/botid, with the verdict;
  // the client shows the message as a toast.
  if (code === "FORBIDDEN" && message === BOTID_BLOCKED_MESSAGE) return true;
  // So is a protected mutation that arrived without a BotID challenge; the client asks
  // the player to reload.
  if (code === "PRECONDITION_FAILED" && message === BOTID_RELOAD_REQUIRED_MESSAGE) {
    return true;
  }
  // tRPC rejects a request whose method does not match the procedure type with
  // METHOD_NOT_SUPPORTED before any resolver runs. httpBatchLink always POSTs mutations, so
  // an anonymous GET against one is a bot ignoring the /api/ disallow in robots.ts. It also
  // always GETs queries (no methodOverride or maxURLLength is configured, and no other
  // first-party client calls /api/trpc), so a POST to a query, signed in or not, is a script
  // replaying a session: no first-party UI issued it, so there is no user-facing failure to
  // surface. An authenticated GET against a mutation could still be genuine client/server
  // skew, so that keeps reporting, and the client surfaces it through the global error
  // toast in _trpc/Provider.tsx.
  if (code === "METHOD_NOT_SUPPORTED" && (!userId || method === "POST")) return true;
  // A Clerk session with no UserData row of its OWN: character creation was never
  // finished, or the character was deleted while the tab stayed open. The client
  // forwards to /register off profile.getUser's undefined user, so the guard firing
  // elsewhere in the same request is expected. Every missingUserMessage throw for a
  // missing *target* user reads the same, so match the session id rather than the shape.
  if (code === "NOT_FOUND" && userId && message === missingUserMessage(userId)) {
    return true;
  }
  return false;
};
