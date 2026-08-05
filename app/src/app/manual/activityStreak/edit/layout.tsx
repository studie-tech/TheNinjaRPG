import type { Metadata } from "next";
import { noindexMetadata } from "@/libs/seo";

export const metadata: Metadata = noindexMetadata("Edit Activity Streak");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
