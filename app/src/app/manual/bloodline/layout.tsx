import type { Metadata } from "next";
import { buildMetadata } from "@/libs/seo";

export const metadata: Metadata = buildMetadata({
  title: "Bloodlines",
  description:
    "Every bloodline in TheNinja-RPG. Compare kekkei genkai effects, ranks and requirements to find the bloodline that fits your ninja build.",
  path: "/manual/bloodline",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
