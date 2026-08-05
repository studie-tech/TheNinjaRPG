import type { Metadata } from "next";
import { buildMetadata } from "@/libs/seo";

export const metadata: Metadata = buildMetadata({
  title: "Combat System",
  description:
    "How combat works in TheNinja-RPG: turn order, action points, damage calculation, status effects and the stats behind every fight.",
  path: "/manual/combat",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
