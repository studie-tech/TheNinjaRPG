import type { Metadata } from "next";
import { buildMetadata } from "@/libs/seo";

export const metadata: Metadata = buildMetadata({
  title: "Create Your Account",
  description:
    "Create a free TheNinja-RPG account and begin your ninja journey in the world of Seichi. No download, plays straight in your browser.",
  path: "/signup",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
