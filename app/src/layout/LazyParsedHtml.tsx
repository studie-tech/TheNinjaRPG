"use client";

import dynamic from "next/dynamic";

/**
 * Stored HTML for toasts and dialogs the shell can show on any page. The parser loads with
 * the first one, so it stays out of the JavaScript every page starts with.
 */
export const LazyParsedHtml = dynamic(() =>
  import("@/utils/parse").then((module) => module.ParsedHtml),
);
