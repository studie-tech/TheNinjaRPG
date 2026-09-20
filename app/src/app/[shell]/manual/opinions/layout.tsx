import type { Metadata } from "next";
import { buildMetadata } from "@/libs/seo";

export const metadata: Metadata = buildMetadata({
  title: "Player Reviews",
  description:
    "Read what players say about TheNinja-RPG, and leave your own review of the free browser-based ninja MMORPG.",
  path: "/manual/opinions",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
