/**
 * Retry utility for handling transient errors with exponential backoff
 */

export interface RetryOptions {
  /** Maximum number of retries (default: 2) */
  maxRetries?: number;
  /** Base delay in milliseconds for exponential backoff (default: 1000) */
  baseDelayMs?: number;
  /** Maximum total time budget in milliseconds before giving up (default: 30000) */
  deadlineMs?: number;
  /** Whether an error is worth retrying (default: every error) */
  isTransient?: (error: unknown) => boolean;
}

/**
 * Execute an async function with retry logic for transient errors.
 * Uses exponential backoff with jitter and respects an overall time budget.
 *
 * @param fn - The async function to execute
 * @param options - Retry configuration options
 * @returns The result of the function
 * @throws The last error if all retries fail or deadline is exceeded
 *
 * @example
 * ```ts
 * const result = await withRetry(
 *   () => fetch('/api/data'),
 *   { maxRetries: 3, deadlineMs: 10000 }
 * );
 * ```
 */
export const withRetry = async <T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> => {
  const {
    maxRetries = 2,
    baseDelayMs = 1000,
    deadlineMs = 30000,
    isTransient = () => true,
  } = options;

  const startTime = Date.now();
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Check if we've exceeded the overall deadline
    const elapsed = Date.now() - startTime;
    if (attempt > 0 && elapsed >= deadlineMs) {
      throw lastError;
    }

    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if we should retry
      const isLastAttempt = attempt >= maxRetries;
      const isTransientError = isTransient(error);
      const remainingTime = deadlineMs - (Date.now() - startTime);

      if (isLastAttempt || !isTransientError || remainingTime <= 0) {
        throw error;
      }

      // Calculate delay with exponential backoff and jitter
      const exponentialDelay = baseDelayMs * 2 ** attempt;
      const jitter = Math.random() * 500;
      const delay = Math.min(exponentialDelay + jitter, remainingTime);

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
};
