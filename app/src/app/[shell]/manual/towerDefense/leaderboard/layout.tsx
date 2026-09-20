import type { Metadata } from "next";
import { buildMetadata } from "@/libs/seo";

export const metadata: Metadata = buildMetadata({
  title: "Tower Defense Leaderboard",
  description:
    "Top tower defense runs in TheNinja-RPG, ranked by wave reached and score.",
  path: "/manual/towerDefense/leaderboard",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
