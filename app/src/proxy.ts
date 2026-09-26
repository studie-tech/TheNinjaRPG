import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { env } from "@/env/server.mjs";
import { isNativeUserAgent } from "@/libs/native/userAgent";
import { chooseShell, publicPathForShellPath, shellParam } from "@/libs/shell";

/**
 * Paths the matcher admits that are not pages, and so have no variant to rewrite to:
 * the route handlers that need Clerk's context (tRPC, chat, uploads), the .well-known
 * documents, and the metadata image route at the app root. They reach their handler as
 * they arrived; the MCP OAuth documents among them never see auth().
 */
export const isUnshelledPath = (pathname: string) =>
  pathname.startsWith("/api/") ||
  pathname.startsWith("/.well-known/") ||
  pathname === "/opengraph-image";

export default clerkMiddleware(
  async (auth, request) => {
    const { pathname } = request.nextUrl;
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
    // The public URL and its query are untouched, so the router, every link and the
    // referral parameters keep working. The response carries the prerendered page's
    // long s-maxage with no Vary on the cookie: correct on Vercel, whose CDN keys on the
    // rewritten path behind this code, and wrong for any cache in front of it that
    // keyed on the public path. The pull zone that can sit there answers only for
    // /_next/static, which never reaches this.
    const url = request.nextUrl.clone();
    url.pathname = `/${shellParam(variant)}${pathname}`;
    const res = NextResponse.rewrite(url);
    for (const [name, value] of Object.entries(assigned)) {
      res.cookies.set(name, value, { path: "/" });
    }
    return res;
  },
  (request) => ({
    clockSkewInMs: 1000 * 60 * 30,
    // Session refresh must stay on the game origin inside the native WebView; the proxy
    // is served ahead of enabling native traffic so Clerk can verify it.
    frontendApiProxy:
      (env.NATIVE_CLERK_PROXY_ENABLED === "true" &&
        isNativeUserAgent(request.headers.get("user-agent"))) ||
      request.nextUrl.pathname.startsWith("/__clerk/")
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
    "/users/:path*",
    "/forum/:path*",
    "/reports/:path*",
    "/support/:path*",
    "/battlelog/:path*",
    "/anbu/:path*",
    "/clanhall/:path*",
    "/conceptart/:path*",
    "/manual/:path*",
    // Only route handlers that call Clerk's server helpers need its context; the
    // CDN-cached tRPC endpoint runs without a session by design.
    "/api/trpc/((?!cdn/).*)",
    "/api/chat/:path*",
    "/api/minigames/blockstruggle/:path*",
    "/api/uploadthing(.*)",
    // The MCP OAuth discovery documents; isUnshelledPath passes them through untouched.
    "/.well-known/oauth-authorization-server(.*)",
    "/.well-known/oauth-protected-resource(.*)",
    // Keep Clerk's optional frontend API proxy path compatible.
    "/__clerk/(.*)",
  ],
};
