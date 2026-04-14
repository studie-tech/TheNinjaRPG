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

export const stripBlockquotes = (html: string) =>
  sanitizeHtml(html, {
    ...sanitizeOptions,
    exclusiveFilter: (frame) => frame.tag === "blockquote",
  });

export const capitalizeFirstLetter = (string: string) => {
  return string.charAt(0).toUpperCase() + string.slice(1).toLowerCase();
};
