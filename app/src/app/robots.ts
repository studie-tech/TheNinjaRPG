import type { MetadataRoute } from "next";
import { SITE_URL } from "@/libs/seo";

/**
 * Replaces the previous static public/robots.txt, which advertised no sitemap and gave
 * preview deployments the same "index everything" rules as production.
 *
 * Note that staff tooling is kept crawlable on purpose: those routes carry a noindex
 * meta tag, and Google has to be able to fetch a page to see that tag. Disallowing them
 * here would strand the already-indexed ones in the index without a description.
 */
export default function robots(): MetadataRoute.Robots {
  // Preview and branch deployments must never compete with production in the index.
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // API routes return JSON and never belong in search results.
        //
        // Build assets are deliberately left crawlable, even though most of the 3,481
        // URLs Search Console reports as "Crawled - currently not indexed" are dead
        // /_next/static/chunks/*.js?dpl=<id> assets from deploys that minted a fresh URL
        // for every build. Disallowing that path is not safe: production currently
        // serves live assets from /_next/static/immutable/, but a production build of
        // this repo run locally emits them under /_next/static/chunks/ instead, so the
        // path is not stable across build environments and a rule keyed to it could
        // deny Googlebot the JavaScript it needs to render any page. The ?dpl= cache
        // buster is gone, so the dead URLs age out of the index on their own.
        disallow: ["/api/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
