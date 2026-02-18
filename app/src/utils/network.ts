import type { ReadonlyHeaders } from "next/dist/server/web/spec-extension/adapters/headers";

/**
 * Extract client IP address from request headers.
 * Checks x-forwarded-for first (for proxied requests), then x-real-ip as fallback.
 *
 * @param headers - Request headers (from Next.js Request or ReadonlyHeaders)
 * @returns Client IP address, or "unknown" if not found
 */
export const getClientIp = (headers: Headers | ReadonlyHeaders): string => {
  // Both Headers and ReadonlyHeaders have a get() method, so we can call it directly
  const forwarded = headers.get("x-forwarded-for");

  if (forwarded) {
    // x-forwarded-for can contain multiple IPs (client, proxy1, proxy2, ...)
    // First IP is the original client
    return forwarded.split(",")[0]?.trim() ?? "unknown";
  }

  const realIp = headers.get("x-real-ip");
  return realIp ?? "unknown";
};
