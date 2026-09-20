import type { Metadata } from "next";
import { buildMetadata } from "@/libs/seo";

export const metadata: Metadata = buildMetadata({
  title: "Help & Support",
  description:
    "Get help with TheNinja-RPG. Contact support, join the Discord community or report a bug on GitHub.",
  path: "/help",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
