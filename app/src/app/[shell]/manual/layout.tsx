import type { Metadata } from "next";
import { buildMetadata } from "@/libs/seo";

export const metadata: Metadata = buildMetadata({
  title: "Game Manual",
  description:
    "The complete guide to TheNinja-RPG: combat, jutsu, bloodlines, items, quests, villages and travel across the ninja world of Seichi.",
  path: "/manual",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
