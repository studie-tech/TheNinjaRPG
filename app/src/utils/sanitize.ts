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
