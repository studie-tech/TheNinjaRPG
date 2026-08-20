import { createHash, randomBytes } from "node:crypto";

// RFC 7636 PKCE for the desktop connect flow. The verifier only ever exists
// on this machine; the server binds the minted connect code to the challenge.

export function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function sha256Base64Url(input: string): string {
  return base64UrlEncode(createHash("sha256").update(input, "utf8").digest());
}

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export function generatePkce(): PkcePair {
  const verifier = base64UrlEncode(randomBytes(32));
  return { verifier, challenge: sha256Base64Url(verifier) };
}

// The /dev-connect page requires 16-64 chars of [A-Za-z0-9_-].
export function generateState(): string {
  return base64UrlEncode(randomBytes(16));
}

export interface ConnectUrlOptions {
  apiBase: string;
  state: string;
  codeChallenge: string;
  loopbackPort: number;
}

// The game server's /dev-connect page reads state / code_challenge /
// loopback_port, then redirects the browser back to
// http://127.0.0.1:<loopbackPort>/callback?code=...&state=...
export function buildConnectUrl({
  apiBase,
  state,
  codeChallenge,
  loopbackPort,
}: ConnectUrlOptions): string {
  const url = new URL(`${apiBase.replace(/\/+$/, "")}/dev-connect`);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("loopback_port", String(loopbackPort));
  return url.toString();
}
