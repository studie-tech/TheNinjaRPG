import { clerkMiddleware } from "@clerk/nextjs/server";
import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/env/server.mjs";
import { isNativeUserAgent } from "@/libs/native/userAgent";
import { chooseShell, publicPathForShellPath, shellParam } from "@/libs/shell";

const isMcpRoute = (pathname: string) =>
  pathname === "/api/mcp" ||
  pathname.startsWith("/api/mcp/") ||
  pathname.startsWith("/.well-known/oauth-authorization-server") ||
  pathname.startsWith("/.well-known/oauth-protected-resource");

/**
 * Paths the matcher admits that are not pages, and so have no variant to rewrite to:
 * the route handlers that need Clerk's context (tRPC, chat, uploads), the .well-known
 * documents, the metadata image route at the app root, and Clerk's own proxy, which the
 * middleware wrapper serves itself. They reach their handler as they arrived.
 */
export const isUnshelledPath = (pathname: string) =>
  pathname.startsWith("/api/") ||
  pathname.startsWith("/.well-known/") ||
  pathname.startsWith("/__clerk/") ||
  pathname === "/opengraph-image";

/**
 * Whether Clerk must load through the same-origin proxy for this request. Session
 * refresh has to stay on the game origin inside the native WebView, and the proxy is
 * only served while the flag is on.
 */
const usesNativeClerkProxy = (request: NextRequest) =>
  env.NATIVE_CLERK_PROXY_ENABLED === "true" &&
  isNativeUserAgent(request.headers.get("user-agent"));

export default clerkMiddleware(
  async (auth, request) => {
    const { pathname } = request.nextUrl;

    // Skip auth() call for MCP routes - they handle OAuth tokens separately
    if (isMcpRoute(pathname)) {
      return NextResponse.next();
    }
    if (isUnshelledPath(pathname)) return;

    // The variant segment is internal to the rewrite below. A request that names one
    // outright -- a leaked link, a guess -- goes back to the public URL it stands for,
    // which then picks the variant that actually matches the visitor.
    const publicPath = publicPathForShellPath(pathname);
    if (publicPath !== null) {
      const url = request.nextUrl.clone();
      url.pathname = publicPath;
      return NextResponse.redirect(url);
    }

    const { userId } = await auth();
    const { variant, assigned } = chooseShell({
      userAgent: request.headers.get("user-agent"),
      pathname,
      userId,
      cookies: new Map(
        request.cookies.getAll().map(({ name, value }) => [name, value]),
      ),
      draw: () => (Math.random() < 0.5 ? "treatment" : "control"),
    });
    // The public URL is untouched -- the router and every link keep working on it --
    // and the original query travels with the rewrite, so the page still sees referral
    // parameters. The response carries the prerendered page's long s-maxage and no Vary
    // on the cookie, which is right on Vercel, where the CDN keys on the rewritten path
    // and this code runs ahead of every lookup. A cache in front of the platform that
    // keyed on the public path would hand one visitor's variant to the next; nothing sits
    // there today.
    const url = request.nextUrl.clone();
    url.pathname = `/${shellParam(variant)}${pathname}`;
    const res = NextResponse.rewrite(url);
    for (const [name, value] of Object.entries(assigned)) {
      if (value) res.cookies.set(name, value, { path: "/" });
    }
    return res;
  },
  (request) => ({
    clockSkewInMs: 1000 * 60 * 30,
    // Serve the SDK proxy before enabling native traffic, so Clerk can verify it.
    frontendApiProxy:
      usesNativeClerkProxy(request) || request.nextUrl.pathname.startsWith("/__clerk/")
        ? { enabled: true }
        : undefined,
  }),
);

export const config = {
  matcher: [
    /*
     * Skip Next internals, legacy static files, and paths whose last segment looks
     * like a file. URLs with no matching route render through global-not-found.tsx
     * without the root layout, so missing assets and scanner probes remain cheap 404
     * responses. Only the last segment counts: a dotted earlier segment (/x.php/guide)
     * must still be rewritten, or it would match the shell segment with the file name as
     * its value and render the page beneath it into a 404. Paths that do resolve to a
     * route are re-added explicitly below.
     */
    "/((?!api(?:/|$)|trpc(?:/|$)|_next(?:/|$)|static(?:/|$)|[^?]*\\.[^/?]+$).*)",
    /*
     * A shell variant path is always redirected to the public one, including when the
     * rest of it is file-like and the skip above would otherwise let it resolve under
     * the variant URL. Kept in step with SHELL_PARAMS by a test.
     */
    "/(web|ios|android)-(default|pixel)-(in|out)/:path*",
    /*
     * Optional catch-all routes are the exception to the file-like skip above:
     * they render the Clerk-dependent root layout for paths such as
     * /signup/administration/index.php, which scanners probe for. Without the
     * proxy those requests reach auth() with no Clerk context and throw.
     */
    "/login(.*)",
    "/signup(.*)",
    /*
     * Dynamic route params legitimately contain dots: usernames, IP addresses, and
     * hotlinked "profile.gif" URLs. Those routes resolve, so they render the
     * Clerk-dependent root layout and must not be skipped as file-like paths.
     */
    "/username/:path*",
    "/userid/:path*",
    "/guide/:path*",
    "/users/:path*",
    "/forum/:path*",
    "/reports/:path*",
    "/support/:path*",
    "/battlelog/:path*",
    "/anbu/:path*",
    "/clanhall/:path*",
    "/conceptart/:path*",
    "/manual/:path*",
    // Only route handlers that call Clerk's server helpers need its context.
    "/api/trpc/(.*)",
    "/api/chat/:path*",
    "/api/uploadthing(.*)",
    // MCP OAuth endpoints intentionally bypass Clerk auth in the callback above.
    "/.well-known/oauth-authorization-server(.*)",
    "/.well-known/oauth-protected-resource(.*)",
    // Keep Clerk's optional frontend API proxy path compatible.
    "/__clerk/(.*)",
  ],
};
