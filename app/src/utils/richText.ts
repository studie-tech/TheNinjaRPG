import { format } from "date-fns";
import { decodeHTML, encodeXML } from "entities";
import sanitize, { stripBlockquotes } from "@/utils/sanitize";

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

/**
 * The quote attached to a chat message for one quoted message, without that message's own
 * quotes. `data-comment-id` lets a reader jump to the quoted message. Attribute values are
 * escaped, since AI names may hold quotes or markup.
 */
export const buildQuoteHtml = (quoted: {
  id: string;
  username?: string | null;
  createdAt: Date;
  content: string;
}) =>
  `<blockquote author="${encodeXML(quoted.username || "Unknown")}" date="${format(quoted.createdAt, "MM/dd/yyyy")}" data-comment-id="${encodeXML(quoted.id)}">${stripBlockquotes(quoted.content)}</blockquote>`;
