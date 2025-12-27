import { withSentryConfig } from "@sentry/nextjs";
import bundleAnalyzer from "@next/bundle-analyzer";

// @ts-check
/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation.
 * This is especially useful for Docker builds.
 */
if (!process.env.SKIP_ENV_VALIDATION) {
  await import("./src/env/server.mjs");
}

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

/** @type {import("next").NextConfig} */
const config = {
  reactCompiler: true, // Fix user search, money sending, combat, search jutsu name
  experimental: {
    nextScriptWorkers: true,
    optimizePackageImports: ["three"],
  },
  turbopack: {
    resolveExtensions: [".tsx", ".ts", ".jsx", ".js"],
  },
  generateBuildId: () => process.env.VERCEL_GIT_COMMIT_SHA || "unknown",
  reactStrictMode: false,
  productionBrowserSourceMaps: true,
  outputFileTracingIncludes: {
    "/api/trpc/[trpc]/route": ["./fonts/**"],
  },
  images: {
    unoptimized: true,
    remotePatterns: [
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
        hostname: "ui0arpl8sm.ufs.sh",
      },
    ],
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
    ];
  },
};

// export default withBundleAnalyzer(config);
export default withSentryConfig(withBundleAnalyzer(config), {
  // For all available options, see:
  // https://github.com/getsentry/sentry-webpack-plugin#options

  org: "studie-tech-aps",
  project: "theninjarpg",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Uncomment to route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  // tunnelRoute: "/monitoring",

  // Hides source maps from generated client bundles
  hideSourceMaps: true,

  // Sourcemaps
  sourcemaps: {
    deleteSourceMapsAfterUpload: true,
  },

  // Automatically tree-shake Sentry logger statements to reduce bundle size
  disableLogger: true,

  // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
  // See the following for more information:
  // https://docs.sentry.io/product/crons/
  // https://vercel.com/docs/cron-jobs
  automaticVercelMonitors: true,

  autoInstrumentAppDirectory: true,
  autoInstrumentMiddleware: true,
});

// https://securityheaders.com
const ContentSecurityPolicy = `
  default-src 'self';
  script-src 'self' 'unsafe-eval' 'unsafe-inline' *.google-analytics.com *.analytics.google.com *.googletagmanager.com *.doubleclick.net *.clerk.accounts.dev *.vercel.live *.paypal.com *.paypalobjects.com *.tiny.cloud *.theninja-rpg.com *.opendns.com *.cookiebot.com *.termly.io connect.facebook.net va.vercel-scripts.com *.redditstatic.com;
  child-src 'self' *.doubleclick.net *.paypal.com ghbtns.com *.youtube.com *.widgetbot.io *.cookiebot.com *.termly.io *.googletagmanager.com https://fastsvr.com https://www.facebook.com/;
  style-src 'self' 'unsafe-inline' *.googleapis.com *.tiny.cloud;
  img-src * blob: data:;
  media-src https://uploadthing.b-cdn.net https://*.ufs.sh;
  connect-src *;
  font-src 'self';
  worker-src 'self' blob:;
`;

const securityHeaders = [
  // https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP
  {
    key: "Content-Security-Policy",
    value: ContentSecurityPolicy.replace(/\n/g, ""),
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
