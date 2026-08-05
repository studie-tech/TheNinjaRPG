import type { Metadata } from "next";
import { buildMetadata } from "@/libs/seo";

export const metadata: Metadata = buildMetadata({
  title: "Sign In",
  description:
    "Sign in to TheNinja-RPG and continue your ninja journey in the world of Seichi.",
  path: "/login",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
