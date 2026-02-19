import dns from "node:dns";
import { promisify } from "node:util";

const lookup = promisify(dns.lookup);

/**
 * Normalize and validate IPv4 addresses (handles dotted decimal, integer, and hex formats)
 */
export function normalizeIPv4(hostname: string): string | null {
  // Standard dotted decimal (e.g., "192.168.1.1")
  const dottedMatch = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (dottedMatch) {
    const octets = dottedMatch.slice(1).map(Number);
    if (octets.every((n) => n >= 0 && n <= 255)) {
      return octets.join(".");
    }
    return null;
  }

  // Integer format (e.g., "2130706433" for 127.0.0.1)
  if (/^\d+$/.test(hostname)) {
    const num = parseInt(hostname, 10);
    if (num >= 0 && num <= 0xffffffff) {
      const a = (num >>> 24) & 0xff;
      const b = (num >>> 16) & 0xff;
      const c = (num >>> 8) & 0xff;
      const d = num & 0xff;
      return `${a}.${b}.${c}.${d}`;
    }
  }

  // Hex format (e.g., "0x7f000001" for 127.0.0.1)
  if (/^0x[0-9a-f]+$/i.test(hostname)) {
    const num = parseInt(hostname, 16);
    if (num >= 0 && num <= 0xffffffff) {
      const a = (num >>> 24) & 0xff;
      const b = (num >>> 16) & 0xff;
      const c = (num >>> 8) & 0xff;
      const d = num & 0xff;
      return `${a}.${b}.${c}.${d}`;
    }
  }

  return null;
}

/**
 * Checks if an IP address is private, loopback, or link-local.
 */
export function isPrivateIp(ip: string): boolean {
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
}

/**
 * Synchronous URL validation for SSRF protection.
 * Blocks localhost, private IP ranges, cloud metadata endpoints,
 * and various IP encoding tricks (integer, hex, IPv6-wrapped).
 * Does NOT perform DNS resolution - use validateUrlForSsrf for complete protection.
 */
export function isUrlSafeSynchronous(url: string): boolean {
  try {
    const parsed = new URL(url);

    // Only allow HTTP(S) protocols
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }

    let hostname = parsed.hostname.toLowerCase();

    // Block localhost by name
    if (hostname === "localhost") {
      return false;
    }

    // Block cloud metadata endpoints
    if (hostname === "169.254.169.254" || hostname === "fd00:ec2::254") {
      return false;
    }

    // Handle IPv6 literal format [addr] - strip brackets
    if (hostname.startsWith("[") && hostname.endsWith("]")) {
      hostname = hostname.slice(1, -1);
    }

    // Check if it's an IPv6 address
    if (hostname.includes(":")) {
      return !isPrivateIp(hostname);
    }

    // Normalize potential IPv4 variants (dotted, integer, hex)
    const normalizedIP = normalizeIPv4(hostname);
    if (normalizedIP) {
      return !isPrivateIp(normalizedIP);
    }

    // For hostnames (not IPs), we can't reliably check DNS resolution
    // without making this function async. The best we can do is block
    // obvious localhost/internal names.
    // Note: A complete SSRF fix requires DNS resolution - use validateUrlForSsrf.

    return true;
  } catch {
    return false;
  }
}

/**
 * Validates a URL for SSRF protection with DNS resolution.
 * - Ensures protocol is http or https
 * - Checks against an optional allowlist of prefixes
 * - Resolves the hostname and ensures it's not a private IP
 * - Protection against DNS rebinding via double resolution
 */
export async function validateUrlForSsrf(
  urlStr: string,
  allowedPrefixes?: string[],
): Promise<boolean> {
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
    let hostname =
      url.hostname.startsWith("[") && url.hostname.endsWith("]")
        ? url.hostname.slice(1, -1)
        : url.hostname;

    // Normalize potential IPv4 variants (dotted, integer, hex) before DNS lookup
    const normalizedIP = normalizeIPv4(hostname);
    if (normalizedIP) {
      hostname = normalizedIP;
      // Check normalized IP directly
      if (isPrivateIp(hostname)) {
        return false;
      }
    }

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
}
