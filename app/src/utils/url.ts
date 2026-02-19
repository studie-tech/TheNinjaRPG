import * as Sentry from "@sentry/nextjs";
import { isFetchOriginError } from "@/utils/error";
import { fetchWithTimeout } from "@/utils/http";
import { isUrlSafeSynchronous } from "@/utils/ssrf";

/**
 * Check if a URL is accessible by making a HEAD request.
 * Used for validating external links before displaying them.
 * SECURITY: Validates URLs to prevent SSRF attacks against internal networks.
 *
 * @param url - URL to check
 * @returns true if URL is accessible (2xx-5xx status), false if network error or timeout
 */
export async function isUrlAccessible(url: string): Promise<boolean> {
  // SECURITY: Block SSRF attempts before making request
  if (!isUrlSafeSynchronous(url)) {
    console.log(`URL check blocked (SSRF protection): ${url}`);
    return false;
  }

  try {
    const response = await fetchWithTimeout(url, { method: "HEAD" }, 5000);
    console.log(`URL check (HEAD): ${url} - Status: ${response.status}`);
    return true;
  } catch (error: unknown) {
    if (error instanceof Error) {
      // Check stack trace to verify error origin before checking error type
      const isFetchError = isFetchOriginError(error);

      // Expected errors from fetch/timeout - check origin first to prevent false matches
      if (error.name === "AbortError" || (error.name === "TypeError" && isFetchError)) {
        console.log(`URL check failed (expected): ${url} - ${error.message}`);
        return false;
      }
      // Unexpected errors should be reported
      console.error(`URL check unexpected error: ${url}`, error);
      Sentry.captureException(error, { tags: { source: "url-accessibility-check" } });
    }
    return false;
  }
}

/**
 * Check if a URL appears within an <img> tag in content.
 * Used for determining how to handle broken links (img vs text link).
 *
 * @param content - HTML/text content to search
 * @param url - URL to find
 * @returns Object with isImg flag and optional fullTag if found in img
 */
export function isWithinImgTag(
  content: string,
  url: string,
): { isImg: boolean; fullTag?: string } {
  // Look for <img tags containing this URL
  const imgRegex = new RegExp(
    `<img[^>]*${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^>]*>`,
    "i",
  );
  const match = content.match(imgRegex);
  return match ? { isImg: true, fullTag: match[0] } : { isImg: false };
}
