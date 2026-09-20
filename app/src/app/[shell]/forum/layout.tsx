import type { Metadata } from "next";
import { buildMetadata } from "@/libs/seo";

export const metadata: Metadata = buildMetadata({
  title: "Forums",
  description:
    "The TheNinja-RPG community forums. Discuss strategy, share builds, ask questions and help shape the game.",
  path: "/forum",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
