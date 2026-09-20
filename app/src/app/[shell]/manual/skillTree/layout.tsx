import type { Metadata } from "next";
import { buildMetadata } from "@/libs/seo";

export const metadata: Metadata = buildMetadata({
  title: "Skill Tree",
  description:
    "The TheNinja-RPG skill tree: every branch, unlock requirement and progression path for building out your ninja.",
  path: "/manual/skillTree",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
