/**
 * Utility functions for identifying retryable tRPC error patterns.
 * These errors are typically transient network/CDN issues that should be retried
 * automatically without showing errors to users.
 */

export const isNetworkError = (message?: string) =>
  message?.includes("Load failed") || message?.includes("fetch");

export const isOfflineError = (message?: string) =>
  message?.includes('"Offline" is not valid JSON');

export const isSafariJsonError = (message?: string) =>
  message?.includes("The string did not match the expected pattern");

export const isProxyError = (message?: string) =>
  message?.includes('"An error o"... is not valid JSON');

export const isHtmlResponseError = (message?: string) =>
  message?.includes('"<!DOCTYPE "... is not valid JSON');

export const isFirefoxJsonError = (message?: string) =>
  message?.includes("JSON.parse: unexpected character at line 1 column 1");

/**
 * Checks if an error message matches any retryable error pattern.
 * These errors are typically:
 * - Network failures (fetch errors, load failures)
 * - Browser offline states
 * - CDN/proxy returning HTML/text instead of JSON
 * - Browser-specific JSON parsing errors
 */
export const isRetryableError = (message?: string) =>
  isNetworkError(message) ||
  isOfflineError(message) ||
  isSafariJsonError(message) ||
  isProxyError(message) ||
  isHtmlResponseError(message) ||
  isFirefoxJsonError(message);
