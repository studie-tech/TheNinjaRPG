import type { Metadata } from "next";
import { noindexMetadata } from "@/libs/seo";

export const metadata: Metadata = noindexMetadata("Edit Sage Mode");

/** Keep sage-mode editing out of search results while preserving its page layout. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
