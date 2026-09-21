import { clerkMiddleware } from "@clerk/nextjs/server";
import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/env/server.mjs";
import {
  AB_PIXEL_LAYOUT_COOKIE,
  cookieValueToLayout,
  type EffectiveLayout,
  FONT_SCALE_COOKIE,
  LAYOUT_PREFERENCE_COOKIE,
  LEGACY_AB_LAYOUT_COOKIE,
} from "@/libs/layoutPreference";
import { isNativeUserAgent } from "@/libs/native/userAgent";
import { publicPathForShellPath, type ShellVariant, shellParam } from "@/libs/shell";

const isMcpRoute = (pathname: string) =>
  pathname === "/api/mcp" ||
  pathname.startsWith("/api/mcp/") ||
  pathname.startsWith("/.well-known/oauth-authorization-server") ||
  pathname.startsWith("/.well-known/oauth-protected-resource");

/**
 * Paths the matcher lets through that are not pages, and so have no variant to rewrite
 * to. The matcher admits the route handlers that need Clerk's context (tRPC, chat,
 * uploads, the OAuth discovery documents) precisely so the wrapper can attach it; they
 * must then reach their handler as they arrived. The metadata image route lives at the
 * app root, and Clerk's own proxy is served by the wrapper itself.
 */
export const isUnshelledPath = (pathname: string) =>
  pathname === "/api" ||
  pathname.startsWith("/api/") ||
  pathname.startsWith("/.well-known/") ||
  pathname.startsWith("/__clerk/") ||
  pathname === "/opengraph-image";

const appendCookieHeader = (
  existingCookieHeader: string | null,
  name: string,
  value: string,
) => {
  const cookie = `${name}=${value}`;
  return existingCookieHeader ? `${existingCookieHeader}; ${cookie}` : cookie;
};

/**
 * Search engines and social preview services discard cookies between fetches, so the
 * random landing-page assignment below would hand them a different variant — different
 * headings, copy and hero asset — on every crawl of the site's highest-value URL.
 * Anything matching here is pinned to a single variant instead.
 *
 * Control is chosen because it renders the long-form section copy (Jutsus, Combat,
 * Village, Sectors, Travel), roughly twice the indexable text of the pixel variant.
 * Both are variants real visitors receive, so this is an A/B split rather than
 * crawler-specific content. Note that Welcome.tsx hides that copy when
 * NEXT_PUBLIC_MCP_ENABLED is set, so enabling MCP in production would leave crawlers
 * on a near-empty landing page and this choice should be revisited.
 */
const PINNED_CRAWLER_VARIANT = "control";

const CRAWLER_USER_AGENT =
  /bot|crawler|spider|crawling|slurp|mediapartners|facebookexternalhit|bingpreview|whatsapp|telegram|embedly|quora link preview|pinterest|vkshare|w3c_validator|lighthouse|chrome-lighthouse/i;

const isSearchCrawler = (userAgent: string | null) =>
  !!userAgent && CRAWLER_USER_AGENT.test(userAgent);

/**
 * Whether Clerk must load through the same-origin proxy for this request. Session
 * refresh has to stay on the game origin inside the native WebView, and the proxy is
 * only served while the flag is on, so both conditions gate the native shell variant.
 */
const usesNativeClerkProxy = (request: NextRequest) =>
  env.NATIVE_CLERK_PROXY_ENABLED === "true" &&
  isNativeUserAgent(request.headers.get("user-agent"));

/**
 * Rewrite a request to the prerendered shell variant that matches it. The public URL is
 * untouched -- the router, usePathname and every link keep working on it -- and the
 * original query travels with the rewrite, so the page still sees referral parameters.
 *
 * The response carries the prerendered page's long s-maxage and no Vary on the cookie,
 * which is right on Vercel, where the CDN keys on the rewritten path and this code runs
 * ahead of every lookup. A cache in front of the platform that keys on the public path
 * would hand one visitor's variant to the next; nothing sits there today.
 */
const rewriteToShell = (
  request: NextRequest,
  variant: ShellVariant,
  requestHeaders: Headers,
) => {
  const url = request.nextUrl.clone();
  url.pathname = `/${shellParam(variant)}${request.nextUrl.pathname}`;
  return NextResponse.rewrite(url, { request: { headers: requestHeaders } });
};

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

    const client: ShellVariant["client"] = usesNativeClerkProxy(request)
      ? "native"
      : "web";

    // Crawlers are never signed in, so pin them to the control layout before the auth()
    // round-trip. The user-agent match is broad enough to catch a person whose browser
    // string contains "bot"; one carrying a session is a person, not a crawler, and takes
    // the ordinary path below so every page renders in the frame and layout they chose.
    // For a crawler the preference and font-scale cookies are pinned too, so the document
    // it gets is the default layout at the default size, the same for every crawl.
    const hasSession = request.cookies
      .getAll()
      .some(({ name }) => name.startsWith("__session"));
    if (!hasSession && isSearchCrawler(request.headers.get("user-agent"))) {
      const pinned = new Set([
        LEGACY_AB_LAYOUT_COOKIE,
        AB_PIXEL_LAYOUT_COOKIE,
        LAYOUT_PREFERENCE_COOKIE,
        FONT_SCALE_COOKIE,
      ]);
      const preserved = request.cookies
        .getAll()
        .filter(({ name }) => !pinned.has(name))
        .map(({ name, value }) => `${name}=${value}`);
      const requestHeaders = new Headers(request.headers);
      requestHeaders.set(
        "cookie",
        [
          ...preserved,
          `${LEGACY_AB_LAYOUT_COOKIE}=${PINNED_CRAWLER_VARIANT}`,
          `${AB_PIXEL_LAYOUT_COOKIE}=${PINNED_CRAWLER_VARIANT}`,
        ].join("; "),
      );
      return rewriteToShell(
        request,
        { client, layout: "default", signedIn: false },
        requestHeaders,
      );
    }

    const { userId } = await auth();
    const requestHeaders = new Headers(request.headers);
    const cookie = request.cookies.get(LEGACY_AB_LAYOUT_COOKIE);
    const pixelCookie = request.cookies.get(AB_PIXEL_LAYOUT_COOKIE);
    const isLandingVisit = !userId && pathname === "/";
    // Signed-out visitors are assigned their experiment variants on the landing page,
    // and the assignment is written into the request so this very render uses it. Any
    // other page keeps whatever the visitor already carries, as the layout always did.
    const variant =
      cookie?.value ??
      (isLandingVisit ? (Math.random() < 0.5 ? "treatment" : "control") : undefined);
    const pixelVariant =
      pixelCookie?.value ??
      (isLandingVisit ? (Math.random() < 0.5 ? "treatment" : "control") : undefined);
    // Same precedence the root layout applied when it read the cookies itself: an
    // explicit preference beats the experiment assignment, and a fresh assignment is
    // the one just drawn above.
    const layout: EffectiveLayout =
      cookieValueToLayout(request.cookies.get(LAYOUT_PREFERENCE_COOKIE)?.value) ??
      cookieValueToLayout(pixelVariant) ??
      "default";
    let cookieHeader = requestHeaders.get("cookie");
    if (!cookie && variant) {
      cookieHeader = appendCookieHeader(cookieHeader, LEGACY_AB_LAYOUT_COOKIE, variant);
    }
    if (!pixelCookie && pixelVariant) {
      cookieHeader = appendCookieHeader(
        cookieHeader,
        AB_PIXEL_LAYOUT_COOKIE,
        pixelVariant,
      );
    }
    if (cookieHeader) requestHeaders.set("cookie", cookieHeader);
    const res = rewriteToShell(
      request,
      { client, layout, signedIn: !!userId },
      requestHeaders,
    );
    if (!cookie && variant)
      res.cookies.set(LEGACY_AB_LAYOUT_COOKIE, variant, { path: "/" });
    if (!pixelCookie && pixelVariant) {
      res.cookies.set(AB_PIXEL_LAYOUT_COOKIE, pixelVariant, { path: "/" });
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
     * Skip Next internals, legacy static files, and any file-like path. URLs with no
     * matching route render through global-not-found.tsx without the root layout, so
     * missing assets and scanner probes remain cheap 404 responses. Paths that do
     * resolve to a route are re-added explicitly below.
     */
    "/((?!api(?:/|$)|trpc(?:/|$)|_next(?:/|$)|static(?:/|$)|[^?]*\\.[^/?]+).*)",
    /*
     * A shell variant path is always redirected to the public one, including when the
     * rest of it is file-like and the skip above would otherwise let it resolve under
     * the variant URL.
     */
    "/(web|native)-(default|pixel)-(in|out)/:path*",
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
