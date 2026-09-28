import { createHash } from "node:crypto";
import { env } from "@/env/server.mjs";

/**
 * Visitor analytics (VisitorLog, AbEvent) store a keyed hash of the IP instead of the
 * address, and HistoricalIp carries the same hash so signups still join to their visit.
 * The same IP always yields the same hash, but without IP_HASH_SECRET it cannot be
 * reversed by hashing the IPv4 space.
 *
 * The construction is SHA-256(secret + ip), which MySQL reproduces as
 * `SHA2(CONCAT(secret, ip), 256)`; stored hashes depend on it, so it cannot change without
 * breaking every join. Length extension is irrelevant: the hash only has to be
 * unguessable, it never authenticates a message.
 */
export const hashIp = (ip: string): string => hashIpWithKey(ip, getIpHashSecret());

export const hashIpWithKey = (ip: string, key: string): string =>
  createHash("sha256")
    .update(key + ip)
    .digest("hex");

const getIpHashSecret = (): string => {
  if (env.IP_HASH_SECRET) return env.IP_HASH_SECRET;
  if (env.NODE_ENV === "production") {
    throw new Error("IP_HASH_SECRET must be configured in production");
  }
  return "development-ip-hash-secret";
};
