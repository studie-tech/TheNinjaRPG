/** Player-facing message for a rate-limited read. */
export const QUERY_RATE_LIMIT_MESSAGE =
  "Too many requests for this page. Please wait a moment and try again.";

/** Player-facing message for a rate-limited action. */
export const MUTATION_RATE_LIMIT_MESSAGE =
  "You're moving too fast! Please wait a moment and try again.";

/**
 * Limiter rejections are expected traffic shaping, not defects: the server and edge
 * Sentry configs ignore them so a fast auto-combat run does not open an issue per deploy.
 */
export const RATE_LIMIT_MESSAGES = [
  QUERY_RATE_LIMIT_MESSAGE,
  MUTATION_RATE_LIMIT_MESSAGE,
] as const;
