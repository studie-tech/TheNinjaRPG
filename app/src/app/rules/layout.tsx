import type { Metadata } from "next";
import { buildMetadata } from "@/libs/seo";

export const metadata: Metadata = buildMetadata({
  title: "Rules",
  description:
    "The rules of TheNinja-RPG. Conduct, fair play and account policies for the ninja world of Seichi.",
  path: "/rules",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
