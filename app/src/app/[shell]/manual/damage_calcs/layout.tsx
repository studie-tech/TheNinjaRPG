import type { Metadata } from "next";
import { buildMetadata } from "@/libs/seo";

export const metadata: Metadata = buildMetadata({
  title: "Damage Calculator",
  description:
    "Simulate combat damage in TheNinja-RPG. Compare jutsu, stats and gear to see exactly how much damage a build deals.",
  path: "/manual/damage_calcs",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
