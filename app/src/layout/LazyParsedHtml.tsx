"use client";

import dynamic from "next/dynamic";
import { Suspense } from "react";
import { ChunkErrorBoundary } from "@/layout/ChunkErrorBoundary";

const ParsedHtml = dynamic(() =>
  import("@/utils/parse").then((module) => module.ParsedHtml),
);

/**
 * Stored HTML for toasts and dialogs the shell can show on any page. The parser loads with
 * the first one, so it stays out of the JavaScript every page starts with. Until it has
 * loaded the HTML renders nothing, and if it cannot load, its text without markup.
 */
export const LazyParsedHtml = ({ html }: { html: string }) => (
  <ChunkErrorBoundary fallback={() => html.replace(/<[^>]*>/g, "")}>
    <Suspense fallback={null}>
      <ParsedHtml html={html} />
    </Suspense>
  </ChunkErrorBoundary>
);
