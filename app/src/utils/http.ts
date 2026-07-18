import { type RetryOptions, withRetry } from "@/utils/retry";

/**
 * Fetch a URL with an automatic timeout using AbortController.
 * Ensures cleanup of timeout regardless of success or failure.
 *
 * @param url - URL to fetch
 * @param options - Fetch options (RequestInit)
 * @param timeoutMs - Timeout in milliseconds (default: 10000ms)
 * @returns Response from fetch
 * @throws AbortError if timeout is reached
 */
export const fetchWithTimeout = async (
  url: string,
  options: RequestInit = {},
  timeoutMs: number = 10000,
): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
};

/**
 * Fetch with a per-attempt timeout AND retries: composes fetchWithTimeout with
 * withRetry. Non-2xx responses throw (and are retried), so callers always get
 * a usable Response. Every attempt issues a FRESH request, so the body is
 * never pre-consumed by retry internals - unlike the fetch-retry package this
 * replaced (THENINJARPG-2GY), no response.clone() workaround is needed. By
 * default ANY failure retries (network error, timeout, non-2xx), which fits
 * asset/CDN fetches; pass retry.isTransient to be selective.
 */
export const fetchWithRetry = (
  url: string,
  options: RequestInit = {},
  timeoutMs = 10000,
  retry: RetryOptions = {},
): Promise<Response> => {
  return withRetry(
    async () => {
      const response = await fetchWithTimeout(url, options, timeoutMs);
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return response;
    },
    { isTransient: () => true, ...retry },
  );
};
