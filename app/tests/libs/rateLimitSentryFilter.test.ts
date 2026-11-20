import { describe, expect, it, vi } from "bun:test";
import {
  BrowserClient,
  defaultStackParser,
  eventFiltersIntegration,
} from "@sentry/browser";
import * as Sentry from "@sentry/nextjs";
import { TRPCError } from "@trpc/server";
import {
  MUTATION_RATE_LIMIT_MESSAGE,
  QUERY_RATE_LIMIT_MESSAGE,
} from "@/libs/rateLimitMessages";

/** The ignoreErrors lists the server and edge configs initialize Sentry with (each runs once). */
const init = vi.spyOn(Sentry, "init").mockImplementation((() => undefined) as never);
await import("../../sentry.server.config");
await import("../../sentry.edge.config");
const [serverIgnoreErrors, edgeIgnoreErrors] = init.mock.calls.map(
  ([options]) => (options as { ignoreErrors: (string | RegExp)[] }).ignoreErrors,
);
init.mockRestore();

/** Whether the SDK's own ignoreErrors filter drops this exception. */
const isDropped = async (ignoreErrors: (string | RegExp)[], error: Error) => {
  let sent = false;
  const client = new BrowserClient({
    dsn: "https://key@o1.ingest.sentry.io/1",
    transport: () => ({ send: async () => ({}), flush: async () => true }),
    stackParser: defaultStackParser,
    ignoreErrors,
    integrations: [eventFiltersIntegration()],
    beforeSend: () => {
      sent = true;
      return null;
    },
  });
  client.init();
  client.captureException(error);
  await client.flush(100);
  return !sent;
};

describe.each([
  ["server", serverIgnoreErrors!],
  ["edge", edgeIgnoreErrors!],
] as const)("%s Sentry config", (_runtime, ignoreErrors) => {
  it("ignores the shared limiter's rejections", async () => {
    for (const message of [MUTATION_RATE_LIMIT_MESSAGE, QUERY_RATE_LIMIT_MESSAGE]) {
      const error = new TRPCError({ code: "TOO_MANY_REQUESTS", message });
      expect(await isDropped(ignoreErrors, error)).toBe(true);
    }
  });

  it("still reports other combat errors", async () => {
    const error = new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Battle state could not be saved",
    });
    expect(await isDropped(ignoreErrors, error)).toBe(false);
  });
});
