import type { Metadata } from "next";
import { buildMetadata } from "@/libs/seo";

export const metadata: Metadata = buildMetadata({
  title: "Staff",
  description:
    "Meet the team behind TheNinja-RPG: the owners, coders, moderators and content creators keeping Seichi running.",
  path: "/manual/staff",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
