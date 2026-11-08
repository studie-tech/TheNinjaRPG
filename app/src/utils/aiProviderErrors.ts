/** Matches provider messages for an exhausted balance or quota that carry no usable status. */
const QUOTA_MESSAGE =
  /no credits remaining|insufficient[_ ]quota|exceeded your current quota/i;

/**
 * Whether an AI provider rejected a request for quota, credits or rate limits (HTTP 429).
 * Reads OpenAI SDK errors (`status`, `code`, `type`), AI SDK `APICallError` (`statusCode`)
 * and walks `cause` and AI SDK `RetryError.lastError`, so wrapped errors are recognised.
 */
export const isAiProviderQuotaError = (error: unknown): boolean => {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    const { status, statusCode, code, type, message, cause, lastError } =
      current as Record<string, unknown>;
    if (status === 429 || statusCode === 429) return true;
    if (code === "insufficient_quota" || type === "insufficient_quota") return true;
    if (typeof message === "string" && QUOTA_MESSAGE.test(message)) return true;
    current = lastError ?? cause;
  }
  return false;
};
