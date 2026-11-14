/**
 * Firebase Cloud Messaging transport (HTTP v1).
 *
 * The legacy server key was switched off in 2024, so this authenticates with a service
 * account, whose access token is cached until shortly before it expires.
 */

import { env } from "@/env/server.mjs";
import {
  exchangeGoogleServiceAccountToken,
  type GoogleAccessToken,
} from "@/server/utils/googleServiceAccount";
import { retryRejectedOnce } from "./authRetry";
import { mapWithConcurrency } from "./batch";
import { fcmMessage } from "./payloads";
import {
  failAll,
  isDeadFcmToken,
  type PushMessage,
  type PushResult,
  toPublicResult,
} from "./types";

const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const REQUEST_TIMEOUT_MS = 10_000;
/** Refresh a minute early so a token cannot expire mid-flight. */
const EXPIRY_SKEW_MS = 60_000;

let cachedAccessToken: GoogleAccessToken | null = null;
let accessTokenPromise: Promise<string> | null = null;

export const isConfigured = (): boolean =>
  Boolean(env.FCM_PROJECT_ID && env.FCM_CLIENT_EMAIL && env.FCM_PRIVATE_KEY);

const getAccessToken = async (): Promise<string> => {
  const now = Date.now();
  if (cachedAccessToken && cachedAccessToken.expiresAt - EXPIRY_SKEW_MS > now) {
    return cachedAccessToken.token;
  }
  if (!accessTokenPromise) {
    accessTokenPromise = exchangeGoogleServiceAccountToken({
      clientEmail: env.FCM_CLIENT_EMAIL ?? "",
      privateKey: env.FCM_PRIVATE_KEY ?? "",
      scope: SCOPE,
      label: "FCM",
    })
      .then((accessToken) => {
        cachedAccessToken = accessToken;
        return accessToken.token;
      })
      .finally(() => {
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

/** Deliver an alert to every token. Never throws. */
export const sendAlerts = async (
  tokens: string[],
  message: PushMessage,
): Promise<PushResult[]> => {
  if (tokens.length === 0) return [];
  if (!isConfigured()) {
    return failAll(tokens, "FCM is not configured", false);
  }
  let accessToken: string;
  try {
    accessToken = await getAccessToken();
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown FCM error";
    return failAll(tokens, reason, true);
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
  return results.map(toPublicResult);
};
