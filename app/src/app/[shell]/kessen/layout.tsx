import type { Metadata } from "next";
import { buildMetadata } from "@/libs/seo";

/** The guest hall renders in the prerendered page, so the Card Hall is indexable. */
export const metadata: Metadata = buildMetadata({
  title: "Kessen: Free Ninja Card Game in Your Browser",
  description:
    "Kessen is a free best-of-three ninja card duel in your browser. Learn it in six guided lessons, then challenge twelve Circuit opponents from Genin to Kage. No download or account needed.",
  path: "/kessen",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
