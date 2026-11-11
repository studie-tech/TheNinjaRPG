import { useEffect } from "react";

/**
 * Name the entry a content editor is working on in its heading and browser tab, so
 * several open editors stay distinguishable. Restores the page title on unmount.
 * @param kind - Content type in lowercase, e.g. "jutsu"
 * @param name - Current, possibly unsaved, entry name
 */
export const useEditorTitle = (kind: string, name: string | null | undefined) => {
  const title = editorTitle(kind, name);
  useEffect(() => {
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
  return title;
};

/** Heading for a content editor, falling back to the type while the name is empty. */
export const editorTitle = (kind: string, name: string | null | undefined) => {
  const trimmed = name?.trim();
  return trimmed ? `Edit ${kind}: ${trimmed}` : `Edit ${kind}`;
};
