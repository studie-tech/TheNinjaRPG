/**
 * Firebase Cloud Messaging transport (HTTP v1).
 *
 * The legacy server key was switched off in 2024, so this authenticates with a service
 * account: an RS256 JWT is exchanged at Google's token endpoint for an OAuth2 access
 * token, which is cached until shortly before it expires.
 */

import { createPrivateKey, sign as cryptoSign } from "node:crypto";
import { env } from "@/env/server.mjs";
import type { PushMessage, PushResult } from "./types";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const REQUEST_TIMEOUT_MS = 10_000;
/** Refresh a minute early so a token cannot expire mid-flight. */
const EXPIRY_SKEW_MS = 60_000;

interface CachedAccessToken {
  token: string;
  expiresAt: number;
}

let cachedAccessToken: CachedAccessToken | null = null;

export const isConfigured = (): boolean =>
  Boolean(env.FCM_PROJECT_ID && env.FCM_CLIENT_EMAIL && env.FCM_PRIVATE_KEY);

const base64url = (input: Buffer | string): string =>
  Buffer.from(input).toString("base64url");

const normalisePrivateKey = (key: string): string => key.replace(/\\n/g, "\n");

/** Drop the cached access token. Used by tests and after a 401. */
export const resetAccessToken = (): void => {
  cachedAccessToken = null;
};

const buildAssertion = (): string => {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: env.FCM_CLIENT_EMAIL,
      scope: SCOPE,
      aud: TOKEN_ENDPOINT,
      iat: issuedAt,
      exp: issuedAt + 3600,
    }),
  );
  const signingInput = `${header}.${claims}`;
  const key = createPrivateKey(normalisePrivateKey(env.FCM_PRIVATE_KEY ?? ""));
  const signature = cryptoSign("sha256", Buffer.from(signingInput), key);
  return `${signingInput}.${base64url(signature)}`;
};

const getAccessToken = async (): Promise<string> => {
  const now = Date.now();
  if (cachedAccessToken && cachedAccessToken.expiresAt - EXPIRY_SKEW_MS > now) {
    return cachedAccessToken.token;
  }
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: buildAssertion(),
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`FCM token exchange failed: ${response.status}`);
  }
  const payload = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!payload.access_token) {
    throw new Error("FCM token exchange returned no access token");
  }
  cachedAccessToken = {
    token: payload.access_token,
    expiresAt: now + (payload.expires_in ?? 3600) * 1000,
  };
  return cachedAccessToken.token;
};

/**
 * Error codes that mean the registration token is dead. Everything else is transient and
 * leaves the row in place.
 */
const EXPIRED_CODES = new Set(["UNREGISTERED", "INVALID_ARGUMENT", "NOT_FOUND"]);

/**
 * FCM's `data` payload only carries strings, so every value is stringified before it is
 * handed over — a number here silently fails the whole send.
 */
const buildMessage = (
  token: string,
  message: PushMessage,
): Record<string, unknown> => ({
  message: {
    token,
    notification: { title: message.title, body: message.body },
    data: {
      category: message.category,
      ...(message.url ? { url: message.url } : {}),
      ...(message.data ?? {}),
    },
    android: {
      priority: "HIGH",
      ...(message.collapseId ? { collapse_key: message.collapseId } : {}),
      notification: {
        // Channels are declared by the shell; one per category in PUSH_CATEGORIES.
        channel_id: message.category,
        click_action: "TNR_NOTIFICATION_CLICK",
        ...(message.badge === undefined ? {} : { notification_count: message.badge }),
      },
    },
  },
});

const sendOne = async (
  accessToken: string,
  token: string,
  message: PushMessage,
): Promise<PushResult> => {
  try {
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${env.FCM_PROJECT_ID}/messages:send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildMessage(token, message)),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    if (response.ok) return { token, status: "sent" };
    if (response.status === 401) resetAccessToken();

    const body = (await response.json().catch(() => ({}))) as {
      error?: { status?: string; message?: string; details?: { errorCode?: string }[] };
    };
    const code =
      body.error?.details?.find((detail) => detail.errorCode)?.errorCode ??
      body.error?.status ??
      String(response.status);
    if (EXPIRED_CODES.has(code)) {
      return { token, status: "expired", reason: code };
    }
    return {
      token,
      status: "failed",
      reason: `${response.status} ${code}`,
      retryable: response.status === 429 || response.status >= 500,
    };
  } catch (error) {
    return {
      token,
      status: "failed",
      reason: error instanceof Error ? error.message : "Unknown FCM error",
      retryable: true,
    };
  }
};

/** Deliver an alert to every token. Never throws. */
export const sendAlerts = async (
  tokens: string[],
  message: PushMessage,
): Promise<PushResult[]> => {
  if (tokens.length === 0) return [];
  if (!isConfigured()) {
    return tokens.map((token) => ({
      token,
      status: "failed" as const,
      reason: "FCM is not configured",
      retryable: false,
    }));
  }
  let accessToken: string;
  try {
    accessToken = await getAccessToken();
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown FCM error";
    return tokens.map((token) => ({
      token,
      status: "failed" as const,
      reason,
      retryable: true,
    }));
  }
  return Promise.all(tokens.map((token) => sendOne(accessToken, token, message)));
};
