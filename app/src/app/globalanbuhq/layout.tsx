import type { Metadata } from "next";
import { noindexMetadata } from "@/libs/seo";

export const metadata: Metadata = noindexMetadata("Global ANBU HQ");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
