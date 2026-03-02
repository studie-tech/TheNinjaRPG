/**
 * Utility functions for identifying retryable tRPC error patterns.
 * These errors are typically transient network/CDN issues that should be retried
 * automatically without showing errors to users.
 */

import type { StackFrame } from "@/utils/error";
import { extractStackFramesFromError } from "@/utils/error";

/**
 * Checks if stack frames indicate the error originated from tRPC client or fetch context.
 * Used to validate that retryable errors are actually network-related.
 * @param stackFrames - Stack frames to check
 * @returns true if from tRPC/fetch context or no stack available (likely network error)
 */
const isFromTrpcOrFetchContext = (stackFrames?: Array<StackFrame>): boolean => {
  if (!stackFrames || stackFrames.length === 0) return true; // Likely network error
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
 * Individual pattern matchers exported for reuse in other modules (e.g., Sentry filtering).
 * Each matcher validates both the error message pattern and stack frame context.
 */
export const isNetworkError = createErrorPatternMatcher([
  "Load failed",
  "fetch failed",
  "Failed to fetch",
  "Network request failed",
  "NetworkError",
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
