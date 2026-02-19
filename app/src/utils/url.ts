import * as Sentry from "@sentry/nextjs";
import { isFetchOriginError } from "@/utils/error";
import { fetchWithTimeout } from "@/utils/http";

/**
 * Validate URL to prevent SSRF attacks.
 * Blocks localhost, private IP ranges, and cloud metadata endpoints.
 */
const isUrlSafe = (url: string): boolean => {
  try {
    const parsed = new URL(url);

    // Only allow HTTP(S) protocols
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }

    const hostname = parsed.hostname.toLowerCase();

    // Block localhost and loopback
    if (
      hostname === "localhost" ||
      hostname === "0.0.0.0" ||
      hostname.startsWith("127.") ||
      hostname === "::1" ||
      hostname === "0000:0000:0000:0000:0000:0000:0000:0001"
    ) {
      return false;
    }

    // Block cloud metadata endpoints
    if (hostname === "169.254.169.254" || hostname === "fd00:ec2::254") {
      return false;
    }

    // Block private IP ranges (IPv4)
    const ipv4Match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipv4Match) {
      const octets = ipv4Match.slice(1).map(Number);
      const [a, b, c, d] = octets;
      if (
        a === 10 || // 10.0.0.0/8
        (a === 172 && b !== undefined && b >= 16 && b <= 31) || // 172.16.0.0/12
        (a === 192 && b === 168) || // 192.168.0.0/16
        a === 0 || // 0.0.0.0/8
        (a === 169 && b === 254) // 169.254.0.0/16 (link-local)
      ) {
        return false;
      }
    }

    // Block private IPv6 ranges (simplified - blocks fc00::/7 and fe80::/10)
    if (
      hostname.includes(":") &&
      (hostname.startsWith("fc") ||
        hostname.startsWith("fd") ||
        hostname.startsWith("fe80"))
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
};

/**
 * Check if a URL is accessible by making a HEAD request.
 * Used for validating external links before displaying them.
 * SECURITY: Validates URLs to prevent SSRF attacks against internal networks.
 *
 * @param url - URL to check
 * @returns true if URL is accessible (2xx-5xx status), false if network error or timeout
 */
export const isUrlAccessible = async (url: string): Promise<boolean> => {
  // SECURITY: Block SSRF attempts before making request
  if (!isUrlSafe(url)) {
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
};

/**
 * Check if a URL appears within an <img> tag in content.
 * Used for determining how to handle broken links (img vs text link).
 *
 * @param content - HTML/text content to search
 * @param url - URL to find
 * @returns Object with isImg flag and optional fullTag if found in img
 */
export const isWithinImgTag = (
  content: string,
  url: string,
): { isImg: boolean; fullTag?: string } => {
  // Look for <img tags containing this URL
  const imgRegex = new RegExp(
    `<img[^>]*${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^>]*>`,
    "i",
  );
  const match = content.match(imgRegex);
  return match ? { isImg: true, fullTag: match[0] } : { isImg: false };
};
