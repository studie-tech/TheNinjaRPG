import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Redis } from "@upstash/redis";

// Read process.env directly (rather than the validated `env` module) so this
// crypto utility stays importable in unit tests without a full app env.
const isProduction = (): boolean => process.env.NODE_ENV === "production";

/**
 * Dev-client device tokens.
 *
 * The desktop dev client authenticates to the game's tRPC API without a Clerk
 * browser session. It signs in via the hosted /dev-connect page (which runs in
 * the browser with the user's existing Clerk session) and exchanges a
 * single-use PKCE code for a short-lived, signed device token. All subsequent
 * tRPC calls carry it as `Authorization: Bearer <token>`.
 *
 * Tokens are compact HS256-signed JWTs bound to a Clerk user id. Verification
 * is pure (no I/O) so it can run in the tRPC context creator and be unit
 * tested. Revocation is a Redis-side check, handled by the caller.
 */

const DEVICE_TOKEN_ISSUER = "tnr-dev-client";

// Device tokens are short-lived: the client re-authenticates through the
// browser (one click) when they expire.
export const DEVICE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const b64url = (input: string | Buffer): string =>
  Buffer.from(input).toString("base64url");

const sha256Hex = (input: string): string =>
  createHash("sha256").update(input).digest("hex");

export interface DeviceTokenClaims {
  /** Clerk user id. */
  sub: string;
  /** Unique token id, used for revocation. */
  jti: string;
  /** Issued-at, unix seconds. */
  iat: number;
  /** Expiry, unix seconds. */
  exp: number;
  /** Issuer marker. */
  iss: string;
}

/**
 * Resolve the signing secret. Uses a dedicated env var when present; falls
 * back to a derived key outside production so local development works, and
 * fails closed in production when the dedicated secret is missing.
 */
export const getDeviceTokenSecret = (): string => {
  if (process.env.DEV_CLIENT_TOKEN_SECRET) {
    return process.env.DEV_CLIENT_TOKEN_SECRET;
  }
  if (isProduction()) {
    throw new Error(
      "DEV_CLIENT_TOKEN_SECRET is required in production for dev-client device tokens.",
    );
  }
  const baseSecret = process.env.CAPTCHA_SALT ?? "dev-client-token-secret";
  return createHmac("sha256", baseSecret)
    .update("dev-client-token-key-v1")
    .digest("hex");
};

/**
 * Sign a device token for a user. Pure with respect to I/O (takes now + jti).
 */
export const signDeviceToken = (
  secret: string,
  userId: string,
  nowMs: number,
  jti: string = randomUUID(),
): string => {
  const iat = Math.floor(nowMs / 1000);
  const payload: DeviceTokenClaims = {
    sub: userId,
    jti,
    iat,
    exp: iat + Math.floor(DEVICE_TOKEN_TTL_MS / 1000),
    iss: DEVICE_TOKEN_ISSUER,
  };
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const signature = createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${signature}`;
};

export type DeviceTokenVerification =
  | { ok: true; userId: string; jti: string; exp: number }
  | { ok: false; error: string };

/**
 * Verify a device token's signature and claims. Pure — revocation is checked
 * separately (Redis).
 */
export const verifyDeviceToken = (
  secret: string,
  token: string,
  nowMs: number,
): DeviceTokenVerification => {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { ok: false, error: "malformed token" };
  }
  const [headerB64, bodyB64, signatureB64] = parts;
  if (!headerB64 || !bodyB64 || !signatureB64) {
    return { ok: false, error: "malformed token" };
  }

  let header: { alg?: string };
  try {
    header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8"));
  } catch {
    return { ok: false, error: "malformed header" };
  }
  if (header.alg !== "HS256") {
    return { ok: false, error: "unsupported algorithm" };
  }

  const expected = createHmac("sha256", secret)
    .update(`${headerB64}.${bodyB64}`)
    .digest();
  const actual = Buffer.from(signatureB64, "base64url");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { ok: false, error: "invalid signature" };
  }

  let payload: DeviceTokenClaims;
  try {
    payload = JSON.parse(Buffer.from(bodyB64, "base64url").toString("utf8"));
  } catch {
    return { ok: false, error: "malformed payload" };
  }

  if (payload.iss !== DEVICE_TOKEN_ISSUER) {
    return { ok: false, error: "unknown issuer" };
  }
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    return { ok: false, error: "missing subject" };
  }
  if (typeof payload.jti !== "string" || payload.jti.length === 0) {
    return { ok: false, error: "missing token id" };
  }
  const nowSec = Math.floor(nowMs / 1000);
  if (typeof payload.exp !== "number" || nowSec >= payload.exp) {
    return { ok: false, error: "token expired" };
  }
  if (typeof payload.iat !== "number" || payload.iat > nowSec + 60) {
    return { ok: false, error: "token not valid yet" };
  }

  return { ok: true, userId: payload.sub, jti: payload.jti, exp: payload.exp };
};

/**
 * Hash a single-use connect code. Codes are stored keyed by this hash so the
 * raw code never sits in Redis.
 */
export const hashConnectCode = (code: string): string => sha256Hex(code);

/**
 * Derive a PKCE S256 challenge from a code verifier (SHA-256, RFC 7636).
 */
export const pkceChallenge = (verifier: string): string =>
  createHash("sha256").update(verifier).digest("base64url");

/**
 * Compare a verifier against a stored challenge in constant time.
 */
export const verifierMatchesChallenge = (
  verifier: string,
  storedChallenge: string,
): boolean => {
  const candidate = Buffer.from(pkceChallenge(verifier), "utf8");
  const stored = Buffer.from(storedChallenge, "utf8");
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
};

// ---------------------------------------------------------------------------
// Single-use connect codes (Redis-backed). The browser-hosted /dev-connect
// page stores a short-lived code bound to (userId, PKCE challenge, state) and
// redirects the user's browser to the desktop client's loopback callback.
// The client exchanges the code + verifier for a device token.
// ---------------------------------------------------------------------------

const CONNECT_CODE_PREFIX = "dev-connect:code:";
export const CONNECT_CODE_TTL_SEC = 300;

export const storeConnectCode = async (
  code: string,
  record: { userId: string; challenge: string; state: string },
): Promise<void> => {
  const redis = Redis.fromEnv();
  await redis.set(
    `${CONNECT_CODE_PREFIX}${hashConnectCode(code)}`,
    JSON.stringify(record),
    { ex: CONNECT_CODE_TTL_SEC },
  );
};

/**
 * Atomically consume a connect code, verifying the PKCE verifier against the
 * stored challenge. Returns the bound user id, or null when the code is
 * unknown, expired, already used, or the verifier does not match.
 */
export const consumeConnectCode = async (
  code: string,
  codeVerifier: string,
): Promise<string | null> => {
  const redis = Redis.fromEnv();
  const stored = await redis.getdel(`${CONNECT_CODE_PREFIX}${hashConnectCode(code)}`);
  if (!stored || typeof stored !== "string") return null;

  let record: { userId: string; challenge: string; state?: string };
  try {
    record = JSON.parse(stored);
  } catch {
    return null;
  }
  if (typeof record.userId !== "string" || typeof record.challenge !== "string") {
    return null;
  }
  if (!verifierMatchesChallenge(codeVerifier, record.challenge)) return null;
  return record.userId;
};

// ---------------------------------------------------------------------------
// Revocation (Redis-backed). A revoked jti is stored until the token would
// have expired anyway, so the keyspace self-cleans.
// ---------------------------------------------------------------------------

const REVOCATION_PREFIX = "dev-client:revoked:";

/**
 * Mark a device token (by jti) as revoked until `untilMs`.
 */
export const revokeDeviceToken = async (
  jti: string,
  untilMs: number,
): Promise<void> => {
  const redis = Redis.fromEnv();
  const ttlSec = Math.max(1, Math.ceil((untilMs - Date.now()) / 1000));
  await redis.set(`${REVOCATION_PREFIX}${jti}`, "1", { ex: ttlSec });
};

/**
 * Check whether a device token (by jti) has been revoked. Fails open if the
 * limiter/Redis is unreachable in development (mirrors ratelimitMiddleware),
 * and fails closed in production.
 */
export const isDeviceTokenRevoked = async (jti: string): Promise<boolean> => {
  try {
    const redis = Redis.fromEnv();
    const exists = await redis.exists(`${REVOCATION_PREFIX}${jti}`);
    return (exists as number) > 0;
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        `Redis unreachable, allowing device token check to pass in dev: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
    throw error;
  }
};
