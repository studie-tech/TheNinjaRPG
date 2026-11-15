import { useEffect, useState } from "react";
import type * as HtmlSanitizer from "@/utils/sanitize";

let sanitizerLoad: Promise<typeof HtmlSanitizer> | undefined;
let loadedSanitizer: typeof HtmlSanitizer | undefined;

/**
 * The sanitize-html allowlist is the same module the server applies to stored content. Its
 * parser dependencies are large, so browser code loads it on demand rather than with the page.
 * A failed load is retried by the next call.
 */
export const loadHtmlSanitizer = () => {
  sanitizerLoad ??= import("@/utils/sanitize").then(
    (module) => {
      loadedSanitizer = module;
      return module;
    },
    (error: unknown) => {
      sanitizerLoad = undefined;
      throw error;
    },
  );
  return sanitizerLoad;
};

/** Mention and reaction builders for optimistic chat updates; they share the sanitizer chunk. */
export const loadChatHelpers = () => import("@/utils/chat");

/**
 * The sanitizer module once it has loaded, or `undefined` while it is still loading.
 * Loading starts when `enabled` first becomes true; renders then use it synchronously.
 */
export const useHtmlSanitizer = (enabled: boolean) => {
  const [sanitizer, setSanitizer] = useState(() => loadedSanitizer);
  useEffect(() => {
    if (!enabled || sanitizer) return;
    let active = true;
    loadHtmlSanitizer().then(
      (module) => {
        if (active) setSanitizer(module);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [enabled, sanitizer]);
  return sanitizer;
};
