import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { Redis } from "@upstash/redis";

// Read process.env directly (rather than the validated `env` module) so this
// crypto utility stays importable in unit tests without a full app env.
const nodeEnv = (): string => process.env.NODE_ENV ?? "";

/**
 * Dev-client device tokens.
 *
 * The desktop dev client authenticates to the game's tRPC API without a Clerk
 * browser session. It signs in via the hosted /dev-connect page (which runs in
 * the browser with the user's existing Clerk session) and exchanges a
 * single-use PKCE code for a short-lived, signed device token. All subsequent
 * tRPC calls carry it as `Authorization: Bearer <token>`.
 *
 * Tokens are compact HS256-signed JWTs bound to a Clerk user id. Signature
 * verification is pure (no I/O) so it can run in the tRPC context creator and
 * be unit tested. Revocation is a Redis-side check, handled by the caller.
 */

const DEVICE_TOKEN_ISSUER = "tnr-dev-client";

// Device tokens are short-lived: the client re-authenticates through the
// browser (one click) when they expire. Kept deliberately short because the
// token authenticates as the user, so a leaked one is costly.
export const DEVICE_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

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
 * Resolve the signing secret.
 *
 * Fails closed unless a dedicated secret is configured. The local-development
 * fallback is gated on an explicit `development`/`test` NODE_ENV rather than on
 * "not production", because every other value (staging, preview, unset) is an
 * internet-reachable deployment where a repo-derivable key would let anyone
 * mint a token for any user id.
 */
export const getDeviceTokenSecret = (): string => {
  if (process.env.DEV_CLIENT_TOKEN_SECRET) {
    return process.env.DEV_CLIENT_TOKEN_SECRET;
  }
  const env = nodeEnv();
  if (env !== "development" && env !== "test") {
    throw new Error(
      "DEV_CLIENT_TOKEN_SECRET is required outside local development for dev-client device tokens.",
    );
  }
  const baseSecret = process.env.CAPTCHA_SALT ?? "dev-client-token-secret";
  return createHmac("sha256", baseSecret)
    .update("dev-client-token-key-v1")
    .digest("hex");
};

/** True when device-token auth is usable at all (a secret is resolvable). */
export const isDeviceTokenAuthConfigured = (): boolean => {
  try {
    getDeviceTokenSecret();
    return true;
  } catch {
    return false;
  }
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
  | { ok: true; userId: string; jti: string; iat: number; exp: number }
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

  return {
    ok: true,
    userId: payload.sub,
    jti: payload.jti,
    iat: payload.iat,
    exp: payload.exp,
  };
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
// page stores a short-lived code bound to (userId, PKCE challenge) and
// redirects the user's browser to the desktop client's loopback callback.
// The client exchanges the code + verifier for a device token.
//
// NOTE: the OAuth `state` parameter is verified by the desktop client when the
// browser hits its loopback callback; it is deliberately not stored here, so
// nothing in this module implies a server-side binding it does not enforce.
// ---------------------------------------------------------------------------

const CONNECT_CODE_PREFIX = "dev-connect:code:";
export const CONNECT_CODE_TTL_SEC = 300;

export const storeConnectCode = async (
  code: string,
  record: { userId: string; challenge: string },
): Promise<void> => {
  const redis = Redis.fromEnv();
  await redis.set(
    `${CONNECT_CODE_PREFIX}${hashConnectCode(code)}`,
    JSON.stringify({ userId: record.userId, challenge: record.challenge }),
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
  if (!stored) return null;

  let record: { userId?: unknown; challenge?: unknown };
  try {
    record = typeof stored === "string" ? JSON.parse(stored) : (stored as never);
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
// GitHub ownership challenge. Rewards are paid against the profile's GitHub
// login, so that login may only be set by proving control of the account: the
// server issues a nonce, the user publishes it in a gist, and the server reads
// the gist back and checks the owner.
// ---------------------------------------------------------------------------

const GITHUB_NONCE_PREFIX = "dev-client:gh-nonce:";
export const GITHUB_NONCE_TTL_SEC = 30 * 60;

const nonceKey = (userId: string, login: string) =>
  `${GITHUB_NONCE_PREFIX}${userId}:${login.toLowerCase()}`;

export const storeGithubVerificationNonce = async (
  userId: string,
  login: string,
): Promise<string> => {
  const redis = Redis.fromEnv();
  const nonce = `tnr-verify-${randomBytes(16).toString("hex")}`;
  await redis.set(nonceKey(userId, login), nonce, { ex: GITHUB_NONCE_TTL_SEC });
  return nonce;
};

export const consumeGithubVerificationNonce = async (
  userId: string,
  login: string,
): Promise<string | null> => {
  const redis = Redis.fromEnv();
  const stored = await redis.getdel(nonceKey(userId, login));
  return typeof stored === "string" && stored.length > 0 ? stored : null;
};

// ---------------------------------------------------------------------------
// Revocation (Redis-backed).
//
// Two mechanisms: a per-token jti tombstone (used by the desktop client's own
// "sign out"), and a per-user epoch that invalidates every token issued before
// it. The epoch is what makes a leaked token recoverable — the owner can cut it
// off from an ordinary browser session, without needing to hold the token.
// ---------------------------------------------------------------------------

const REVOCATION_PREFIX = "dev-client:revoked:";
const EPOCH_PREFIX = "dev-client:epoch:";

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

/** Invalidate every device token issued to this user before now. */
export const revokeAllDeviceTokensForUser = async (
  userId: string,
  nowMs: number = Date.now(),
): Promise<void> => {
  const redis = Redis.fromEnv();
  await redis.set(`${EPOCH_PREFIX}${userId}`, Math.floor(nowMs / 1000), {
    ex: Math.ceil(DEVICE_TOKEN_TTL_MS / 1000) + 60,
  });
};

/**
 * Is this token still usable? Checks the per-token tombstone and the per-user
 * epoch in a single Redis round-trip.
 *
 * Fails open only in local development (where Redis is often absent, mirroring
 * ratelimitMiddleware) and fails closed everywhere else — an unreachable Redis
 * must not silently disable revocation on a live deployment.
 */
export const isDeviceTokenActive = async (params: {
  jti: string;
  userId: string;
  iat: number;
}): Promise<boolean> => {
  try {
    const redis = Redis.fromEnv();
    const [revoked, epoch] = await redis.mget<[unknown, unknown]>(
      `${REVOCATION_PREFIX}${params.jti}`,
      `${EPOCH_PREFIX}${params.userId}`,
    );
    if (revoked) return false;
    const epochSec = typeof epoch === "number" ? epoch : Number(epoch);
    if (Number.isFinite(epochSec) && params.iat < epochSec) return false;
    return true;
  } catch (error) {
    if (nodeEnv() === "development") {
      console.warn(
        `Redis unreachable, allowing device token check to pass in dev: ${error instanceof Error ? error.message : String(error)}`,
      );
      return true;
    }
    throw error;
  }
};
