import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
  AB_PIXEL_LAYOUT_COOKIE,
  LEGACY_AB_LAYOUT_COOKIE,
} from "@/libs/layoutPreference";

// import type { NextRequest } from "next/server";
// import * as UAParser from "ua-parser-js";

const isPublicRoute = createRouteMatcher([
  "/(.*)",
  "/api/cleaner",
  "/api/daily",
  "/api/healthcheck",
  "/api/ipn",
  "/api/mcp/(.*)",
  "/api/subscriptions",
  "/api/trpc/(.*)",
  "/api/uploadthing",
  "/.well-known/oauth-authorization-server(.*)",
  "/.well-known/oauth-protected-resource(.*)",
  "/conceptart(.*)",
  "/forum(.*)",
  "/github",
  "/help",
  "/login(.*)",
  "/manual(.*)",
  "/news",
  "/rules",
]);

// export function uaMiddleware(request: NextRequest) {
//   const userAgent = request.headers.get("user-agent") || undefined;
//   const userAgentParsed = new UAParser.UAParser(userAgent);
//   if (userAgentParsed.getBrowser().name === undefined) {
//     return NextResponse.json(
//       { message: "Forbidden. Only access through browser" },
//       { status: 403 },
//     );
//   }
//   return NextResponse.next();
// }

const isMcpRoute = createRouteMatcher([
  "/api/mcp/(.*)",
  "/.well-known/oauth-authorization-server(.*)",
  "/.well-known/oauth-protected-resource(.*)",
]);

const appendCookieHeader = (
  existingCookieHeader: string | null,
  name: string,
  value: string,
) => {
  const cookie = `${name}=${value}`;
  return existingCookieHeader ? `${existingCookieHeader}; ${cookie}` : cookie;
};

export default clerkMiddleware(
  async (auth, request) => {
    // Protect all routes except for the public ones
    if (!isPublicRoute(request)) {
      await auth.protect();
    }

    // Skip auth() call for MCP routes - they handle OAuth tokens separately
    if (isMcpRoute(request)) {
      return NextResponse.next();
    }

    // Ensure valid user agent
    // return uaMiddleware(request);
    const { pathname } = request.nextUrl;
    const { userId } = await auth();
    if (pathname === "/" && !userId) {
      const cookie = request.cookies.get(LEGACY_AB_LAYOUT_COOKIE);
      const variant = cookie?.value ?? (Math.random() < 0.5 ? "treatment" : "control");
      const pixelCookie = request.cookies.get(AB_PIXEL_LAYOUT_COOKIE);
      const pixelVariant =
        pixelCookie?.value ?? (Math.random() < 0.5 ? "treatment" : "control");
      const url = request.nextUrl.clone();
      const requestHeaders = new Headers(request.headers);
      let cookieHeader = requestHeaders.get("cookie");
      if (!cookie) {
        cookieHeader = appendCookieHeader(
          cookieHeader,
          LEGACY_AB_LAYOUT_COOKIE,
          variant,
        );
      }
      if (!pixelCookie) {
        cookieHeader = appendCookieHeader(
          cookieHeader,
          AB_PIXEL_LAYOUT_COOKIE,
          pixelVariant,
        );
      }
      if (cookieHeader) requestHeaders.set("cookie", cookieHeader);
      const res = NextResponse.rewrite(url, {
        request: {
          headers: requestHeaders,
        },
      });
      if (!cookie) res.cookies.set(LEGACY_AB_LAYOUT_COOKIE, variant, { path: "/" });
      if (!pixelCookie) {
        res.cookies.set(AB_PIXEL_LAYOUT_COOKIE, pixelVariant, { path: "/" });
      }
      return res;
    }
  },
  { clockSkewInMs: 1000 * 60 * 30 },
);

export const config = {
  matcher: [
    /*
     * The root layout calls Clerk's auth(), including when Next renders the
     * global 404. Match missing dotted paths too so asset-like probes and stale
     * links have Clerk context instead of turning an ordinary 404 into a 500.
     * Next internals and the legacy static directory do not use that layout.
     */
    "/((?!_next(?:/|$)|static(?:/|$)).*)",
    "/",
  ],
};
