import type { Metadata } from "next";
import { buildMetadata } from "@/libs/seo";

export const metadata: Metadata = buildMetadata({
  title: "Sector Maps",
  description:
    "Browse the sector maps of Seichi and see how the regions of TheNinja-RPG fit together.",
  path: "/manual/world/sector-maps",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
