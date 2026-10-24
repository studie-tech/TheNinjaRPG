import sanitize from "@/utils/sanitize";

/** Quill imports basic HTML; keep advanced documents in source mode until explicitly converted. */
export const needsHtmlSource = (value: string) =>
  /<(?!\/?(?:p|br|strong|b|em|i|u|s|strike|h[1-6]|ol|ul|li|blockquote|a|img)\b)[a-z]|<(?:blockquote|li)\s|<h[23]\b[^>]*\sid\s*=|\sstyle\s*=|\[conceptart:/i.test(
    value,
  );

/** Plain text must not be interpreted as markup when opening an existing draft. */
export const richTextInput = (value: string): { html: string } | { text: string } =>
  /<\/?[a-z][^>]*>/i.test(value) ? { html: sanitize(value) } : { text: value };
