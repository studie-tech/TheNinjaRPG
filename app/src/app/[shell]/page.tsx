import type { Metadata } from "next";
import HomeLanding from "@/layout/HomeLanding";
import {
  absoluteUrl,
  OG_IMAGE_PATH,
  SITE_NAME,
  SITE_OPEN_GRAPH,
  SITE_TWITTER,
} from "@/libs/seo";

// Referral and campaign links land on /?ref=... and /?utm_source=..., which Google was
// reporting as duplicates of the homepage. A self-referencing canonical folds them back.
//
// The card is the generated one at the app root, named explicitly: the layout's config
// metadata sits in the shell segment below that root, and a deeper segment's config
// replaces a parent's file-based image, which would leave the homepage on the logo.
const card = {
  url: absoluteUrl(OG_IMAGE_PATH),
  width: 1200,
  height: 630,
  alt: SITE_NAME,
};

export const metadata: Metadata = {
  alternates: { canonical: absoluteUrl("/") },
  openGraph: { ...SITE_OPEN_GRAPH, images: [card] },
  twitter: { ...SITE_TWITTER, images: [card] },
};

export default function Index() {
  return <HomeLanding />;
}
