import { type RetryOptions, withRetry } from "@/utils/retry";

/**
 * Vitess/PlanetScale occasionally drops a pooled connection mid-query and returns
 * an `Unavailable` rpc error. The query never reaches the tablet in that case, so
 * re-issuing it is safe - but only for statements that do not mutate data, since a
 * write could equally well have been applied before the connection died.
 *
 * Cluster events land in the same bucket: while a primary is reparented, vtgate
 * loses its healthcheck view of the shard and rejects the statement before routing
 * it anywhere, which clears once the new primary is advertised.
 *
 * Markers are taken verbatim from the errors PlanetScale returns, e.g.
 * "target: tnr.-.primary: vttablet: rpc error: code = Unavailable desc = error
 * reading from server: read tcp ...: read: connection reset by peer" and
 * "target: tnr.-.primary: inconsistent state detected, primary is serving but
 * initially found no available tablet".
 */
const TRANSIENT_MARKERS = [
  "code = Unavailable",
  "connection reset by peer",
  "broken pipe",
  "unexpected EOF",
  "inconsistent state detected",
  "no available tablet",
  "primary is not serving",
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

/**
 * A deadlock is not ambiguous the way a dropped connection is: InnoDB picks a victim
 * and rolls it back in full before returning errno 1213, so nothing of the statement
 * was applied and re-issuing it is safe even when it writes, increments a counter, or
 * carries a compare-and-swap guard whose predicate simply re-evaluates.
 *
 * Markers are taken verbatim from what PlanetScale returns, e.g. "target:
 * tnr.-.primary: vttablet: rpc error: code = Aborted desc = Deadlock found when trying
 * to get lock; try restarting transaction (errno 1213)".
 */
const DEADLOCK_MARKERS = ["Deadlock found", "errno 1213", "sqlstate 40001"] as const;

/** Detect a deadlock in a PlanetScale HTTP response body. */
export const isDeadlockResponse = (body: string): boolean =>
  DEADLOCK_MARKERS.some((marker) => body.includes(marker));

/**
 * Whether a response is worth re-issuing. A deadlock is safe to retry whatever the
 * statement did; a dropped connection only for reads, since a write may have been
 * applied before the connection died.
 */
export const isRetryableResponse = (
  status: number,
  body: string,
  readOnly: boolean,
): boolean =>
  isDeadlockResponse(body) || (readOnly && isTransientDatabaseResponse(status, body));

/**
 * Detect the same dropped connection on a thrown error, walking `.cause` because
 * Drizzle wraps the driver's `DatabaseError`. Writes are never retried by the
 * fetch wrapper above, so a call site that knows its statement is idempotent -
 * absolute values only, or a guard that makes a re-apply a no-op - opts in with
 * this detector instead.
 */
export const isTransientDatabaseError = (error: unknown): boolean => {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    const { message, cause } = current;
    if (TRANSIENT_MARKERS.some((marker) => message.includes(marker))) return true;
    current = cause;
  }
  return false;
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
 * Wrap `fetch` so that PlanetScale queries survive a dropped connection or a lost
 * deadlock instead of surfacing as a user-visible tRPC error.
 *
 * A dropped connection is only retried for reads: a mutation may have been applied
 * before the reset, and this codebase grants money/XP through non-idempotent
 * increments, so a blind retry could double-apply a reward.
 *
 * A deadlock is retried whatever the statement was. InnoDB rolls the victim back in
 * full before reporting errno 1213, so re-issuing cannot double-apply - which is why
 * every mutation gets this for free rather than each call site opting in.
 *
 * Statements inside a transaction are passed straight through. A reset aborts the
 * transaction server-side, so re-issuing the read would run it outside the
 * transaction's snapshot (`paypal.ts` depends on that isolation), and a deadlock rolls
 * the whole transaction back, so replaying one statement would lose the rest.
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
    if (!request || request.inTransaction) {
      return baseFetch(input, init);
    }
    const readOnly = isReadOnlyQuery(request.query);

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
          if (isRetryableResponse(snapshot.status, snapshot.body, readOnly)) {
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
