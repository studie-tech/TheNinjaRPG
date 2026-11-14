import { decodeHTML } from "entities";
import sanitize from "@/utils/sanitize";

/** Quill imports basic HTML; keep advanced documents in source mode until explicitly converted. */
export const needsHtmlSource = (value: string) =>
  /<(?!\/?(?:p|br|strong|b|em|i|u|s|strike|h[1-6]|ol|ul|li|blockquote|a|img)\b)[a-z]|<(?:blockquote|li)\s|<h[23]\b[^>]*\sid\s*=|<a\b[^>]*\sname\s*=|\sstyle\s*=|\[conceptart:/i.test(
    value,
  );

/** Plain text must not be interpreted as markup when opening an existing draft. */
export const richTextInput = (value: string): { html: string } | { text: string } =>
  /<\/?[a-z][^>]*>/i.test(value) ? { html: sanitize(value) } : { text: value };

/** One quote the server attaches to a chat message; its own nested quotes are already removed. */
const ATTACHED_QUOTE =
  /^\s*<blockquote\b[^>]*\bauthor="([^"]*)"[^>]*>[\s\S]*?<\/blockquote>/i;

/**
 * Split the quotes attached when a message was sent from the text its author wrote, so an edit
 * changes only that text in the visual editor and keeps the quotes as they were.
 */
export const splitQuotedReply = (html: string) => {
  const authors: string[] = [];
  let rest = html;
  let match = ATTACHED_QUOTE.exec(rest);
  while (match) {
    authors.push(decodeHTML(match[1] ?? ""));
    rest = rest.slice(match[0].length);
    match = ATTACHED_QUOTE.exec(rest);
  }
  const reply = rest.trimStart();
  return { quotes: html.slice(0, html.length - rest.length).trim(), reply, authors };
};

/** When Enter sends: on every device, only with a physical keyboard, or never. */
export type SubmitOnEnter = "always" | "desktop" | "never";

/**
 * Whether a plain Enter sends the message. Soft keyboards have no Shift+Enter, so on
 * a touch device the "desktop" policy leaves Enter for new lines and the Send button sends.
 */
export const enterSubmits = (mode: SubmitOnEnter, isCoarsePointer: boolean) =>
  mode === "always" || (mode === "desktop" && !isCoarsePointer);

const EMPTY_PASTED_BLOCK =
  /<(p|div|span|a|figure|picture|li|ul|ol|blockquote|h[1-6])\b[^>]*>(?:\s|&nbsp;|<br\s*\/?>)*<\/\1>/gi;

/**
 * Copied chat brings other posts' avatars, badges and rules along. Pasting into a chat
 * composer keeps the text and drops images, rules and the blocks they leave empty.
 */
export const stripPastedChatHtml = (html: string) => {
  let result = html.replace(/<img\b[^>]*>/gi, "").replace(/<hr\b[^>]*>/gi, "");
  let previous: string;
  do {
    previous = result;
    result = result.replace(EMPTY_PASTED_BLOCK, "");
  } while (result !== previous);
  return result;
};
