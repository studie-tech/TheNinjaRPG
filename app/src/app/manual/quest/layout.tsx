import type { Metadata } from "next";
import { buildMetadata } from "@/libs/seo";

export const metadata: Metadata = buildMetadata({
  title: "Quests",
  description:
    "Every quest type in TheNinja-RPG: missions, errands, crimes, tier quests and story arcs, with objectives and rewards explained.",
  path: "/manual/quest",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
