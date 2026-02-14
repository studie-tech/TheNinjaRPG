import dns from "node:dns";
import { promisify } from "node:util";

const lookup = promisify(dns.lookup);

/**
 * Checks if an IP address is private, loopback, or link-local.
 */
export const isPrivateIp = (ip: string): boolean => {
  // IPv4 checks
  if (
    ip.startsWith("127.") || // Loopback
    ip.startsWith("10.") || // Class A private
    ip.startsWith("192.168.") || // Class C private
    ip.startsWith("0.") || // Current network (critical for SSRF)
    ip.startsWith("169.254.") // IPv4 Link-local
  ) {
    return true;
  }

  // Range checks for IPv4
  const parts = ip.split(".");
  if (parts.length === 4) {
    const first = parseInt(parts[0] || "0", 10);
    const second = parseInt(parts[1] || "0", 10);

    // Class B private (172.16.0.0 – 172.31.255.255)
    if (first === 172 && second >= 16 && second <= 31) return true;

    // Shared address space (CGNAT) (100.64.0.0/10: 100.64.0.0 – 100.127.255.255)
    if (first === 100 && second >= 64 && second <= 127) return true;

    // Benchmark testing (198.18.0.0/15: 198.18.0.0 – 198.19.255.255)
    if (first === 198 && (second === 18 || second === 19)) return true;

    // Multicast (224.0.0.0/4) & Reserved (240.0.0.0/4)
    if (first >= 224) return true;
  }

  // IPv6 checks
  const ipv6 = ip.toLowerCase();
  if (
    ipv6 === "::1" || // Loopback
    ipv6 === "::" || // Unspecified address
    ipv6.startsWith("fe80:") || // Link-local
    ipv6.startsWith("fc00:") || // Unique local address (ULA)
    ipv6.startsWith("fd00:") || // Unique local address (ULA)
    ipv6.startsWith("ff00:") // Multicast
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
 * - Protection against DNS rebinding via double resolution
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
    if (allowedPrefixes) {
      if (allowedPrefixes.length === 0) {
        return false;
      }
      if (!allowedPrefixes.some((prefix) => urlStr.startsWith(prefix))) {
        return false;
      }
    }

    // Normalize IPv6 hostnames (remove brackets)
    const hostname =
      url.hostname.startsWith("[") && url.hostname.endsWith("]")
        ? url.hostname.slice(1, -1)
        : url.hostname;

    // DNS lookup with timeout
    const timedLookup = async (host: string) => {
      return Promise.race([
        lookup(host),
        new Promise<{ address: string }>((_, reject) =>
          setTimeout(() => reject(new Error("DNS lookup timeout")), 3000),
        ),
      ]);
    };

    // First DNS resolution
    const { address: addr1 } = await timedLookup(hostname);
    if (isPrivateIp(addr1)) {
      return false;
    }

    // Short delay to mitigate DNS rebinding
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Second independent DNS resolution
    const { address: addr2 } = await timedLookup(hostname);
    if (isPrivateIp(addr2)) {
      return false;
    }

    // Ensure both resolutions match to prevent rebinding
    if (addr1 !== addr2) {
      return false;
    }

    return true;
  } catch (error) {
    console.error("SSRF validation error:", error);
    return false;
  }
};
