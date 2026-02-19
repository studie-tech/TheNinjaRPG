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
