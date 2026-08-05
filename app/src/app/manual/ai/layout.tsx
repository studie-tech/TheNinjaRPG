import type { Metadata } from "next";
import { buildMetadata } from "@/libs/seo";

export const metadata: Metadata = buildMetadata({
  title: "AI Opponents",
  description:
    "Browse the AI opponents of TheNinja-RPG. Compare stats, jutsu and difficulty for every trainable and hostile NPC in the game.",
  path: "/manual/ai",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
