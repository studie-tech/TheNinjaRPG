import type { Metadata } from "next";
import { buildMetadata } from "@/libs/seo";

export const metadata: Metadata = buildMetadata({
  title: "Sage Mode",
  description:
    "Every sage mode in TheNinja-RPG: how natural energy transformations work, their combat buffs, exhaustion effects and how each level is unlocked.",
  path: "/manual/sageMode",
});

/** Supply public sage-mode guide metadata without adding another UI wrapper. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
