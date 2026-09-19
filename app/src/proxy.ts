import { clerkMiddleware } from "@clerk/nextjs/server";
import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/env/server.mjs";
import {
  AB_PIXEL_LAYOUT_COOKIE,
  cookieValueToLayout,
  DEFAULT_FONT_SCALE,
  type EffectiveLayout,
  FONT_SCALE_COOKIE,
  LAYOUT_PREFERENCE_COOKIE,
  LEGACY_AB_LAYOUT_COOKIE,
  toFontScale,
} from "@/libs/layoutPreference";
import { isNativeUserAgent } from "@/libs/native/userAgent";

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

/**
 * Query parameter that keys the signed-out homepage in the CDN cache.
 *
 * The root layout reads the session and the layout cookies on every request, so every
 * response is dynamic and, as far as Next is concerned, private. For the signed-out
 * homepage that is wasted work: the page is a client-hydrated marketing shell whose
 * server render depends on nothing but which layout variant the visitor is in. Speed
 * Insights put its TTFB at 1.2-1.6s (3s+ far from the function's region) because every
 * visit ran the full render on a function, most of them cold.
 *
 * Rewriting those visits to /?landing=<variant> gives them a URL of their own. The
 * rewrite response marks it cacheable, and Vercel keys its edge cache on the rewritten
 * URL, so the first anonymous visitor in a variant warms it for everyone after. A value
 * arriving in the request itself is overridden by the one set here, so nobody can pick
 * the key a render is stored under. Plain "/" keeps its private, no-store response, and
 * only signed-in visitors reach it, so a cached shell can never be served to a session.
 */
const LANDING_CACHE_PARAM = "landing";

/**
 * Ten minutes at the edge, then a day of serving stale while a fresh copy renders in the
 * background. Deploys reset the cache on their own.
 *
 * Sent as CDN-Cache-Control, and from here rather than anywhere else, because on Vercel
 * nothing else reaches the cache from a middleware rewrite. A plain Cache-Control on this
 * response loses to the private, no-store one the function emits for a dynamic route;
 * Vercel-CDN-Cache-Control set here is dropped somewhere between the middleware and the
 * cache, though it works from a function; a next.config header rule never matches,
 * since those rules see the URL and headers as they arrived, not as the rewrite left
 * them. Each was tried alone on a preview and only this one produced a HIT. The browser
 * still receives the function's private, no-store as its Cache-Control -- which is
 * right: the client hydrates the real session state, and only the edge should ever
 * serve one visitor's render to another. Browsers ignore CDN-Cache-Control, and nothing
 * sits between them and Vercel that would read it.
 */
const LANDING_CACHE_CONTROL = "public, s-maxage=600, stale-while-revalidate=86400";

/**
 * The URL to rewrite a signed-out homepage visit to, or null when the visit must not
 * share a cached response. Native shells need a per-request Clerk proxy setting from the
 * root layout, and a non-default font scale is inlined into the document root, so neither
 * can be served a copy rendered for someone else.
 */
export const landingCacheUrl = (request: NextRequest, layout: EffectiveLayout) => {
  // Belt and braces on top of the auth() check in the signed-out branch, and the only
  // guard in the crawler branch, which runs before auth() on purpose. That branch's
  // user-agent match is broad enough to catch a signed-in person whose browser string
  // contains "bot", and their Clerk cookies are preserved so they keep their session --
  // which means the shell would render signed in, and a cached copy of it would go to
  // Googlebot and every anonymous visitor after. A session cookie disqualifies the
  // response from the shared cache outright.
  if (request.cookies.getAll().some(({ name }) => name.startsWith("__session"))) {
    return null;
  }
  if (isNativeUserAgent(request.headers.get("user-agent"))) return null;
  const fontScale = toFontScale(request.cookies.get(FONT_SCALE_COOKIE)?.value);
  if (fontScale !== undefined && fontScale !== DEFAULT_FONT_SCALE) return null;
  // Referral and campaign parameters are read on the client from the browser URL, which
  // a rewrite leaves untouched, so nothing server-side needs them. Vercel merges the
  // original query back into the rewrite destination regardless, so a referral link
  // still gets a cache entry of its own; the plain URL, which is most visits and every
  // crawl, shares one per variant.
  const url = request.nextUrl.clone();
  url.search = "";
  url.searchParams.set(LANDING_CACHE_PARAM, layout);
  return url;
};

const CRAWLER_USER_AGENT =
  /bot|crawler|spider|crawling|slurp|mediapartners|facebookexternalhit|bingpreview|whatsapp|telegram|embedly|quora link preview|pinterest|vkshare|w3c_validator|lighthouse|chrome-lighthouse/i;

const isSearchCrawler = (userAgent: string | null) =>
  !!userAgent && CRAWLER_USER_AGENT.test(userAgent);

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

    // Crawlers are never signed in, so pin them to the control layout before the auth()
    // round-trip. No Set-Cookie is issued, which also keeps the response CDN-cacheable.
    if (isSearchCrawler(request.headers.get("user-agent"))) {
      const cacheUrl = landingCacheUrl(request, "default");
      const requestHeaders = new Headers(request.headers);
      // Only the layout cookies are overridden. The user-agent match is broad enough to
      // catch a signed-in visitor whose browser string contains "bot", and replacing the
      // whole header would drop their Clerk session before auth runs.
      // When the render will be cached, the preference and font-scale cookies go too:
      // the root layout reads the preference ahead of the experiment cookie, so leaving
      // it in place would render one layout and store it under the other's cache key.
      // A render that stays private keeps them, so that signed-in visitor still gets
      // the layout and font they chose.
      const pinned = new Set([
        LEGACY_AB_LAYOUT_COOKIE,
        AB_PIXEL_LAYOUT_COOKIE,
        ...(cacheUrl ? [LAYOUT_PREFERENCE_COOKIE, FONT_SCALE_COOKIE] : []),
      ]);
      const preserved = request.cookies
        .getAll()
        .filter(({ name }) => !pinned.has(name))
        .map(({ name, value }) => `${name}=${value}`);
      requestHeaders.set(
        "cookie",
        [
          ...preserved,
          `${LEGACY_AB_LAYOUT_COOKIE}=${PINNED_CRAWLER_VARIANT}`,
          `${AB_PIXEL_LAYOUT_COOKIE}=${PINNED_CRAWLER_VARIANT}`,
        ].join("; "),
      );
      const res = NextResponse.rewrite(cacheUrl ?? request.nextUrl.clone(), {
        request: { headers: requestHeaders },
      });
      if (cacheUrl) res.headers.set("CDN-Cache-Control", LANDING_CACHE_CONTROL);
      return res;
    }

    const { userId } = await auth();
    if (!userId) {
      const cookie = request.cookies.get(LEGACY_AB_LAYOUT_COOKIE);
      const variant = cookie?.value ?? (Math.random() < 0.5 ? "treatment" : "control");
      const pixelCookie = request.cookies.get(AB_PIXEL_LAYOUT_COOKIE);
      const pixelVariant =
        pixelCookie?.value ?? (Math.random() < 0.5 ? "treatment" : "control");
      // Same precedence the root layout applies: an explicit preference beats the
      // experiment assignment, and a fresh assignment is the one just drawn above.
      const layout =
        cookieValueToLayout(request.cookies.get(LAYOUT_PREFERENCE_COOKIE)?.value) ??
        cookieValueToLayout(pixelVariant) ??
        "default";
      const cacheUrl = landingCacheUrl(request, layout);
      const url = cacheUrl ?? request.nextUrl.clone();
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
      if (cacheUrl) res.headers.set("CDN-Cache-Control", LANDING_CACHE_CONTROL);
      return res;
    }
  },
  (request) => {
    const useNativeProxy =
      env.NATIVE_CLERK_PROXY_ENABLED === "true" &&
      isNativeUserAgent(request.headers.get("user-agent"));
    return {
      clockSkewInMs: 1000 * 60 * 30,
      // Serve the SDK proxy before enabling native traffic, so Clerk can verify it.
      // Session refresh must stay on the game origin inside the native WebView.
      frontendApiProxy:
        useNativeProxy || request.nextUrl.pathname.startsWith("/__clerk/")
          ? { enabled: true }
          : undefined,
    };
  },
);

export const config = {
  matcher: [
    /*
     * Skip Next internals, legacy static files, and any file-like path. URLs with no
     * matching route render through global-not-found.tsx without the Clerk-dependent
     * root layout, so missing assets and scanner probes remain cheap 404 responses.
     * Paths that do resolve to a route are re-added explicitly below.
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
