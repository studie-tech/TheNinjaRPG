/**
 * Google Data Manager API transport for Google Ads click conversions. A service account
 * that is a user of the Google Ads account signs in with the `datamanager` scope.
 */

import { env } from "@/env/server.mjs";
import type {
  AdConversionDestinations,
  AdConversionRequestStatus,
} from "@/server/utils/adConversions";
import { exchangeGoogleServiceAccountToken } from "@/server/utils/googleServiceAccount";

const INGEST_ENDPOINT = "https://datamanager.googleapis.com/v1/events:ingest";
const STATUS_ENDPOINT = "https://datamanager.googleapis.com/v1/requestStatus:retrieve";
const SCOPE = "https://www.googleapis.com/auth/datamanager";
const REQUEST_TIMEOUT_MS = 30_000;

/** The Google Ads account and conversion actions, or null until all are configured. */
export const getAdConversionDestinations = (): AdConversionDestinations | null => {
  const customerId = env.GOOGLE_ADS_CUSTOMER_ID;
  const register = env.GOOGLE_ADS_SIGNUP_CONVERSION_ACTION_ID;
  const tutorialComplete = env.GOOGLE_ADS_TUTORIAL_CONVERSION_ACTION_ID;
  if (
    !customerId ||
    !register ||
    !tutorialComplete ||
    !env.GOOGLE_DATA_MANAGER_CLIENT_EMAIL ||
    !env.GOOGLE_DATA_MANAGER_PRIVATE_KEY
  ) {
    return null;
  }
  return { customerId, conversionActionIds: { register, tutorialComplete } };
};

/** Sign in as the Data Manager service account; the token lasts about an hour. */
export const getDataManagerToken = async (): Promise<string> => {
  const { token } = await exchangeGoogleServiceAccountToken({
    clientEmail: env.GOOGLE_DATA_MANAGER_CLIENT_EMAIL ?? "",
    privateKey: env.GOOGLE_DATA_MANAGER_PRIVATE_KEY ?? "",
    scope: SCOPE,
    label: "Data Manager",
  });
  return token;
};

/**
 * Send one `events:ingest` request. The API validates the whole request before accepting
 * any of it, so a rejection means none of its events were ingested; one that names invalid
 * events returns their positions so the caller can settle them and send the rest again.
 * Acceptance only queues the events; their processing is read later with
 * `retrieveAdConversionStatus`.
 */
export const ingestAdConversions = async (
  token: string,
  body: object,
): Promise<{ requestId: string } | { invalidEventIndices: number[] }> => {
  const { response, payload } = await callDataManager<{
    requestId?: string;
    error?: { details?: { fieldViolations?: { field?: string }[] }[] };
  }>(token, INGEST_ENDPOINT, { method: "POST", body: JSON.stringify(body) });
  if (response.status === 400) {
    const invalidEventIndices = [
      ...new Set(
        (payload.error?.details ?? [])
          .flatMap((detail) => detail.fieldViolations ?? [])
          .flatMap((violation) => {
            const match = violation.field?.match(/events\[(\d+)\]/);
            return match ? [Number(match[1])] : [];
          }),
      ),
    ];
    if (invalidEventIndices.length > 0) return { invalidEventIndices };
  }
  if (!response.ok || !payload.requestId) throw dataManagerError(response, payload);
  return { requestId: payload.requestId };
};

/**
 * Read how Google processed an ingested request, or null when Google no longer knows the
 * request ID.
 */
export const retrieveAdConversionStatus = async (
  token: string,
  requestId: string,
): Promise<AdConversionRequestStatus | null> => {
  const url = `${STATUS_ENDPOINT}?${new URLSearchParams({ requestId })}`;
  const { response, payload } = await callDataManager<AdConversionRequestStatus>(
    token,
    url,
    { method: "GET" },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw dataManagerError(response, payload);
  return payload;
};

/** Sends an authenticated JSON request with a timeout; the body is parsed, or `{}` when it is not JSON. */
const callDataManager = async <T>(
  token: string,
  url: string,
  init: { method: "GET" | "POST"; body?: string },
) => {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const payload = (await response.json().catch(() => ({}))) as T;
  return { response, payload };
};

/** Builds the error for a failed Data Manager call from the HTTP status and Google's message. */
const dataManagerError = (response: Response, payload: unknown) => {
  const message = (payload as { error?: { message?: string } }).error?.message ?? "";
  return new Error(`Data Manager request failed: ${response.status} ${message}`.trim());
};
