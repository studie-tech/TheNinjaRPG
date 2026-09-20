import type { Metadata } from "next";
import { buildMetadata } from "@/libs/seo";

export const metadata: Metadata = buildMetadata({
  title: "Game Assets",
  description:
    "Browse the game assets used across the world, combat and interface of TheNinja-RPG.",
  path: "/manual/asset",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
