import type { Metadata } from "next";
import { buildMetadata } from "@/libs/seo";

export const metadata: Metadata = buildMetadata({
  title: "Staff Feedback",
  description:
    "Anonymously review the staff of TheNinja-RPG, the free browser-based ninja MMORPG. Only the game owner sees the reviews.",
  path: "/manual/opinions",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
