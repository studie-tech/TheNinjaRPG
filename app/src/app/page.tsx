import type { Metadata } from "next";
import HomeLanding from "@/layout/HomeLanding";
import { absoluteUrl } from "@/libs/seo";

// Referral and campaign links land on /?ref=... and /?utm_source=..., which Google was
// reporting as duplicates of the homepage. A self-referencing canonical folds them back.
export const metadata: Metadata = {
  alternates: { canonical: absoluteUrl("/") },
};

export default function Index() {
  return <HomeLanding />;
}
