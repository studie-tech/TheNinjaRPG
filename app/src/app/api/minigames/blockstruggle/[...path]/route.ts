import { auth } from "@clerk/nextjs/server";
import { getVercelOidcToken } from "@vercel/oidc";
import { Effect, Either } from "effect";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { makeBlockStruggleBridge } from "@/server/utils/blockStruggleBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOKIE_NAME = "tnr-blockstruggle-session";
const COOKIE_PATH = "/api/minigames/blockstruggle";
type Context = { params: Promise<{ path: string[] }> };

const clearCookie = (response: NextResponse) => {
  response.cookies.set(COOKIE_NAME, "", {
    path: COOKIE_PATH,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 0,
  });
};

const handle = async (request: NextRequest, context: Context) => {
  const unavailable = () =>
    NextResponse.json(
      { error: "Unavailable" },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  try {
    const identity = await auth();
    if (!identity.userId || !identity.sessionId) {
      const response = NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: { "Cache-Control": "private, no-store" } },
      );
      clearCookie(response);
      return response;
    }
    const { userId, sessionId, getToken } = identity;
    const template = process.env.BLOCKSTRUGGLE_CLERK_JWT_TEMPLATE;
    if (!template || !/^[A-Za-z0-9_-]{1,64}$/.test(template)) return unavailable();
    const { path } = await context.params;
    const bridge = await Effect.runPromise(
      Effect.either(
        makeBlockStruggleBridge(
          {
            apiOrigin: process.env.BLOCKSTRUGGLE_API_ORIGIN,
            siteOrigin: process.env.BLOCKSTRUGGLE_RPG_ORIGIN,
            cookieKey: process.env.BLOCKSTRUGGLE_BRIDGE_COOKIE_KEY,
            trustedVercelSource: process.env.BLOCKSTRUGGLE_TRUSTED_VERCEL_SOURCE,
          },
          fetch,
          getVercelOidcToken,
        ).pipe(
          Effect.flatMap((service) =>
            service.handle(
              request,
              path,
              {
                userId,
                sessionId,
                getToken: () => getToken({ template }),
              },
              request.cookies.get(COOKIE_NAME)?.value,
            ),
          ),
        ),
      ),
    );
    if (Either.isLeft(bridge))
      return NextResponse.json(
        { error: bridge.left.code },
        {
          status: bridge.left.status,
          headers: {
            "Cache-Control": "private, no-store",
            ...(bridge.left.retryAfter
              ? { "Retry-After": bridge.left.retryAfter }
              : {}),
          },
        },
      );
    const result = bridge.right;
    const response = new NextResponse(result.response.body, {
      status: result.response.status,
      headers: result.response.headers,
    });
    if (result.clearCookie) clearCookie(response);
    if (result.cookie)
      response.cookies.set(COOKIE_NAME, result.cookie.value, {
        path: COOKIE_PATH,
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: result.cookie.maxAge,
      });
    return response;
  } catch {
    return unavailable();
  }
};

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
