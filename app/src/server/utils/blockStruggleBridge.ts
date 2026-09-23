import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Clock, Data, Effect, Either, Schema } from "effect";
import {
  BlockStruggleBridgeConfig,
  BlockStruggleBridgeCookie,
  BlockStruggleSession,
} from "@/validators/blockStruggleBridge";

const COOKIE_AAD = Buffer.from("tnr-blockstruggle-bridge-v1");
const MAX_BODY = 64 * 1024;
const MAX_QUERY = 2048;
const REFRESH_MARGIN_MS = 30_000;
const MAX_SESSION_MS = 8 * 24 * 60 * 60 * 1000;
const segmentPattern = /^[A-Za-z0-9_-]{1,128}$/;

export class BlockStruggleBridgeError extends Data.TaggedError(
  "BlockStruggleBridgeError",
)<{
  readonly status: 400 | 401 | 403 | 405 | 413 | 429 | 502 | 503;
  readonly code: string;
  readonly retryAfter?: string;
}> {}

const fail = (
  status: BlockStruggleBridgeError["status"],
  code: string,
  retryAfter?: string,
) => new BlockStruggleBridgeError({ status, code, retryAfter });

export type RpgIdentity = {
  readonly userId: string;
  readonly sessionId: string;
  readonly getToken: () => Promise<string | null>;
};

export type BridgeResult = {
  readonly response: Response;
  readonly cookie?: { readonly value: string; readonly maxAge: number };
  readonly clearCookie?: boolean;
};

const strictOrigin = (value: string) => {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))
    ) ||
    value !== url.origin
  )
    throw new Error("Invalid origin");
  return url.origin;
};

const allowedPath = (segments: readonly string[], method: string) => {
  if (segments.length < 1 || segments.some((part) => !segmentPattern.test(part)))
    return false;
  const [root, id, action] = segments;
  if (root === "session" && segments.length === 1)
    return method === "GET" || method === "DELETE";
  if (root === "profile" && segments.length === 1)
    return method === "GET" || method === "PUT";
  if (root === "players" && segments.length === 1) return method === "GET";
  if (root === "leaderboards" && segments.length === 1) return method === "GET";
  if (root === "friends" && segments.length === 1)
    return method === "GET" || method === "POST";
  if (root !== "matches") return false;
  if (segments.length === 1) return method === "GET" || method === "POST";
  if (!id) return false;
  if (segments.length === 2) return method === "GET";
  return (
    segments.length === 3 &&
    (action === "result"
      ? method === "GET"
      : method === "POST" && ["accept", "start", "submit"].includes(action ?? ""))
  );
};

const readBody = (request: Request) =>
  Effect.tryPromise({
    try: async () => {
      if (!request.headers.get("content-type")?.startsWith("application/json"))
        throw fail(400, "JsonRequired");
      const reader = request.body?.getReader();
      if (!reader) throw fail(400, "BodyRequired");
      const parts: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_BODY) throw fail(413, "BodyTooLarge");
          parts.push(value);
        }
      } catch (error) {
        await reader.cancel().catch(() => {});
        throw error;
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const part of parts) {
        bytes.set(part, offset);
        offset += part.byteLength;
      }
      return bytes;
    },
    catch: (error) =>
      error instanceof BlockStruggleBridgeError ? error : fail(400, "InvalidBody"),
  });

export const makeBlockStruggleBridge = (
  input: unknown,
  transport: typeof fetch = fetch,
) =>
  Effect.gen(function* () {
    const config = yield* Schema.decodeUnknown(BlockStruggleBridgeConfig, {
      onExcessProperty: "error",
    })(input).pipe(Effect.mapError(() => fail(503, "NotConfigured")));
    const origins = yield* Effect.try({
      try: () => ({
        api: strictOrigin(config.apiOrigin),
        site: strictOrigin(config.siteOrigin),
      }),
      catch: () => fail(503, "NotConfigured"),
    });
    const key = yield* Effect.try({
      try: () => {
        if (!/^[A-Za-z0-9_-]{43}$/.test(config.cookieKey)) throw new Error();
        const bytes = Buffer.from(config.cookieKey, "base64url");
        if (bytes.byteLength !== 32) throw new Error();
        return bytes;
      },
      catch: () => fail(503, "NotConfigured"),
    });

    const decryptCookie = (value: string | undefined) =>
      Effect.gen(function* () {
        if (!value || value.length > 2048) return undefined;
        const raw = yield* Effect.try({
          try: () => {
            const bytes = Buffer.from(value, "base64url");
            if (bytes.length < 29) throw new Error();
            const decipher = createDecipheriv(
              "aes-256-gcm",
              key,
              bytes.subarray(0, 12),
            );
            decipher.setAAD(COOKIE_AAD);
            decipher.setAuthTag(bytes.subarray(12, 28));
            const plaintext = Buffer.concat([
              decipher.update(bytes.subarray(28)),
              decipher.final(),
            ]);
            return JSON.parse(plaintext.toString("utf8")) as unknown;
          },
          catch: () => new Error("Invalid cookie"),
        }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
        if (raw === undefined) return undefined;
        const decoded = yield* Effect.either(
          Schema.decodeUnknown(BlockStruggleBridgeCookie, {
            onExcessProperty: "error",
          })(raw),
        );
        return Either.isRight(decoded) ? decoded.right : undefined;
      });

    const encryptCookie = (value: typeof BlockStruggleBridgeCookie.Type) =>
      Effect.try({
        try: () => {
          const iv = randomBytes(12);
          const cipher = createCipheriv("aes-256-gcm", key, iv);
          cipher.setAAD(COOKIE_AAD);
          const encrypted = Buffer.concat([
            cipher.update(JSON.stringify(value), "utf8"),
            cipher.final(),
          ]);
          return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
            "base64url",
          );
        },
        catch: () => fail(503, "Unavailable"),
      });

    const call = (path: string, method: string, bearer: string, body?: Uint8Array) =>
      Effect.tryPromise({
        try: (signal) =>
          transport(`${origins.api}${path}`, {
            method,
            headers: {
              Authorization: `Bearer ${bearer}`,
              Origin: origins.site,
              Accept: "application/json",
              ...(body === undefined ? {} : { "Content-Type": "application/json" }),
            },
            body: body === undefined ? undefined : Buffer.from(body),
            cache: "no-store",
            redirect: "error",
            signal,
          }),
        catch: () => fail(502, "UpstreamUnavailable"),
      }).pipe(
        Effect.timeoutFail({
          duration: "10 seconds",
          onTimeout: () => fail(502, "UpstreamUnavailable"),
        }),
      );

    const exchange = (identity: RpgIdentity) =>
      Effect.gen(function* () {
        const proof = yield* Effect.tryPromise({
          try: () => identity.getToken(),
          catch: () => fail(503, "ClerkUnavailable"),
        });
        if (!proof) return yield* fail(401, "Unauthorized");
        const response = yield* call("/api/ninja/session/exchange", "POST", proof);
        if (!response.ok)
          return yield* fail(
            response.status === 429 ? 429 : response.status === 401 ? 401 : 502,
            response.status === 429 ? "RateLimited" : "ExchangeFailed",
            response.headers.get("retry-after") ?? undefined,
          );
        const json = yield* Effect.tryPromise({
          try: () => response.json() as Promise<unknown>,
          catch: () => fail(502, "InvalidUpstream"),
        });
        const issued = yield* Schema.decodeUnknown(BlockStruggleSession, {
          onExcessProperty: "error",
        })(json).pipe(Effect.mapError(() => fail(502, "InvalidUpstream")));
        const now = yield* Clock.currentTimeMillis;
        const expiresAt = Date.parse(issued.expiresAt);
        if (
          !Number.isFinite(expiresAt) ||
          expiresAt <= now + REFRESH_MARGIN_MS ||
          expiresAt > now + MAX_SESSION_MS
        )
          return yield* fail(502, "InvalidUpstream");
        return {
          version: 1 as const,
          token: issued.token,
          userId: identity.userId,
          sessionId: identity.sessionId,
          expiresAt,
        };
      });

    return {
      handle: (
        request: Request,
        segments: readonly string[],
        identity: RpgIdentity,
        cookieValue?: string,
      ): Effect.Effect<BridgeResult, BlockStruggleBridgeError> =>
        Effect.gen(function* () {
          const method = request.method.toUpperCase();
          if (!allowedPath(segments, method))
            return yield* fail(405, "MethodNotAllowed");
          if (
            !identity.userId ||
            !identity.sessionId ||
            identity.userId.length > 256 ||
            identity.sessionId.length > 256
          )
            return yield* fail(401, "Unauthorized");
          const fetchSite = request.headers.get("sec-fetch-site");
          if (fetchSite && !["same-origin", "none"].includes(fetchSite))
            return yield* fail(403, "OriginDenied");
          const suppliedOrigin = request.headers.get("origin");
          if (suppliedOrigin && suppliedOrigin !== origins.site)
            return yield* fail(403, "OriginDenied");
          if (method !== "GET" && request.headers.get("origin") !== origins.site)
            return yield* fail(403, "OriginDenied");
          const search = new URL(request.url).search;
          if (search.length > MAX_QUERY) return yield* fail(400, "InvalidQuery");
          const body =
            method === "POST" || method === "PUT"
              ? yield* readBody(request)
              : undefined;
          const now = yield* Clock.currentTimeMillis;
          const decoded = yield* decryptCookie(cookieValue);
          const existing =
            decoded?.userId === identity.userId &&
            decoded.sessionId === identity.sessionId &&
            decoded.expiresAt > now + REFRESH_MARGIN_MS
              ? decoded
              : undefined;
          if (method === "DELETE" && segments[0] === "session") {
            if (existing)
              yield* call("/api/ninja/session", "DELETE", existing.token).pipe(
                Effect.ignore,
              );
            return {
              response: new Response(null, {
                status: 204,
                headers: { "Cache-Control": "private, no-store" },
              }),
              clearCookie: true,
            };
          }
          let session = existing ?? (yield* exchange(identity));
          const path = `/api/ninja/${segments.join("/")}${search}`;
          const forward = (token: string) =>
            Effect.either(call(path, method, token, body));
          const retainIssuedSession = (failure: BlockStruggleBridgeError) =>
            Effect.gen(function* () {
              if (session === existing) return yield* failure;
              const cookie = yield* encryptCookie(session);
              return {
                response: Response.json(
                  { error: failure.code },
                  {
                    status: failure.status,
                    headers: { "Cache-Control": "private, no-store" },
                  },
                ),
                cookie: {
                  value: cookie,
                  maxAge: Math.max(1, Math.floor((session.expiresAt - now) / 1000)),
                },
              } satisfies BridgeResult;
            });
          let forwarded = yield* forward(session.token);
          if (Either.isLeft(forwarded))
            return yield* retainIssuedSession(forwarded.left);
          let upstream = forwarded.right;
          if (upstream.status === 401 && existing) {
            yield* Effect.promise(async () => {
              await upstream.body?.cancel().catch(() => {});
            });
            session = yield* exchange(identity);
            forwarded = yield* forward(session.token);
            if (Either.isLeft(forwarded))
              return yield* retainIssuedSession(forwarded.left);
            upstream = forwarded.right;
          }
          const headers = new Headers({
            "Cache-Control": "private, no-store",
            "Content-Type": "application/json",
            "X-Content-Type-Options": "nosniff",
          });
          const retryAfter = upstream.headers.get("retry-after");
          if (retryAfter) headers.set("Retry-After", retryAfter);
          const response = new Response(upstream.body, {
            status: upstream.status,
            headers,
          });
          if (upstream.status === 401) return { response, clearCookie: true };
          if (session === existing) return { response };
          const cookie = yield* encryptCookie(session);
          return {
            response,
            cookie: {
              value: cookie,
              maxAge: Math.max(1, Math.floor((session.expiresAt - now) / 1000)),
            },
          };
        }),
    };
  });
