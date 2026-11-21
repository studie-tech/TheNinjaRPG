import type { Metadata } from "next";
import { CS_OG_IMAGE_URL } from "@/drizzle/constants";
import { buildMetadata } from "@/libs/seo";

export const metadata: Metadata = buildMetadata({
  title: "Chakra Storm Undercover Leaderboard",
  description:
    "The longest Undercover runs in Chakra Storm this month, verified by the server and ranked by how long each scout's cover held.",
  path: "/chakraStorm/leaderboard",
  image: CS_OG_IMAGE_URL,
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
