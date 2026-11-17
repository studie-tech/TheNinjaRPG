import type { Metadata } from "next";
import { buildMetadata } from "@/libs/seo";

export const metadata: Metadata = buildMetadata({
  title: "Tower Defense",
  description:
    "The tower defense minigame in TheNinja-RPG: endless waves, eras that change the rules, hand seals, sentries, ultimates and permanent Guard Hall training.",
  path: "/manual/towerDefense",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
