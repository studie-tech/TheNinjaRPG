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

  const ipv6 = parseIPv6(ip);
  if (!ipv6) return false;

  return isPrivateIpv6(ipv6);
}

/** Classify non-public and IPv4-transition IPv6 ranges. */
function isPrivateIpv6(ipv6: number[]): boolean {
  const first = ipv6[0] ?? 0;
  const isUnspecified = ipv6.every((part) => part === 0);
  const isLoopback = ipv6.slice(0, 7).every((part) => part === 0) && ipv6[7] === 1;
  const isLinkLocal = (first & 0xffc0) === 0xfe80; // fe80::/10
  const isUniqueLocal = (first & 0xfe00) === 0xfc00; // fc00::/7
  const isMulticast = (first & 0xff00) === 0xff00; // ff00::/8

  // Transition mechanisms can route an apparently public IPv6 address to an
  // embedded IPv4 destination. Block the entire ranges so private IPv4 targets
  // cannot bypass the IPv4 checks above.
  const isWellKnownNat64 =
    ipv6[0] === 0x0064 &&
    ipv6[1] === 0xff9b &&
    ipv6.slice(2, 6).every((part) => part === 0); // 64:ff9b::/96
  const isLocalUseNat64 =
    ipv6[0] === 0x0064 && ipv6[1] === 0xff9b && ipv6[2] === 0x0001; // 64:ff9b:1::/48
  const is6to4 = ipv6[0] === 0x2002; // 2002::/16
  const isTeredo = ipv6[0] === 0x2001 && ipv6[1] === 0x0000; // 2001::/32
  const isIpv4Mapped =
    ipv6.slice(0, 5).every((part) => part === 0) && ipv6[5] === 0xffff; // ::ffff:0:0/96
  const isIpv4Compatible = ipv6.slice(0, 6).every((part) => part === 0); // ::/96

  return (
    isUnspecified ||
    isLoopback ||
    isLinkLocal ||
    isUniqueLocal ||
    isMulticast ||
    isWellKnownNat64 ||
    isLocalUseNat64 ||
    is6to4 ||
    isTeredo ||
    isIpv4Mapped ||
    isIpv4Compatible
  );
}

/** Parse an IPv6 address into eight 16-bit words for prefix-safe comparisons. */
function parseIPv6(ip: string): number[] | null {
  try {
    const hostname = new URL(`http://[${ip}]/`).hostname;
    const normalized = hostname.slice(1, -1);
    const halves = normalized.split("::");
    if (halves.length > 2) return null;

    const left = halves[0] ? halves[0].split(":") : [];
    const right = halves[1] ? halves[1].split(":") : [];
    const omitted = 8 - left.length - right.length;

    if ((halves.length === 1 && omitted !== 0) || omitted < 0) return null;

    const words = [...left, ...Array<number>(omitted).fill(0), ...right].map((part) =>
      typeof part === "number" ? part : Number.parseInt(part, 16),
    );

    return words.length === 8 && words.every(Number.isFinite) ? words : null;
  } catch {
    return null;
  }
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
  } catch {
    return false;
  }
}
