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
