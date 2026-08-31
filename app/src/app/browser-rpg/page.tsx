import type { Metadata } from "next";
import LandingPage from "@/layout/LandingPage";
import { LANDING_PAGES } from "@/libs/landing";
import { buildMetadata } from "@/libs/seo";

const content = LANDING_PAGES["browser-rpg"];

export const metadata: Metadata = buildMetadata({
  title: content.title,
  description: content.description,
  path: content.path,
});

export default function Page() {
  return <LandingPage content={content} />;
}
