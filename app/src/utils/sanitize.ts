import { decodeHTML } from "entities";
import sanitizeHtml from "sanitize-html";

const sanitizeOptions: sanitizeHtml.IOptions = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat([
    "img",
    "blockquote",
    "iframe",
  ]),
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    img: ["src"],
    p: ["style"],
    div: ["style"],
    span: ["style"],
    blockquote: ["author", "date"],
    iframe: [
      "src",
      "width",
      "height",
      "title",
      "allow",
      "allowfullscreen",
      "frameborder",
      "class",
      "id",
      "style",
    ],
  },
  allowedStyles: {
    "*": {
      color: [
        /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*[\d.]+[\s,]+[\d.]+[\s,]+[\d.]+[\s,\d.]*\)|hsla?\(\s*[\d.]+[\s,]+[\d.%]+[\s,]+[\d.%]+[\s,\d.]*\)|[a-zA-Z]+)$/,
      ],
      "text-align": [/^(left|right|center|justify)$/],
      "font-weight": [/^\d+$|^bold$|^normal$/],
      "font-style": [/^(italic|normal)$/],
      "text-decoration": [/^(underline|line-through|none)$/],
    },
  },
};

const sanitize = (html: string) => sanitizeHtml(html, sanitizeOptions);

export default sanitize;

const PLAIN_TEXT_SEPARATOR_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "br",
  "dd",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "script",
  "style",
  "table",
  "td",
  "th",
  "tr",
  "ul",
]);

const htmlToText = (html: string, breakText: string, collapse: RegExp) => {
  let needsBreak = false;
  const text = sanitizeHtml(html, {
    allowedTags: [],
    allowedAttributes: {},
    onOpenTag: (tagName) => {
      if (PLAIN_TEXT_SEPARATOR_TAGS.has(tagName)) needsBreak = true;
    },
    onCloseTag: (tagName) => {
      if (PLAIN_TEXT_SEPARATOR_TAGS.has(tagName)) needsBreak = true;
    },
    textFilter: (chunk) => {
      if (!needsBreak) return chunk;
      needsBreak = false;
      return `${breakText}${chunk}`;
    },
  });

  return decodeHTML(text).replace(collapse, " ").trim();
};

/** Converts stored HTML to normalized text without retaining script/style contents. */
export const htmlToPlainText = (html: string) => htmlToText(html, " ", /\s+/g);

/** Visible text for moderation: inline tags vanish, block/br stay as line breaks. */
export const htmlToModerationText = (html: string) =>
  htmlToText(html, "\n", /[ \t]+/g);

/**
 * Strict sanitizer for variant description/battleDescription fields.
 * Uses sanitize-html defaults (no img or iframe) to prevent tracking pixels
 * when the text is rendered via dangerouslySetInnerHTML in the combat log.
 */
export const sanitizeVariantText = (html: string) =>
  sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags,
    allowedAttributes: sanitizeHtml.defaults.allowedAttributes,
  });

export const stripBlockquotes = (html: string) =>
  sanitizeHtml(html, {
    ...sanitizeOptions,
    exclusiveFilter: (frame) => frame.tag === "blockquote",
  });

export const capitalizeFirstLetter = (string: string) => {
  return string.charAt(0).toUpperCase() + string.slice(1).toLowerCase();
};
