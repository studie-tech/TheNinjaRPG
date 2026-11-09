import { vi } from "bun:test";

/** Answer the rate limiter's Upstash commands, including pipelined requests. */
export const rateLimitResponse = (
  init?: RequestInit,
  remaining = 59,
): Response | null => {
  if (typeof init?.body !== "string" || !init.body.includes("trpc-ratelimit"))
    return null;
  const commands = JSON.parse(init.body) as unknown[];
  const resultFor = (command: unknown[]) => ({
    result: command[0] === "evalsha" || command[0] === "eval" ? [remaining, 60] : 1,
  });
  return Response.json(
    Array.isArray(commands[0])
      ? commands.map((command) => resultFor(command as unknown[]))
      : resultFor(commands),
  );
};

/**
 * Keep middleware active while replacing only its Redis transport. Restore with vi.restoreAllMocks().
 * Other requests pass through unless `unexpectedRequestMessage` rejects them or `answerOtherRequests`
 * gives them a limiter-shaped reply, which suites use to keep Pusher and combat-receipt traffic local:
 * the receipt store treats that reply as unreadable and stops, where a cache miss would wait out its retries.
 * `remaining` below zero makes the limiter deny the request.
 */
export const stubRateLimitTransport = (
  options: {
    unexpectedRequestMessage?: string;
    answerOtherRequests?: boolean;
    remaining?: () => number;
  } = {},
) => {
  const realFetch = globalThis.fetch;
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const response = rateLimitResponse(init, options.remaining?.());
    if (response) return response;
    if (options.unexpectedRequestMessage)
      throw new Error(options.unexpectedRequestMessage);
    if (options.answerOtherRequests)
      return Response.json(
        String(input).endsWith("/pipeline")
          ? [{ result: [59, 60] }]
          : { result: [59, 60] },
      );
    return realFetch(input, init);
  });
};
