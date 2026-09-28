import { createHash } from "node:crypto";
import { env } from "@/env/server.mjs";

/**
 * Visitor analytics (VisitorLog, AbEvent) store a keyed hash of the IP instead of the
 * address, and HistoricalIp carries the same hash so signups still join to their visit.
 * The same IP always yields the same hash, but without IP_HASH_SECRET it cannot be
 * reversed by hashing the IPv4 space.
 *
 * The hash is SHA-256(secret + ip) rather than an HMAC so that stored addresses can be
 * hashed in place with MySQL's `SHA2(CONCAT(secret, ip), 256)`, which yields the identical
 * value. Length extension is irrelevant: the hash only has to be unguessable, it never
 * authenticates a message.
 */
export const hashIp = (ip: string): string =>
  createHash("sha256")
    .update(getIpHashSecret() + ip)
    .digest("hex");

const getIpHashSecret = (): string => {
  if (env.IP_HASH_SECRET) return env.IP_HASH_SECRET;
  if (env.NODE_ENV === "production") {
    throw new Error("IP_HASH_SECRET must be configured in production");
  }
  return "development-ip-hash-secret";
};
