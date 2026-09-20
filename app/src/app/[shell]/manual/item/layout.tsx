import type { Metadata } from "next";
import { buildMetadata } from "@/libs/seo";

export const metadata: Metadata = buildMetadata({
  title: "Items",
  description:
    "Every item in TheNinja-RPG: weapons, armour, consumables and crafting materials, with full stats, costs and effects for each.",
  path: "/manual/item",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
