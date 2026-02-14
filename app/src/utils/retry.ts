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
  /** Custom function to determine if an error is transient (default: checks status 502/503) */
  isTransient?: (error: unknown) => boolean;
}

/**
 * Check if an error is a transient server error that should be retried.
 * Uses structured error detection via status property for API errors,
 * with fallback to string matching for compatibility.
 */
export const isTransientError = (error: unknown): boolean => {
  if (error && typeof error === "object") {
    // Check for status property (used by Replicate SDK and other API clients)
    const status = (error as { status?: number }).status;
    if (status === 502 || status === 503) {
      return true;
    }

    // Fallback: check error message for HTTP status codes
    if (error instanceof Error) {
      const message = error.message;
      return (
        message.includes("502") ||
        message.includes("503") ||
        message.includes("Bad Gateway") ||
        message.includes("Service Unavailable")
      );
    }
  }
  return false;
};

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
    isTransient = isTransientError,
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
