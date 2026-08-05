import type { Metadata } from "next";
import { buildMetadata } from "@/libs/seo";

export const metadata: Metadata = buildMetadata({
  title: "Crafting Recipes",
  description:
    "Every crafting recipe in TheNinja-RPG: the materials, stations and outputs for crafting weapons, armour and consumables.",
  path: "/manual/crafting_recipes",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
