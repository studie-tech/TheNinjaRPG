import { env } from "@/env/server.mjs";

/**
 * Universal Links association file.
 *
 * Apple fetches this over HTTPS with no redirects and expects `application/json` even
 * though the path has no extension. Without it every `theninja-rpg.com` link opens Safari
 * instead of the app, and Sign in with Apple cannot share credentials with the website.
 *
 * The Apple team and bundle identifiers are the same ones APNs is configured with, so they
 * are read from those variables rather than duplicated. When they are unset — local
 * development, or a deployment with no iOS app — this 404s rather than publishing an
 * association Apple would cache as broken.
 */
export const dynamic = "force-dynamic";

export function GET() {
  const appId = iosAppId();
  if (!appId) return new Response("Not found", { status: 404 });

  const association = {
    applinks: {
      details: [
        {
          appIDs: [appId],
          components: [
            // Everything opens in the app except the paths below, which have no in-app
            // equivalent and must stay in the browser.
            { "/": "/api/*", exclude: true, comment: "API and webhooks" },
            { "/": "/.well-known/*", exclude: true, comment: "Association files" },
            { "/": "/sitemap*", exclude: true, comment: "Crawler endpoints" },
            { "/": "/*" },
          ],
        },
      ],
    },
    // Lets the app and the website share passwords and Sign in with Apple credentials.
    webcredentials: { apps: [appId] },
  };

  return new Response(JSON.stringify(association), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

const iosAppId = (): string | null =>
  env.APNS_TEAM_ID && env.APNS_BUNDLE_ID
    ? `${env.APNS_TEAM_ID}.${env.APNS_BUNDLE_ID}`
    : null;
