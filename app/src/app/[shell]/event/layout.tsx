import type { Metadata } from "next";
import { noindexMetadata } from "@/libs/seo";

export const metadata: Metadata = noindexMetadata("Events");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
