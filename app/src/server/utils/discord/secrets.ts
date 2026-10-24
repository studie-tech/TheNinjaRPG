import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Stored Discord OAuth tokens are encrypted with AES-256-GCM. The format is
 * `v1.<iv>.<auth tag>.<ciphertext>` in base64url, so a key rotation can add a version.
 */
export const encryptToken = (plain: string, key: Buffer) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
};

/** Decrypt a stored token; throws when the key is wrong or the value was tampered with. */
export const decryptToken = (stored: string, key: Buffer) => {
  const [version, iv, tag, ciphertext] = stored.split(".");
  if (version !== "v1" || !iv || !tag || ciphertext === undefined)
    throw new Error("Unsupported token format");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
};

/** OAuth `state` lifetime: long enough to approve on Discord, short enough to limit replay. */
export const LINK_STATE_TTL_MS = 10 * 60 * 1000;

/** Cookie holding the browser half of the OAuth state. */
export const LINK_STATE_COOKIE = "tnr-discord-oauth";

type StatePayload = { u: string; n: string; e: number };

const stateKey = (clientSecret: string) =>
  createHmac("sha256", clientSecret).update("tnr-discord-oauth-state-v1").digest();

const signState = (body: string, clientSecret: string) =>
  createHmac("sha256", stateKey(clientSecret)).update(body).digest("base64url");

/**
 * Create the OAuth `state`: the signed user id, a nonce and an expiry. The nonce is also set
 * as an HttpOnly cookie, so a callback only completes for the signed-in user, in the browser
 * that started the flow, before the state expires.
 */
export const createLinkState = (
  userId: string,
  clientSecret: string,
  now = Date.now(),
) => {
  const nonce = randomBytes(16).toString("base64url");
  const body = Buffer.from(
    JSON.stringify({
      u: userId,
      n: nonce,
      e: now + LINK_STATE_TTL_MS,
    } satisfies StatePayload),
  ).toString("base64url");
  return { state: `${body}.${signState(body, clientSecret)}`, nonce };
};

/** Verify signature, expiry, the signed-in user and the browser nonce. */
export const verifyLinkState = (
  state: string | null | undefined,
  expected: { userId: string; nonce: string | null | undefined; clientSecret: string },
  now = Date.now(),
) => {
  if (!state || !expected.nonce) return false;
  const [body, signature] = state.split(".");
  if (!body || !signature) return false;
  const actual = Buffer.from(signature);
  const wanted = Buffer.from(signState(body, expected.clientSecret));
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) return false;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as
      | Partial<StatePayload>
      | undefined;
    const nonceMatches =
      typeof payload?.n === "string" &&
      payload.n.length === expected.nonce.length &&
      timingSafeEqual(Buffer.from(payload.n), Buffer.from(expected.nonce));
    return (
      payload?.u === expected.userId &&
      nonceMatches &&
      typeof payload.e === "number" &&
      payload.e > now
    );
  } catch {
    return false;
  }
};
