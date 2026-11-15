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
  <ChunkErrorBoundary fallback={() => htmlToText(html)}>
    <Suspense fallback={null}>
      <ParsedHtml html={html} />
    </Suspense>
  </ChunkErrorBoundary>
);

/**
 * The text of an HTML string, read with the browser's own parser, which runs no scripts
 * in a parsed document. React renders it as an escaped text node.
 */
export const htmlToText = (html: string) => {
  if (typeof DOMParser === "undefined") return null;
  const body = new DOMParser().parseFromString(html, "text/html").body;
  for (const node of body.querySelectorAll("script, style")) node.remove();
  return body.textContent;
};
