/**
 * Google service-account sign-in: an RS256 JWT assertion is exchanged at Google's token
 * endpoint for an OAuth2 access token. Callers decide how long to cache the token.
 */

import { signJwt } from "@/server/utils/push/jwt";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REQUEST_TIMEOUT_MS = 10_000;

/** A Google OAuth2 access token and when it expires, in epoch milliseconds. */
export interface GoogleAccessToken {
  token: string;
  expiresAt: number;
}

/** Exchange a service account's signed assertion for an access token in the given scope. */
export const exchangeGoogleServiceAccountToken = async (account: {
  clientEmail: string;
  privateKey: string;
  scope: string;
  /** Names the caller in errors. */
  label: string;
}): Promise<GoogleAccessToken> => {
  const issuedAt = Math.floor(Date.now() / 1000);
  const assertion = signJwt({
    algorithm: "RS256",
    claims: {
      iss: account.clientEmail,
      scope: account.scope,
      aud: TOKEN_ENDPOINT,
      iat: issuedAt,
      exp: issuedAt + 3600,
    },
    privateKey: account.privateKey,
  });
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`${account.label} token exchange failed: ${response.status}`);
  }
  const payload = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!payload.access_token) {
    throw new Error(`${account.label} token exchange returned no access token`);
  }
  return {
    token: payload.access_token,
    expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
  };
};
