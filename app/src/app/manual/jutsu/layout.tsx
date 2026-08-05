import type { Metadata } from "next";
import { buildMetadata } from "@/libs/seo";

export const metadata: Metadata = buildMetadata({
  title: "Jutsu",
  description:
    "Every jutsu in TheNinja-RPG. Compare damage, range, cost and effects across ninjutsu, genjutsu, taijutsu and bukijutsu to plan your loadout.",
  path: "/manual/jutsu",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
