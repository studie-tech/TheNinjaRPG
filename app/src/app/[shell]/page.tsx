import type { Metadata } from "next";
import HomeLanding from "@/layout/HomeLanding";
import { absoluteUrl } from "@/libs/seo";

// Referral and campaign links land on /?ref=... and /?utm_source=...; a self-referencing
// canonical keeps search engines from treating them as duplicates of the homepage.
export const metadata: Metadata = {
  alternates: { canonical: absoluteUrl("/") },
};

export default function Index() {
  return <HomeLanding />;
}
