import dns from "dns";
import { promisify } from "util";

const lookup = promisify(dns.lookup);

/**
 * Checks if an IP address is private, loopback, or link-local.
 */
export const isPrivateIp = (ip: string): boolean => {
  // IPv4 checks
  if (
    ip.startsWith("127.") || // Loopback
    ip.startsWith("10.") || // Class A private
    ip.startsWith("192.168.") // Class C private
  ) {
    return true;
  }
  if (ip.startsWith("172.")) {
    // Class B private (172.16.0.0 – 172.31.255.255)
    const parts = ip.split(".");
    if (parts.length === 4) {
      const second = parseInt(parts[1] || "0", 10);
      if (second >= 16 && second <= 31) return true;
    }
  }
  if (ip.startsWith("169.254.")) {
    // IPv4 Link-local
    return true;
  }

  // IPv6 checks
  if (
    ip === "::1" || // Loopback
    ip.toLowerCase().startsWith("fe80:") || // Link-local
    ip.toLowerCase().startsWith("fc00:") || // Unique local address (ULA)
    ip.toLowerCase().startsWith("fd00:") // Unique local address (ULA)
  ) {
    return true;
  }

  return false;
};

/**
 * Validates a URL for SSRF protection.
 * - Ensures protocol is http or https
 * - Checks against an optional allowlist of prefixes
 * - Resolves the hostname and ensures it's not a private IP
 */
export const validateUrlForSsrf = async (
  urlStr: string,
  allowedPrefixes?: string[],
): Promise<boolean> => {
  try {
    const url = new URL(urlStr);

    // Protocol check
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return false;
    }

    // Allowlist check (if provided)
    if (allowedPrefixes && allowedPrefixes.length > 0) {
      if (!allowedPrefixes.some((prefix) => urlStr.startsWith(prefix))) {
        return false;
      }
    }

    // Hostname resolution and IP check
    const { address } = await lookup(url.hostname);
    if (isPrivateIp(address)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
};
