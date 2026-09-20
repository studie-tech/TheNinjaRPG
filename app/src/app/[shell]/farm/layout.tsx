import type { Metadata } from "next";
import { noindexMetadata } from "@/libs/seo";

export const metadata: Metadata = noindexMetadata("Farm");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
