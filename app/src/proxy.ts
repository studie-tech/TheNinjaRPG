import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
  AB_PIXEL_LAYOUT_COOKIE,
  LEGACY_AB_LAYOUT_COOKIE,
} from "@/libs/layoutPreference";

// import type { NextRequest } from "next/server";
// import * as UAParser from "ua-parser-js";

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

const isMcpRoute = (pathname: string) =>
  pathname === "/api/mcp" ||
  pathname.startsWith("/api/mcp/") ||
  pathname.startsWith("/.well-known/oauth-authorization-server") ||
  pathname.startsWith("/.well-known/oauth-protected-resource");

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
    const { pathname } = request.nextUrl;

    // Skip auth() call for MCP routes - they handle OAuth tokens separately
    if (isMcpRoute(pathname)) {
      return NextResponse.next();
    }

    // Only the landing-page A/B rewrite needs auth inside Proxy. Server-side
    // resources enforce their own access, and the root layout reads auth for UI.
    if (pathname !== "/") return;

    // Ensure valid user agent
    // return uaMiddleware(request);
    const { userId } = await auth();
    if (!userId) {
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
     * Skip Next internals, legacy static files, and any file-like path. Unmatched
     * URLs render through global-not-found.tsx without the Clerk-dependent root
     * layout, so missing assets and scanner probes remain cheap 404 responses.
     */
    "/((?!api(?:/|$)|trpc(?:/|$)|_next(?:/|$)|static(?:/|$)|[^?]*\\.[^/?]+).*)",
    /*
     * Optional catch-all routes are the exception to the file-like skip above:
     * they render the Clerk-dependent root layout for paths such as
     * /signup/administration/index.php, which scanners probe for. Without the
     * proxy those requests reach auth() with no Clerk context and throw.
     */
    "/login(.*)",
    "/signup(.*)",
    "/manual/damage_calcs(.*)",
    // Only route handlers that call Clerk's server helpers need its context.
    "/api/trpc/(.*)",
    "/api/chat/:path*",
    "/api/uploadthing(.*)",
    // The IP parameter legitimately contains dots.
    "/users/ipsearch/:path*",
    // MCP OAuth endpoints intentionally bypass Clerk auth in the callback above.
    "/.well-known/oauth-authorization-server(.*)",
    "/.well-known/oauth-protected-resource(.*)",
    // Keep Clerk's optional frontend API proxy path compatible.
    "/__clerk/(.*)",
  ],
};
