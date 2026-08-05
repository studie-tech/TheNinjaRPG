import type { Metadata } from "next";
import { buildMetadata } from "@/libs/seo";

export const metadata: Metadata = buildMetadata({
  title: "Tower Defense",
  description:
    "The tower defense minigame in TheNinja-RPG: how rounds work, the tower types available and the rewards on offer.",
  path: "/manual/towerDefense",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
