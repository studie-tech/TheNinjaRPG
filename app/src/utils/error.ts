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
 * A browser extension that bundles its content scripts as executors/<n>.js. The frames
 * carry the page's origin, so Sentry files them under this project even though no code
 * of ours appears anywhere in the stack.
 */
const EXTENSION_EXECUTOR_PATH = /(^|\/)executors\/\d+\.js$/;

/**
 * True only when EVERY frame comes from that extension bundle. Requiring all of them
 * keeps a genuine error of ours that merely passes through an extension frame reportable.
 */
export const isExtensionExecutorStack = (paths: Array<string | undefined>): boolean =>
  paths.length > 0 &&
  paths.every((path) => !!path && EXTENSION_EXECUTOR_PATH.test(path));

/**
 * A chained error arrives as several exception values, and only one of them has to
 * contain our code for the event to be worth keeping - so every value must be
 * executor-only, and an event carrying none at all is never dropped.
 */
export const isExtensionExecutorEvent = (
  stacks: Array<Array<string | undefined>>,
): boolean => stacks.length > 0 && stacks.every(isExtensionExecutorStack);

/**
 * Wallet extensions reject with a plain object when a wallet is injected but has no
 * account. The game has no Web3 surface, so the page keeps working.
 */
export const isInjectedWalletRejection = (reason: unknown): boolean => {
  if (!reason || typeof reason !== "object") return false;
  const record = reason as { code?: unknown; message?: unknown };
  const message = typeof record.message === "string" ? record.message : "";
  if (message.includes("wallet must has at least one account")) return true;
  return record.code === 4001 && /wallet/i.test(message);
};

/** Messages the PayPal SDK raises when its buttons or popup close mid-flight. */
export const PAYPAL_CLEANUP_PATTERNS = [
  "zoid destroyed",
  "popup close",
  "Window closed",
  "Component closed",
  "Target window is closed",
];

/**
 * Users navigating away while PayPal buttons initialize, or closing the popup before the
 * transaction completes. Checkout stays silent on these, so a pattern added here hides
 * that failure from the player.
 */
export const isPayPalCleanupError = (err: unknown): boolean => {
  const message = err?.toString() ?? "";
  return PAYPAL_CLEANUP_PATTERNS.some((pattern) => message.includes(pattern));
};

/**
 * A stack line whose script came from a domain or its subdomains, as V8
 * ("at fn (url:1:2)", "at url:1:2") or Firefox and Safari ("fn@url:1:2") print it.
 */
const stackLineFromDomain = (domain: string, path = "[/?#]") =>
  new RegExp(
    `(?:^\\s*at (?:[^():\\n]*\\()?|^[^@:\\n]*@)https?://(?:[a-z0-9-]+\\.)*${domain}(?::\\d+)?${path}`,
    "im",
  );

/** The hosts the CSP lets serve PayPal scripts. */
const PAYPAL_STACK_LINE = stackLineFromDomain("paypal(?:objects)?\\.com");
/** Match consent scripts only on Cookiebot's domain or its subdomains. */
const COOKIEBOT_STACK_LINE = stackLineFromDomain("cookiebot\\.com");
/** Only gtag.js: GTM's own script can wrap our calls and sit on the stack of our errors. */
const GOOGLE_TAG_STACK_LINE = stackLineFromDomain(
  "googletagmanager\\.com",
  "/gtag/js[?#:]",
);

/**
 * True when a raw `Error.stack` ran through PayPal's own hosts. Takes the raw stack because
 * the Next.js SDK replaces each Sentry frame's origin with `app://` before `beforeSend`.
 */
export const isPayPalSdkStack = (stack: string | undefined): boolean =>
  !!stack && PAYPAL_STACK_LINE.test(stack);

/** True when a raw `Error.stack` ran through Cookiebot's hosts, as for PayPal above. */
export const isCookiebotStack = (stack: string | undefined): boolean =>
  !!stack && COOKIEBOT_STACK_LINE.test(stack);

/** True when a raw `Error.stack` ran through Google's gtag script, as for PayPal above. */
export const isGoogleTagStack = (stack: string | undefined): boolean =>
  !!stack && GOOGLE_TAG_STACK_LINE.test(stack);

/** A script a browser or in-app webview injects; it has no host of its own to validate. */
const INJECTED_CONTENT_PATH = /(^|\/)inject_content\.js([?#]|$)/;

/** True for a frame path whose file is exactly that injected script. */
export const isInjectedContentPath = (path: string | undefined): boolean =>
  !!path && INJECTED_CONTENT_PATH.test(path);

/** A script in-app browsers inject around media; it has no host of its own to validate. */
const MEDIA_FILTER_PATH = /(^|\/)mediafilter(\.js)?([?#]|$)/;

/** True for a frame path whose file is exactly that injected script. */
export const isMediaFilterPath = (path: string | undefined): boolean =>
  !!path && MEDIA_FILTER_PATH.test(path);

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

interface InputIssue {
  code?: string;
  origin?: string;
  minimum?: number | bigint;
  maximum?: number | bigint;
  path?: PropertyKey[];
  message?: string;
}

/**
 * Readable message for a failed tRPC call. Input validation failures carry their Zod
 * issues in `data.zodError` and an error message of raw issue JSON, so those issues are
 * phrased per field instead; any other error keeps its message.
 */
export const formatTrpcErrorMessage = (error: { message: string; data?: unknown }) => {
  const issues = (error.data as { zodError?: InputIssue[] | null } | undefined)
    ?.zodError;
  if (!Array.isArray(issues) || issues.length === 0) return error.message;
  return issues
    .map((issue) => {
      const field = issue.path?.map(String).join(".") ?? "";
      const label = field ? field.charAt(0).toUpperCase() + field.slice(1) : "Input";
      if (issue.origin === "string" && issue.code === "too_small") {
        return `${label} must be at least ${issue.minimum} characters.`;
      }
      if (issue.origin === "string" && issue.code === "too_big") {
        return `${label} must be at most ${issue.maximum} characters.`;
      }
      return `${label}: ${issue.message ?? "invalid value"}`;
    })
    .join(" ");
};
