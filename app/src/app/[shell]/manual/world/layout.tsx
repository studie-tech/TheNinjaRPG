import type { Metadata } from "next";
import { buildMetadata } from "@/libs/seo";

export const metadata: Metadata = buildMetadata({
  title: "World Map Tools",
  description:
    "Staff tools for editing TheNinja-RPG sector maps and tilesets. Player travel docs are in the guide.",
  path: "/manual/world",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
