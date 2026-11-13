import type { Metadata } from "next";
import { noindexMetadata } from "@/libs/seo";

export const metadata: Metadata = noindexMetadata("AI Completeness");

/** Apply the staff overview's noindex metadata without adding a visual wrapper. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
