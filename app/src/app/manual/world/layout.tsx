import type { Metadata } from "next";
import { buildMetadata } from "@/libs/seo";

export const metadata: Metadata = buildMetadata({
  title: "World & Travel",
  description:
    "Explore Seichi: the villages, sectors and global map of TheNinja-RPG, and how travel between regions works.",
  path: "/manual/world",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
