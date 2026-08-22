import { withRetry } from "@/utils/retry";

/**
 * MySQL / Vitess duplicate-key detection for catch blocks around INSERTs guarded by UNIQUE.
 * Driver and layer (Drizzle, mysql2, vttablet) vary in error message text; this covers common shapes.
 */
export const isMysqlDuplicateKeyError = (error: unknown): boolean =>
  error instanceof Error &&
  (error.message.includes("Duplicate entry") ||
    error.message.includes("ER_DUP_ENTRY") ||
    error.message.includes("UNIQUE constraint"));

/**
 * MySQL / Vitess deadlock detection (errno 1213). Drizzle rethrows driver errors as
 * DrizzleQueryError, whose message holds only the SQL and params, so the PlanetScale
 * DatabaseError carrying the deadlock text has to be looked for down the cause chain.
 */
export const isMysqlDeadlockError = (error: unknown): boolean => {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    if (
      current.message.includes("Deadlock") ||
      current.message.includes("errno 1213") ||
      current.message.includes("sqlstate 40001")
    ) {
      return true;
    }
    current = current.cause;
  }
  return false;
};

/**
 * Re-issue a single statement that lost a deadlock. InnoDB rolls the victim back in
 * full before returning errno 1213, so nothing of it was applied and re-running it is
 * safe even when it increments a counter or carries a compare-and-swap guard.
 *
 * Only ever wrap one statement: a partially applied sequence of writes must not be
 * replayed, since there are no transactions here to unwind the earlier ones.
 */
export const retryOnDeadlock = <T>(run: () => Promise<T>, maxRetries = 3): Promise<T> =>
  withRetry(run, {
    maxRetries,
    // Deadlocks clear immediately and a request is waiting on this.
    baseDelayMs: 50,
    deadlineMs: 3000,
    isTransient: isMysqlDeadlockError,
  });
