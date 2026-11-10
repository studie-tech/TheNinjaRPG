// @ts-check
import { withSentryConfig } from "@sentry/nextjs/config";
import { withBotId } from "botid/next/config";
import { cdnOrigin, contentSecurityPolicy } from "./src/libs/cdn.mjs";
import { SITEMAP_SECTIONS } from "./src/libs/sitemapSections.mjs";

/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation.
 * This is especially useful for Docker builds.
 */
if (!process.env.SKIP_ENV_VALIDATION) {
  await import("./src/env/server.mjs");
}

/** Resolved once, so `assetPrefix` and the CSP cannot disagree about where the zone is. */
const CDN_ORIGIN = cdnOrigin({
  cdnUrl: process.env.CDN_URL,
  vercelEnv: process.env.VERCEL_ENV,
});

/**
 * The commit this bundle was built from. It names Next's build and is inlined as
 * `NEXT_PUBLIC_BUILD_ID` so a long-lived tab can tell that the server has moved on to a
 * newer deploy (see `src/libs/buildVersion.ts`).
 */
const BUILD_ID = process.env.VERCEL_GIT_COMMIT_SHA || "unknown";

/** @type {import("next").NextConfig} */
const config = {
  reactCompiler: true,
  experimental: {
    // TypeScript 7 ships a native CLI rather than the JavaScript compiler API.
    useTypeScriptCli: true,
    globalNotFound: true,
    // Browsers refuse cross-origin worker scripts and Turbopack's worker bootstrap loads
    // same-origin chunks only, so behind the zone workers and their chunks come from the
    // app's own origin. Without a zone the option is left out: under `next dev` it sends
    // every page into a hot-reload restart loop.
    ...(CDN_ORIGIN ? { turbopackWorkerAssetPrefix: "" } : {}),
  },
  turbopack: {
    resolveExtensions: [".tsx", ".ts", ".jsx", ".js"],
  },
  generateBuildId: () => BUILD_ID,
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID, NEXT_PUBLIC_VERCEL_ENV: process.env.VERCEL_ENV },
  assetPrefix: CDN_ORIGIN,
  reactStrictMode: false,
  productionBrowserSourceMaps: true,
  outputFileTracingIncludes: {
    "/api/trpc/[trpc]/route": ["./fonts/**"],
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: "https", hostname: "cdn.shopify.com" },
      { protocol: "https", hostname: "files.cdn.printful.com" },
      {
        protocol: "https",
        hostname: "theninja-user-uploads.s3.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "theninja-user-uploads.s3.us-west-2.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "assets.cdndn.com",
      },
      {
        protocol: "https",
        hostname: "uploadthing.com",
      },
      {
        protocol: "https",
        hostname: "utfs.io",
      },
      {
        protocol: "https",
        hostname: "uploadthing.b-cdn.net",
      },
      {
        protocol: "https",
        hostname: "tnr-storage-cdn.b-cdn.net",
      },
      {
        protocol: "https",
        hostname: "ui0arpl8sm.ufs.sh",
      },
    ],
  },
  async redirects() {
    return [
      // Referral links from the original PHP game are still in circulation and
      // land on /index.php?ref=<username>. Next forwards the query string, so
      // the referral is preserved instead of dead-ending on the 404 page.
      {
        source: "/index.php",
        destination: "/",
        permanent: true,
      },
      {
        source: "/register.php",
        // Welcome stores recruiter and consented campaign attribution before signup.
        destination: "/",
        permanent: true,
      },
      {
        source: "/Manual/doku.php",
        destination: "/manual",
        permanent: true,
      },
      // The PHP forum's thread and board URLs are still linked from off-site and were
      // reported as soft 404s. Point the whole family at the current forum rather than
      // letting them resolve to the 404 page. Note that Vercel's firewall answers some
      // .php probe paths at the edge, so these only apply to requests that reach Next.
      {
        source: "/:prefix(forums|forum)/:script(showthread|forumdisplay|index).php",
        destination: "/forum",
        permanent: true,
      },
      {
        source: "/:script(showthread|forumdisplay|forum).php",
        destination: "/forum",
        permanent: true,
      },
      // /manual/travel is linked from off-site and 404s; travel docs live in the guide.
      {
        source: "/manual/travel",
        destination: "/guide/world",
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/",
        headers: securityHeaders,
      },
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        // Next marks its chunks `crossorigin`, so cross-origin delivery needs this.
        // Vercel already sends it for static files; stating it keeps the zone correct
        // wherever the app is hosted.
        source: "/_next/static/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          // The zone answers on its own hostname, which must not become a second
          // indexable home for these files. robots.txt cannot say so: the zone serves
          // nothing but this path.
          { key: "X-Robots-Tag", value: "noindex" },
        ],
      },
      {
        // The sitemaps are generated per request (they read the database and the build
        // has none), so they are cached at the edge instead. Crawlers fetch them rarely,
        // and a stale copy for an hour is harmless. The section names are listed rather
        // than matched with a wildcard so a typo'd /sitemap-<anything>.xml does not get
        // its 404 cached at the edge for an hour.
        source: `/:sitemap(sitemap|${SITEMAP_SECTIONS.map((section) => `sitemap-${section}`).join("|")}).xml`,
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
          },
        ],
      },
    ];
  },
};

// withBotId adds the same-origin rewrites that serve the BotID challenge script (see
// src/libs/botid.ts); src/proxy.ts keeps its path prefix out of the shell rewrite.
export default withSentryConfig(withBotId(config), {
  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  org: "studie-tech-aps",
  project: "theninjarpg",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Sourcemaps
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },

  webpack: {
    // Tree-shake Sentry logger statements to reduce bundle size (applied on Turbopack too)
    treeshake: {
      removeDebugLogging: true,
    },
  },
});

// https://securityheaders.com
const securityHeaders = [
  // https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP
  {
    key: "Content-Security-Policy",
    value: contentSecurityPolicy(CDN_ORIGIN),
  },
  // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Referrer-Policy
  {
    key: "Referrer-Policy",
    value: "origin-when-cross-origin",
  },
  // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Frame-Options
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Content-Type-Options
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-DNS-Prefetch-Control
  {
    key: "X-DNS-Prefetch-Control",
    value: "on",
  },
  // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains; preload",
  },
  // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Feature-Policy
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];
