/**
 * Utility functions for identifying retryable tRPC error patterns.
 * These errors are typically transient network/CDN issues that should be retried
 * automatically without showing errors to users.
 */

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
      const chromeMatch = line.match(/\(([^)]+)\)|at\s+([^\s]+)/);
      const safariMatch = line.match(/@([^\s]+)/);
      return { filename: chromeMatch?.[1] || chromeMatch?.[2] || safariMatch?.[1] };
    })
    .filter((frame) => frame.filename);
};

const isNetworkError = (message?: string, stackFrames?: Array<StackFrame>): boolean => {
  if (!message) return false;
  const networkErrorPatterns = [
    "Load failed",
    "fetch failed",
    "Failed to fetch",
    "Network request failed",
    "NetworkError",
  ];
  if (!networkErrorPatterns.some((pattern) => message.includes(pattern))) {
    return false;
  }
  // Verify it's from fetch API or tRPC client
  return (
    stackFrames?.some(
      (frame) =>
        frame.filename?.includes("@trpc/client") ||
        frame.filename?.includes("fetch") ||
        frame.filename === "", // Browser-level network errors have no stack
    ) ?? true
  ); // Allow if no stack available (browser errors)
};

/**
 * Checks if stack frames indicate the error originated from tRPC client or fetch context.
 * Used to validate that retryable errors are actually network-related.
 * @param stackFrames - Stack frames to check
 * @returns true if from tRPC/fetch context or no stack available (likely network error)
 */
const isFromTrpcOrFetchContext = (stackFrames?: Array<StackFrame>): boolean => {
  if (!stackFrames || stackFrames.length === 0) return true; // Likely network error
  return stackFrames.some(
    (frame) =>
      frame.filename?.includes("@trpc/client") || frame.filename?.includes("fetch"),
  );
};

const isOfflineError = (message?: string, stackFrames?: Array<StackFrame>): boolean => {
  if (!message?.includes('"Offline" is not valid JSON')) return false;
  return isFromTrpcOrFetchContext(stackFrames);
};

const isSafariJsonError = (
  message?: string,
  stackFrames?: Array<StackFrame>,
): boolean => {
  if (!message?.includes("The string did not match the expected pattern")) return false;
  return isFromTrpcOrFetchContext(stackFrames);
};

const isProxyError = (message?: string, stackFrames?: Array<StackFrame>): boolean => {
  if (!message?.includes('"An error o"... is not valid JSON')) return false;
  return isFromTrpcOrFetchContext(stackFrames);
};

const isHtmlResponseError = (
  message?: string,
  stackFrames?: Array<StackFrame>,
): boolean => {
  if (!message?.includes('"<!DOCTYPE "... is not valid JSON')) return false;
  return isFromTrpcOrFetchContext(stackFrames);
};

const isFirefoxJsonError = (
  message?: string,
  stackFrames?: Array<StackFrame>,
): boolean => {
  if (!message?.includes("JSON.parse: unexpected character at line 1 column 1"))
    return false;
  return isFromTrpcOrFetchContext(stackFrames);
};

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
