import { type RetryOptions, withRetry } from "@/utils/retry";

/**
 * Vitess/PlanetScale occasionally drops a pooled connection mid-query and returns
 * an `Unavailable` rpc error. The query never reaches the tablet in that case, so
 * re-issuing it is safe - but only for statements that do not mutate data, since a
 * write could equally well have been applied before the connection died.
 *
 * Markers are taken verbatim from the errors PlanetScale returns, e.g.
 * "target: tnr.-.primary: vttablet: rpc error: code = Unavailable desc = error
 * reading from server: read tcp ...: read: connection reset by peer".
 */
const TRANSIENT_MARKERS = [
  "code = Unavailable",
  "connection reset by peer",
  "broken pipe",
  "unexpected EOF",
] as const;

/** Statements that cannot change data, and are therefore safe to re-issue. */
const READ_ONLY_STATEMENTS = /^(select|show|describe|desc|explain)\b/i;

/** Thrown internally to signal `withRetry` that another attempt is worthwhile. */
class TransientDatabaseError extends Error {}

/**
 * Strip leading comments and whitespace so the leading keyword can be inspected.
 * Drizzle emits plain statements, but the PlanetScale driver may prepend hints.
 */
const stripLeadingComments = (query: string): string => {
  let remaining = query.trimStart();
  let previous = "";
  while (remaining !== previous) {
    previous = remaining;
    if (remaining.startsWith("--")) {
      remaining = remaining.slice(remaining.indexOf("\n") + 1).trimStart();
    } else if (remaining.startsWith("/*")) {
      const end = remaining.indexOf("*/");
      if (end === -1) return "";
      remaining = remaining.slice(end + 2).trimStart();
    }
  }
  return remaining;
};

/**
 * A statement is retryable only when it is unambiguously a read. `WITH` is
 * deliberately excluded: MySQL 8 allows a CTE to precede UPDATE/DELETE, so the
 * leading keyword alone does not prove the statement is side-effect free.
 */
export const isReadOnlyQuery = (query: string): boolean => {
  return READ_ONLY_STATEMENTS.test(stripLeadingComments(query));
};

/** Detect a dropped-connection error in a PlanetScale HTTP response body. */
export const isTransientDatabaseResponse = (status: number, body: string): boolean => {
  if (status === 502 || status === 503 || status === 504) return true;
  return TRANSIENT_MARKERS.some((marker) => body.includes(marker));
};

interface DriverRequest {
  query: string;
  /**
   * True while the statement runs between BEGIN and COMMIT. The driver echoes
   * the vitess session on every request, and it carries `inTransaction` only
   * for statements inside a transaction - plain autocommit connections omit it.
   */
  inTransaction: boolean;
}

/** Pull the SQL text and transaction state out of the driver's JSON body. */
const parseDriverRequest = (
  body: BodyInit | null | undefined,
): DriverRequest | null => {
  if (typeof body !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || !("query" in parsed)) return null;
    const { query, session } = parsed as {
      query?: unknown;
      session?: { vitessSession?: { inTransaction?: unknown } } | null;
    };
    if (typeof query !== "string") return null;
    return {
      query,
      inTransaction: session?.vitessSession?.inTransaction === true,
    };
  } catch {
    // Not a JSON body (e.g. session creation) - never retried.
  }
  return null;
};

/**
 * Wrap `fetch` so that read-only PlanetScale queries survive a dropped
 * connection instead of surfacing as a user-visible tRPC error.
 *
 * Writes are passed straight through: a mutation may have been applied before
 * the connection reset, and this codebase grants money/XP through non-idempotent
 * increments, so a blind retry could double-apply a reward.
 *
 * Statements inside a transaction are also passed through. A reset aborts the
 * transaction server-side, so re-issuing the read would run it outside the
 * transaction's snapshot - `paypal.ts` depends on that isolation.
 *
 * When every attempt fails the final response is returned unchanged, so the
 * driver still raises its normal `DatabaseError` and callers behave as before.
 */
export const createRetryingFetch = (
  baseFetch: typeof fetch = fetch,
  options: RetryOptions = {},
): typeof fetch => {
  return async (input, init) => {
    const request = parseDriverRequest(init?.body);
    if (!request || request.inTransaction || !isReadOnlyQuery(request.query)) {
      return baseFetch(input, init);
    }

    let lastResponse: { body: string; status: number; headers: Headers } | null = null;

    const rebuild = (response: {
      body: string;
      status: number;
      headers: Headers;
    }): Response => {
      const hasBody = response.status !== 204 && response.status !== 304;
      return new Response(hasBody ? response.body : null, {
        status: response.status,
        headers: response.headers,
      });
    };

    try {
      return await withRetry(
        async () => {
          const response = await baseFetch(input, init);
          const snapshot = {
            body: await response.text(),
            status: response.status,
            headers: response.headers,
          };
          lastResponse = snapshot;
          if (isTransientDatabaseResponse(snapshot.status, snapshot.body)) {
            throw new TransientDatabaseError("Transient PlanetScale error");
          }
          return rebuild(snapshot);
        },
        {
          maxRetries: 2,
          // Connection resets clear in milliseconds; a request is waiting on this.
          baseDelayMs: 50,
          deadlineMs: 3000,
          isTransient: (error) =>
            error instanceof TransientDatabaseError || error instanceof TypeError,
          ...options,
        },
      );
    } catch (error) {
      if (error instanceof TransientDatabaseError && lastResponse) {
        return rebuild(lastResponse);
      }
      throw error;
    }
  };
};
