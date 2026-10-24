import type { Metadata } from "next";
import { noindexMetadata } from "@/libs/seo";

export const metadata: Metadata = noindexMetadata("Territory Wars");

/** Keep authenticated competition standings out of search indexing. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
