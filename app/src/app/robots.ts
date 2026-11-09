import type { MetadataRoute } from "next";
import { SITE_URL } from "@/libs/seo";

/**
 * Staff tooling is kept crawlable on purpose: those routes carry a noindex
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
        // Build assets stay crawlable: production serves them from
        // /_next/static/immutable/, but a local production build emits them under
        // /_next/static/chunks/, so the path is not stable across build environments
        // and a rule keyed to it could deny Googlebot the JavaScript it needs to render
        // any page. Stale asset URLs listed as crawled but not indexed drop out of the
        // index on their own.
        disallow: ["/api/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
