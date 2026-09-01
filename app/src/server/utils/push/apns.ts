/**
 * APNs transport.
 *
 * Apple only accepts HTTP/2, which `fetch` does not speak, so this uses `node:http2`
 * directly. One session is opened per batch and every token multiplexes over it — that is
 * the whole reason APNs mandates HTTP/2, and it keeps a fan-out to a thousand devices to a
 * single TCP connection.
 *
 * Authentication is a provider token: an ES256 JWT signed with the .p8 key. Apple rejects
 * tokens older than an hour and also rejects regenerating one more than once every 20
 * minutes, so it is cached in module scope and refreshed on a 40-minute clock.
 */

import { type ClientHttp2Session, connect, constants } from "node:http2";
import { env } from "@/env/server.mjs";
import { retryRejectedOnce } from "./authRetry";
import { mapWithConcurrency } from "./batch";
import { signJwt } from "./jwt";
import { apnsAlertPayload } from "./payloads";
import { isDeadApnsToken, type PushMessage, type PushResult } from "./types";

const PRODUCTION_HOST = "https://api.push.apple.com";
const SANDBOX_HOST = "https://api.sandbox.push.apple.com";

/** Well inside Apple's one-hour ceiling, and outside its 20-minute regeneration floor. */
const TOKEN_TTL_MS = 40 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;
const SESSION_TIMEOUT_MS = 15_000;

interface CachedToken {
  jwt: string;
  createdAt: number;
}

let cachedToken: CachedToken | null = null;

/** Whether APNs is configured. Everything below assumes this returned true. */
export const isConfigured = (): boolean =>
  Boolean(
    env.APNS_KEY_ID && env.APNS_TEAM_ID && env.APNS_PRIVATE_KEY && env.APNS_BUNDLE_ID,
  );

const buildProviderToken = (): string => {
  const now = Date.now();
  if (cachedToken && now - cachedToken.createdAt < TOKEN_TTL_MS) {
    return cachedToken.jwt;
  }
  const jwt = signJwt({
    algorithm: "ES256",
    header: { kid: env.APNS_KEY_ID ?? "" },
    claims: { iss: env.APNS_TEAM_ID ?? "", iat: Math.floor(now / 1000) },
    privateKey: env.APNS_PRIVATE_KEY ?? "",
  });
  cachedToken = { jwt, createdAt: now };
  return jwt;
};

/** Drop the cached provider token. Used by tests and after an auth failure. */
export const resetProviderToken = (): void => {
  cachedToken = null;
};

const apnsHost = (): string =>
  env.APNS_USE_SANDBOX === "true" ? SANDBOX_HOST : PRODUCTION_HOST;

export type ApnsPushType = "alert" | "liveactivity" | "background";

interface ApnsRequest {
  token: string;
  /** Fully built `aps` payload plus any custom keys. */
  payload: Record<string, unknown>;
  pushType: ApnsPushType;
  collapseId?: string;
  /** Unix seconds; 0 tells Apple to attempt delivery once and give up. */
  expiration?: number;
  priority?: 5 | 10;
}

type ApnsAttemptResult = PushResult & {
  /** Internal marker: this request may be replayed once after refreshing batch auth. */
  authExpired?: boolean;
};

const sendOne = (
  session: ClientHttp2Session,
  providerToken: string,
  request: ApnsRequest,
): Promise<ApnsAttemptResult> =>
  new Promise((resolve) => {
    // A synchronous failure here — most likely `session.request` on a session that has
    // already closed — resolves this one token as retryable rather than rejecting the
    // whole batch and discarding the results of every token that already succeeded.
    try {
      sendOverSession(session, providerToken, request, resolve);
    } catch (error) {
      resolve({
        token: request.token,
        status: "failed",
        reason: error instanceof Error ? error.message : "Session unavailable",
        retryable: true,
      });
    }
  });

const sendOverSession = (
  session: ClientHttp2Session,
  providerToken: string,
  request: ApnsRequest,
  resolve: (result: ApnsAttemptResult) => void,
): void => {
  const body = Buffer.from(JSON.stringify(request.payload));
  // Live Activity updates address a different topic than the app itself.
  const topic =
    request.pushType === "liveactivity"
      ? `${env.APNS_BUNDLE_ID}.push-type.liveactivity`
      : env.APNS_BUNDLE_ID;

  const stream = session.request({
    [constants.HTTP2_HEADER_METHOD]: "POST",
    [constants.HTTP2_HEADER_PATH]: `/3/device/${request.token}`,
    [constants.HTTP2_HEADER_AUTHORIZATION]: `bearer ${providerToken}`,
    [constants.HTTP2_HEADER_CONTENT_TYPE]: "application/json",
    [constants.HTTP2_HEADER_CONTENT_LENGTH]: body.length,
    "apns-topic": topic,
    "apns-push-type": request.pushType,
    "apns-priority": String(request.priority ?? 10),
    ...(request.expiration === undefined
      ? {}
      : { "apns-expiration": String(request.expiration) }),
    ...(request.collapseId ? { "apns-collapse-id": request.collapseId } : {}),
  });

  let status = 0;
  const chunks: Buffer[] = [];
  let settled = false;
  const settle = (result: ApnsAttemptResult) => {
    if (settled) return;
    settled = true;
    resolve(result);
  };

  stream.setTimeout(REQUEST_TIMEOUT_MS, () => {
    stream.close(constants.NGHTTP2_CANCEL);
    settle({
      token: request.token,
      status: "failed",
      reason: "Timed out",
      retryable: true,
    });
  });
  stream.on("response", (headers) => {
    status = Number(headers[constants.HTTP2_HEADER_STATUS] ?? 0);
  });
  stream.on("data", (chunk: Buffer) => chunks.push(chunk));
  stream.on("error", (error: Error) => {
    settle({
      token: request.token,
      status: "failed",
      reason: error.message,
      retryable: true,
    });
  });
  stream.on("end", () => {
    if (status === 200) {
      settle({ token: request.token, status: "sent" });
      return;
    }
    const reason = parseReason(Buffer.concat(chunks).toString("utf8"));
    if (isDeadApnsToken(status, reason)) {
      settle({ token: request.token, status: "expired", reason });
      return;
    }
    // Only ExpiredProviderToken says the shared JWT should be refreshed. Other 403s are
    // configuration failures and replaying every device would produce the same result.
    const authExpired = status === 403 && reason === "ExpiredProviderToken";
    settle({
      token: request.token,
      status: "failed",
      reason: `${status} ${reason}`,
      retryable: authExpired || status === 429 || status >= 500,
      ...(authExpired ? { authExpired: true } : {}),
    });
  });

  stream.end(body);
};

/** Refresh once, but reuse a token another concurrent batch already replaced. */
const providerTokenAfterRejection = (rejectedToken: string): string => {
  if (cachedToken?.jwt && cachedToken.jwt !== rejectedToken)
    return buildProviderToken();
  resetProviderToken();
  return buildProviderToken();
};

const publicResult = (result: ApnsAttemptResult): PushResult => {
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

const parseReason = (raw: string): string => {
  if (!raw) return "Unknown";
  try {
    const parsed = JSON.parse(raw) as { reason?: string };
    return parsed.reason ?? "Unknown";
  } catch {
    return raw.slice(0, 120);
  }
};

/**
 * Deliver a batch over one HTTP/2 session. Never throws: a session that cannot be opened
 * resolves every token as a retryable failure so the caller can log and move on.
 */
export const sendBatch = async (requests: ApnsRequest[]): Promise<PushResult[]> => {
  if (requests.length === 0) return [];
  if (!isConfigured()) {
    return requests.map((request) => ({
      token: request.token,
      status: "failed" as const,
      reason: "APNs is not configured",
      retryable: false,
    }));
  }

  let session: ClientHttp2Session;
  let providerToken: string;
  try {
    providerToken = buildProviderToken();
    session = connect(apnsHost());
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown APNs error";
    return requests.map((request) => ({
      token: request.token,
      status: "failed" as const,
      reason,
      retryable: true,
    }));
  }

  // A connection-level error rejects the individual streams too, so this handler only
  // needs to stop the process-level 'unhandled error' crash.
  session.on("error", () => undefined);
  session.setTimeout(SESSION_TIMEOUT_MS, () => session.close());

  try {
    const results = await mapWithConcurrency(requests, (request) =>
      sendOne(session, providerToken, request),
    );
    await retryRejectedOnce(
      results,
      (result) => result.authExpired === true,
      async (rejected) => {
        const refreshedToken = providerTokenAfterRejection(providerToken);
        return await mapWithConcurrency(rejected, (index) =>
          sendOne(session, refreshedToken, requests[index] as ApnsRequest),
        );
      },
    );
    return results.map(publicResult);
  } finally {
    session.close();
  }
};

/** Send an ordinary alert to every token. */
export const sendAlerts = async (
  tokens: string[],
  message: PushMessage,
): Promise<PushResult[]> =>
  sendBatch(
    tokens.map((token) => ({
      token,
      payload: apnsAlertPayload(message),
      pushType: "alert" as const,
      collapseId: message.collapseId,
    })),
  );
