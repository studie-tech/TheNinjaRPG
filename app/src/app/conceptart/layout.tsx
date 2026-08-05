import type { Metadata } from "next";
import { buildMetadata } from "@/libs/seo";

export const metadata: Metadata = buildMetadata({
  title: "Concept Art",
  description:
    "AI-generated concept art from the world of TheNinja-RPG, created by the community.",
  path: "/conceptart",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
