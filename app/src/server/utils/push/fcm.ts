/**
 * Firebase Cloud Messaging transport (HTTP v1).
 *
 * The legacy server key was switched off in 2024, so this authenticates with a service
 * account: an RS256 JWT is exchanged at Google's token endpoint for an OAuth2 access
 * token, which is cached until shortly before it expires.
 */

import { env } from "@/env/server.mjs";
import { retryRejectedOnce } from "./authRetry";
import { mapWithConcurrency } from "./batch";
import { signJwt } from "./jwt";
import { fcmMessage } from "./payloads";
import { isDeadFcmToken, type PushMessage, type PushResult } from "./types";

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
let accessTokenPromise: Promise<string> | null = null;

export const isConfigured = (): boolean =>
  Boolean(env.FCM_PROJECT_ID && env.FCM_CLIENT_EMAIL && env.FCM_PRIVATE_KEY);

/** Drop the cached access token. Used by tests and after a 401. */
export const resetAccessToken = (): void => {
  cachedAccessToken = null;
  accessTokenPromise = null;
};

const buildAssertion = (): string => {
  const issuedAt = Math.floor(Date.now() / 1000);
  return signJwt({
    algorithm: "RS256",
    claims: {
      iss: env.FCM_CLIENT_EMAIL ?? "",
      scope: SCOPE,
      aud: TOKEN_ENDPOINT,
      iat: issuedAt,
      exp: issuedAt + 3600,
    },
    privateKey: env.FCM_PRIVATE_KEY ?? "",
  });
};

const getAccessToken = async (): Promise<string> => {
  const now = Date.now();
  if (cachedAccessToken && cachedAccessToken.expiresAt - EXPIRY_SKEW_MS > now) {
    return cachedAccessToken.token;
  }
  if (!accessTokenPromise) {
    accessTokenPromise = (async () => {
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
        expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
      };
      return cachedAccessToken.token;
    })().finally(() => {
      accessTokenPromise = null;
    });
  }
  return accessTokenPromise;
};

type FcmAttemptResult = PushResult & {
  /** Internal marker: retry this request once after refreshing the shared credential. */
  authRejected?: boolean;
};

const sendOne = async (
  accessToken: string,
  token: string,
  message: PushMessage,
): Promise<FcmAttemptResult> => {
  try {
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${env.FCM_PROJECT_ID}/messages:send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: fcmMessage(token, message) }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    if (response.ok) return { token, status: "sent" };
    const body = (await response.json().catch(() => ({}))) as {
      error?: { status?: string; message?: string; details?: { errorCode?: string }[] };
    };
    const code =
      body.error?.details?.find((detail) => detail.errorCode)?.errorCode ??
      body.error?.status ??
      String(response.status);
    if (isDeadFcmToken(code)) {
      return { token, status: "expired", reason: code };
    }
    return {
      token,
      status: "failed",
      reason: `${response.status} ${code}`,
      retryable:
        response.status === 401 || response.status === 429 || response.status >= 500,
      ...(response.status === 401 ? { authRejected: true } : {}),
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

/** Refresh once, but share an exchange already started by another concurrent batch. */
const accessTokenAfterRejection = (rejectedToken: string): Promise<string> => {
  if (cachedAccessToken?.token && cachedAccessToken.token !== rejectedToken) {
    return getAccessToken();
  }
  cachedAccessToken = null;
  return getAccessToken();
};

const publicResult = (result: FcmAttemptResult): PushResult => {
  if (result.status === "sent") return { token: result.token, status: "sent" };
  if (result.status === "expired") {
    return { token: result.token, status: "expired", reason: result.reason };
  }
  return {
    token: result.token,
    status: "failed",
    reason: result.reason,
    retryable: result.retryable,
  };
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
  const results = await mapWithConcurrency(tokens, (token) =>
    sendOne(accessToken, token, message),
  );
  await retryRejectedOnce(
    results,
    (result) => result.authRejected === true,
    async (rejected) => {
      const refreshedToken = await accessTokenAfterRejection(accessToken);
      return await mapWithConcurrency(rejected, (index) =>
        sendOne(refreshedToken, tokens[index] as string, message),
      );
    },
  );
  return results.map(publicResult);
};
