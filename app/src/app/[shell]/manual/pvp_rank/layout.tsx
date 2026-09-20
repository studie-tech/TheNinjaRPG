import type { Metadata } from "next";
import { buildMetadata } from "@/libs/seo";

export const metadata: Metadata = buildMetadata({
  title: "PvP Rankings",
  description:
    "The live PvP leaderboard for TheNinja-RPG. See the top-ranked ninja by rating, win streak and battle record.",
  path: "/manual/pvp_rank",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
