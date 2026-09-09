import type { Metadata } from "next";
import { buildMetadata } from "@/libs/seo";

export const metadata: Metadata = buildMetadata({
  title: "TheNinja-RPG Guide",
  description:
    "How to play TheNinja-RPG: getting started in Seichi, combat, farming, bloodlines, villages and ranks. The official first-party wiki for this free ninja browser game.",
  path: "/guide",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
