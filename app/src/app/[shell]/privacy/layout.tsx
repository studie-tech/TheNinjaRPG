import type { Metadata } from "next";
import { buildMetadata } from "@/libs/seo";

export const metadata: Metadata = buildMetadata({
  title: "Privacy",
  description:
    "Plain-language privacy details for TheNinja-RPG features, such as what Discord account linking shares and stores.",
  path: "/privacy",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
