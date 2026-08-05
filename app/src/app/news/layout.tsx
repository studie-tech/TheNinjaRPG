import type { Metadata } from "next";
import { buildMetadata } from "@/libs/seo";

export const metadata: Metadata = buildMetadata({
  title: "News",
  description:
    "The latest news from TheNinja-RPG: game updates, events, tournaments, balance changes and community announcements.",
  path: "/news",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
