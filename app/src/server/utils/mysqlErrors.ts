import { DatabaseError, UnknownError } from "@planetscale/database";
import { DrizzleQueryError } from "drizzle-orm";
import { sleep } from "@/utils/time";

/** Shown for a failed statement when the driver gave no text that is safe to repeat. */
export const DATABASE_FAILURE_MESSAGE =
  "The database could not complete this request. Please try again.";

/** Where a Vitess error starts echoing the statement and its bind values. */
const DRIVER_SQL_ECHO = /\((?:sqlstate|CallerID)\b|\bSql:|\bBindVars:/i;

/**
 * The first error on the `.cause` chain that passes `test`. Drizzle rethrows driver errors
 * as DrizzleQueryError, whose message holds only the SQL and params, so the driver's own
 * text has to be looked for further down.
 */
const findErrorInChain = (
  error: unknown,
  test: (current: Error) => boolean,
): Error | undefined => {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    if (test(current)) return current;
    current = current.cause;
  }
  return undefined;
};

/** Whether any error on the `.cause` chain passes `test`. */
export const someErrorInChain = (
  error: unknown,
  test: (current: Error) => boolean,
): boolean => findErrorInChain(error, test) !== undefined;

/**
 * The text of `error` that may leave the server. A failed statement's Drizzle message is the
 * SQL and params, and a TRPCError or wrapper built on it repeats them, so a database failure
 * reports the driver's summary with the statement cut off, or a generic message without one.
 */
export const clientErrorMessage = (error: Error): string => {
  const failure = findErrorInChain(
    error,
    (current) =>
      current instanceof DrizzleQueryError || current instanceof DatabaseError,
  );
  if (!failure) return error.message;
  const driver = findErrorInChain(
    failure,
    (current) => current instanceof DatabaseError && !(current instanceof UnknownError),
  );
  const summary = driver?.message.split(DRIVER_SQL_ECHO, 1)[0]?.trim();
  return summary || DATABASE_FAILURE_MESSAGE;
};

const hasDuplicateKeyText = (text: string) =>
  text.includes("Duplicate entry") ||
  text.includes("ER_DUP_ENTRY") ||
  text.includes("UNIQUE constraint");

/**
 * MySQL / Vitess duplicate-key detection for catch blocks around INSERTs guarded by UNIQUE.
 * Driver and layer (Drizzle, mysql2, vttablet) vary in error shape; this covers common ones.
 */
export const isMysqlDuplicateKeyError = (error: unknown): boolean =>
  someErrorInChain(error, (current) => {
    const { code, errno, sqlMessage } = current as {
      code?: unknown;
      errno?: unknown;
      sqlMessage?: unknown;
    };
    return (
      code === "ER_DUP_ENTRY" ||
      errno === 1062 ||
      hasDuplicateKeyText(current.message) ||
      (typeof sqlMessage === "string" && hasDuplicateKeyText(sqlMessage))
    );
  });

/**
 * Taken verbatim from what PlanetScale returns, e.g. "target: tnr.-.primary: vttablet: rpc
 * error: code = Aborted desc = Deadlock found when trying to get lock; try restarting
 * transaction (errno 1213)".
 */
export const DEADLOCK_MARKERS = [
  "Deadlock found",
  "errno 1213",
  "sqlstate 40001",
] as const;

/** MySQL / Vitess deadlock detection (errno 1213). */
export const isMysqlDeadlockError = (error: unknown): boolean =>
  someErrorInChain(error, ({ message }) =>
    DEADLOCK_MARKERS.some((marker) => message.includes(marker)),
  );

type DeadlockRetryOptions = {
  baseDelayMs?: number;
  /** Random extra delay, so concurrent retries stop colliding. */
  jitterMs?: number;
  onRetry?: (attempt: number, delayMs: number) => void;
};

/**
 * Run a mutation again when InnoDB picked it as a deadlock victim. Two single statements
 * can deadlock on index order alone, with no transaction anywhere, and InnoDB resolves it
 * at once by rolling one of them back, so the loser only needs another go. Only for work
 * that is safe to start over: every statement guarded, all progress durable. `jitterMs`
 * spreads retries of work that can collide with concurrent copies of itself.
 *
 * `createRetryingFetch` re-issues a deadlocked autocommit statement on its own, within a
 * budget meant for a waiting request. This covers what it leaves out: transactions,
 * multi-statement sequences, and bulk statements that can outlast that budget.
 */
export const retryOnDeadlock = async <T>(
  run: () => Promise<T>,
  attempts = 4,
  { baseDelayMs = 50, jitterMs = 0, onRetry }: DeadlockRetryOptions = {},
): Promise<T> => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (!isMysqlDeadlockError(error) || attempt >= attempts) throw error;
      const delayMs = baseDelayMs * 2 ** (attempt - 1) + Math.random() * jitterMs;
      onRetry?.(attempt, delayMs);
      await sleep(delayMs);
    }
  }
};
