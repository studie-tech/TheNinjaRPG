/**
 * `_next/static` can be served from a pull zone in front of production (bunny.net),
 * which bills bandwidth rather than requests. The zone caches by the origin's
 * Cache-Control, so those hashed files stay a year, and it answers for that path alone:
 * the cached tRPC batch keeps going to the app, where Vercel's edge already serves it.
 *
 * The zone only ever holds production's assets, so a preview or local build asking it for
 * their own hashed chunks would be served production's 404: it is used on production
 * alone, and only by the `tnr` project, whose domain the zone pulls from.
 *
 * @param {{ cdnUrl: string | undefined, vercelEnv: string | undefined }} env
 * @returns {string | undefined}
 */
export const cdnOrigin = (env) => {
  if (!env.cdnUrl) return undefined;
  if (env.vercelEnv !== "production") return undefined;
  return env.cdnUrl.replace(/\/+$/, "");
};

/**
 * Cross-origin assets are fetched in CORS mode, because Next marks its chunks
 * `crossorigin`, so the directives that name 'self' have to name the zone as well. Only
 * scripts and styles are served from it today; fonts and workers are named defensively,
 * since `public/` and `/sw.js` stay on the origin.
 *
 * @param {string | undefined} origin
 * @returns {string}
 */
export const contentSecurityPolicy = (origin) => {
  const zone = origin ? ` ${origin}` : "";
  const csp = `
  default-src 'self';
  script-src 'self' 'unsafe-eval' 'unsafe-inline' *.google-analytics.com *.analytics.google.com *.googletagmanager.com *.doubleclick.net *.clerk.accounts.dev *.vercel.live *.paypal.com *.paypalobjects.com *.tiny.cloud *.theninja-rpg.com *.theninja-rpg.ai *.opendns.com *.cookiebot.com *.termly.io connect.facebook.net va.vercel-scripts.com *.redditstatic.com analytics.tiktok.com clerk.www.theninja-rpg.ai clerk.www.theninja-rpg.com challenges.cloudflare.com${zone};
  child-src 'self' *.doubleclick.net *.paypal.com ghbtns.com *.youtube.com *.widgetbot.io *.cookiebot.com *.termly.io *.googletagmanager.com https://fastsvr.com https://www.facebook.com challenges.cloudflare.com;
  style-src 'self' 'unsafe-inline' *.googleapis.com *.tiny.cloud${zone};
  img-src * blob: data:;
  media-src 'self' https://uploadthing.b-cdn.net https://*.ufs.sh;
  connect-src *;
  font-src 'self'${zone};
  worker-src 'self' blob:${zone};
`;
  return csp.replace(/\n/g, "");
};
