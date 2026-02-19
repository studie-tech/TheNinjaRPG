export interface StackFrame {
  filename?: string;
}

/**
 * Parses stack trace string into structured stack frames.
 * @param stack - Stack trace string from Error.stack
 * @returns Array of stack frames with extracted filenames
 */
export const parseStackFrames = (stack?: string): Array<StackFrame> => {
  if (!stack) return [];
  return stack
    .split("\n")
    .slice(1) // Skip the first line (error message)
    .map((line) => {
      // Extract filename from stack trace line
      // Chrome/Firefox: "at functionName (filename:line:col)" or "at filename:line:col"
      // Safari: "functionName@filename:line:col"
      // Chrome format prioritizes parentheses content (file path), then falls back to non-parenthesized path
      const chromeMatch = line.match(/\(([^)]+)\)/);
      if (chromeMatch?.[1]) {
        return { filename: chromeMatch[1] };
      }
      // Fallback for "at filename:line:col" format (no function name)
      const directPathMatch = line.match(/at\s+([^\s]+)/);
      if (directPathMatch?.[1]?.includes(":")) {
        return { filename: directPathMatch[1] };
      }
      // Safari format
      const safariMatch = line.match(/@([^\s]+)/);
      return { filename: safariMatch?.[1] };
    })
    .filter((frame) => frame.filename);
};

/**
 * Extracts stack frames from an error's cause chain.
 * Commonly used for tRPC errors where the actual error is nested in error.cause.
 * @param error - Error object to extract stack frames from
 * @returns Stack frames from the error's cause, or undefined if not available
 */
export const extractStackFramesFromError = (error: {
  cause?: unknown;
}): Array<StackFrame> | undefined => {
  return error.cause instanceof Error && "stack" in error.cause
    ? parseStackFrames((error.cause as Error).stack)
    : undefined;
};

/**
 * Checks if an error originated from a specific source by examining stack frames.
 * @param error - Error object to check
 * @param sourcePatterns - Pattern(s) to match in stack frame filenames
 * @param expectedMessage - Optional expected message substring in error
 * @returns True if error is from specified source and contains expected message (if provided)
 */
export const isErrorFromSource = (
  error: Error,
  sourcePatterns: string | string[],
  expectedMessage?: string,
): boolean => {
  const stackFrames = parseStackFrames(error.stack);
  const patterns = Array.isArray(sourcePatterns) ? sourcePatterns : [sourcePatterns];
  const isFromSource =
    !stackFrames || stackFrames.length === 0
      ? false
      : stackFrames.some((frame) =>
          patterns.some((pattern) => frame.filename?.includes(pattern)),
        );
  return expectedMessage
    ? error.message.includes(expectedMessage) && isFromSource
    : isFromSource;
};

/**
 * Checks if stack frames indicate the error originated from tRPC client or fetch context.
 * Used to validate that retryable errors are actually network-related.
 * @param stackFrames - Stack frames to check
 * @returns true if from tRPC/fetch context or no stack available (likely network error)
 */
const isFromTrpcOrFetchContext = (stackFrames?: Array<StackFrame>): boolean => {
  // If no stack frames, assume network error (common for actual network failures)
  if (!stackFrames || stackFrames.length === 0) return true;
  // Check if any frame is from tRPC client or fetch context
  return stackFrames.some(
    (stackFrame) =>
      stackFrame.filename?.includes("@trpc/client") ||
      stackFrame.filename?.includes("fetch"),
  );
};

/**
 * Factory function to create error pattern matchers.
 * All matchers follow the same logic: check if message includes pattern, then validate with stack frames.
 * @param patterns - String pattern(s) to match in error message
 * @returns Matcher function that checks message and validates with stack frames
 */
const createErrorPatternMatcher =
  (patterns: string | string[]) =>
  (message?: string, stackFrames?: Array<StackFrame>): boolean => {
    if (!message) return false;
    const patternArray = Array.isArray(patterns) ? patterns : [patterns];
    if (!patternArray.some((pattern) => message.includes(pattern))) {
      return false;
    }
    return isFromTrpcOrFetchContext(stackFrames);
  };

/**
 * Individual pattern matchers for retryable errors.
 * Each matcher validates both the error message pattern and stack frame context.
 * These are typically transient network/CDN issues that should be retried automatically.
 */
export const isNetworkError = createErrorPatternMatcher([
  "Load failed",
  "fetch failed",
  "Failed to fetch",
  "Network request failed",
  "NetworkError",
  "network error", // Chrome/Android lowercase variant
]);

export const isOfflineError = createErrorPatternMatcher('"Offline" is not valid JSON');

export const isSafariJsonError = createErrorPatternMatcher(
  "The string did not match the expected pattern",
);

export const isProxyError = createErrorPatternMatcher(
  '"An error o"... is not valid JSON',
);

export const isHtmlResponseError = createErrorPatternMatcher(
  '"<!DOCTYPE "... is not valid JSON',
);

export const isFirefoxJsonError = createErrorPatternMatcher(
  "JSON.parse: unexpected character at line 1 column 1",
);

/**
 * Checks if an error message matches any retryable error pattern.
 * These errors are typically:
 * - Network failures (fetch errors, load failures)
 * - Browser offline states
 * - CDN/proxy returning HTML/text instead of JSON
 * - Browser-specific JSON parsing errors
 *
 * @param message - The error message to check
 * @param stackFrames - Optional stack trace frames for validation
 */
export const isRetryableError = (message?: string, stackFrames?: Array<StackFrame>) =>
  isNetworkError(message, stackFrames) ||
  isOfflineError(message, stackFrames) ||
  isSafariJsonError(message, stackFrames) ||
  isProxyError(message, stackFrames) ||
  isHtmlResponseError(message, stackFrames) ||
  isFirefoxJsonError(message, stackFrames);

/**
 * Convenience wrapper for checking if a tRPC error object is retryable.
 * Automatically extracts stack frames from the error's cause chain.
 *
 * @param error - Error object with optional cause chain (tRPC error structure)
 * @returns true if the error matches any retryable pattern
 */
export const isRetryableTrpcError = (error: {
  message?: string;
  cause?: unknown;
}): boolean => {
  const stackFrames = extractStackFramesFromError(error);
  return isRetryableError(error.message, stackFrames);
};

/**
 * Checks if an error originated from a fetch operation by examining its stack trace.
 * This helps verify error origin to prevent false matches with similarly-named errors.
 *
 * @param error - The error to check
 * @returns true if the error stack trace contains fetch-related patterns
 */
export const isFetchOriginError = (error: Error): boolean => {
  const stack = error.stack || "";
  return (
    /\bfetch\(/.test(stack) ||
    /node:internal\/deps\/undici/.test(stack) ||
    stack.includes("node:http") ||
    /\babort\(\)/.test(stack) ||
    stack.includes("AbortController")
  );
};
