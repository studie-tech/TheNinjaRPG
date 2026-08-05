import type { Metadata } from "next";
import { buildMetadata } from "@/libs/seo";

export const metadata: Metadata = buildMetadata({
  title: "Awards",
  description:
    "Awards handed out in TheNinja-RPG for tournaments, events and community contributions.",
  path: "/manual/awards",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
