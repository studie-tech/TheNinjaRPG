import type { Metadata } from "next";
import { buildMetadata } from "@/libs/seo";

export const metadata: Metadata = buildMetadata({
  title: "Badges",
  description:
    "Every badge in TheNinja-RPG and how to earn it, across combat, questing, crafting and community milestones.",
  path: "/manual/badge",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
