import type { Metadata } from "next";
import { buildMetadata } from "@/libs/seo";

export const metadata: Metadata = buildMetadata({
  title: "Activity Streak",
  description:
    "How activity streaks work in TheNinja-RPG, the daily rewards they unlock and how to keep your streak alive.",
  path: "/manual/activityStreak",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
