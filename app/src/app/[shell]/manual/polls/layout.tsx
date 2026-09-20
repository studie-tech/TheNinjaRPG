import type { Metadata } from "next";
import { buildMetadata } from "@/libs/seo";

export const metadata: Metadata = buildMetadata({
  title: "Polls",
  description:
    "Community polls shaping the future of TheNinja-RPG. Vote on features, balance changes and upcoming events.",
  path: "/manual/polls",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
