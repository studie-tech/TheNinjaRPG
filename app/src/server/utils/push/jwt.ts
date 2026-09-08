/**
 * Minimal JWT signing for the two push providers. Both need a compact JWS with a raw
 * private key and nothing else — APNs signs its provider token with ES256, Google signs
 * its service-account assertion with RS256 — so this replaces a dependency that would
 * otherwise exist only to concatenate three base64url segments.
 */

import { createPrivateKey, sign as cryptoSign } from "node:crypto";

export type JwtAlgorithm = "ES256" | "RS256";

export const base64url = (input: Buffer | string): string =>
  Buffer.from(input).toString("base64url");

/**
 * Secret stores are overwhelmingly single-line, so PEM keys usually arrive with their
 * newlines escaped. Restore them before the parser sees the key.
 */
export const normalisePrivateKey = (key: string): string => key.replace(/\\n/g, "\n");

export interface SignJwtParams {
  algorithm: JwtAlgorithm;
  /** Merged into the header alongside `alg` and `typ`. */
  header?: Record<string, string>;
  claims: Record<string, string | number>;
  /** PEM-encoded private key, with real or escaped newlines. */
  privateKey: string;
}

export const signJwt = ({
  algorithm,
  header,
  claims,
  privateKey,
}: SignJwtParams): string => {
  const encodedHeader = base64url(
    JSON.stringify({ ...header, alg: algorithm, typ: "JWT" }),
  );
  const encodedClaims = base64url(JSON.stringify(claims));
  const signingInput = `${encodedHeader}.${encodedClaims}`;
  const key = createPrivateKey(normalisePrivateKey(privateKey));
  const signature = cryptoSign(
    "sha256",
    Buffer.from(signingInput),
    // Node emits DER-encoded ECDSA signatures by default; JOSE requires the raw r||s
    // pair, and APNs rejects the DER form outright.
    algorithm === "ES256" ? { key, dsaEncoding: "ieee-p1363" } : key,
  );
  return `${signingInput}.${base64url(signature)}`;
};
