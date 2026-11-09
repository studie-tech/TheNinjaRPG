import type { Metadata } from "next";
import { noindexMetadata } from "@/libs/seo";

export const metadata: Metadata = noindexMetadata("Tournaments");

/** Apply tournament-editor noindex metadata without changing the child layout. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
