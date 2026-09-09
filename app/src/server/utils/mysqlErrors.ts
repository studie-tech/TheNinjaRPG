/**
 * MySQL / Vitess duplicate-key detection for catch blocks around INSERTs guarded by UNIQUE.
 * Driver and layer (Drizzle, mysql2, vttablet) vary in error message text; this covers common shapes.
 */
const hasDuplicateKeyText = (text: string) =>
  text.includes("Duplicate entry") ||
  text.includes("ER_DUP_ENTRY") ||
  text.includes("UNIQUE constraint");

export const isMysqlDuplicateKeyError = (error: unknown): boolean => {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    if (hasDuplicateKeyText(current.message)) return true;
    const sqlMessage = (current as { sqlMessage?: unknown }).sqlMessage;
    if (typeof sqlMessage === "string" && hasDuplicateKeyText(sqlMessage)) {
      return true;
    }
    current = current.cause;
  }
  return false;
};

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
 * Run a mutation again when InnoDB picked it as a deadlock victim. Two single statements
 * can deadlock on index order alone, with no transaction anywhere, and InnoDB resolves it
 * at once by rolling one of them back, so the loser only needs another go. Only for work
 * that is safe to start over: every statement guarded, all progress durable.
 */
export const retryOnDeadlock = async <T>(
  run: () => Promise<T>,
  attempts = 4,
): Promise<T> => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (!isMysqlDeadlockError(error) || attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** (attempt - 1)));
    }
  }
};

/** Retryable failures which can abort a bounded administrative transaction. */
export const isMysqlTransactionRetryableError = (error: unknown): boolean => {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    if (
      /deadlock|errno 1213|sqlstate 40001|transaction.*(?:timeout|deadline)|deadline exceeded|exceeded.*transaction/i.test(
        current.message,
      )
    ) {
      return true;
    }
    current = current.cause;
  }
  return false;
};
