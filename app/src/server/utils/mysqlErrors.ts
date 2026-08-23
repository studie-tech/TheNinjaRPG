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
