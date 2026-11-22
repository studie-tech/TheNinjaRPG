import type { Metadata } from "next";
import { buildMetadata } from "@/libs/seo";

export const metadata: Metadata = buildMetadata({
  title: "Kessen Leaderboard",
  description:
    "The best Kessen card duelists in TheNinja-RPG right now, ranked by the Elo rating they earn in ranked duels.",
  path: "/kessen/leaderboard",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
