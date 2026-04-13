import sanitizeHtml from "sanitize-html";

const sanitize = (html: string) => {
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      "img",
      "blockquote",
      "iframe",
    ]),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      img: ["src"],
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
  });
};

export default sanitize;

/**
 * Removes quote wrappers and everything inside them from already-sanitized HTML.
 * Do not call this on raw user input; it intentionally allows all tags so it can
 * operate as a narrow post-processing step before re-wrapping quotes.
 */
export const stripBlockquotes = (html: string) => {
  return sanitizeHtml(html, {
    allowedTags: false,
    allowedAttributes: false,
    allowVulnerableTags: true,
    exclusiveFilter: (frame) => frame.tag === "blockquote",
  });
};

export const capitalizeFirstLetter = (string: string) => {
  return string.charAt(0).toUpperCase() + string.slice(1).toLowerCase();
};
