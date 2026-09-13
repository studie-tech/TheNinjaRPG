import { timingSafeEqual } from "node:crypto";

/**
 * Authenticate a Vercel cron request using the platform-provided Bearer token.
 *
 * Returns null when authorized, otherwise a ready-to-return error response. Keeping the response
 * construction here gives every cron endpoint the same fail-closed behavior for both a missing
 * server configuration and an invalid request header.
 */
export const authenticateCronRequest = (request: Request): Response | null => {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return Response.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }

  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${cronSecret}`);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return Response.json(
      { error: "Unauthorized - Invalid or missing authorization header" },
      { status: 401 },
    );
  }

  return null;
};
