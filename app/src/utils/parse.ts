import { parseDocument } from "htmlparser2";
import React from "react";
import { Quote } from "@/components/ui/quote";
import { IMG_AVATAR_DEFAULT } from "@/drizzle/constants";
import { ConsentGatedIframe } from "@/layout/ConsentGatedIframe";
import EmbeddedConceptArt from "@/layout/EmbeddedConceptArt";
import { isAllowedIframeUrl, toPrivacyEnhancedEmbedUrl } from "@/utils/audio";
import { isPlainObject } from "@/utils/typeutils";

interface HtmlNode {
  type: string;
  name: string;
  attribs?: Record<string, string>;
  children?: HtmlNode[];
  data?: string;
  parent?: HtmlNode | null;
}

/**
 * Replaces a node while it is converted: null drops it, an element replaces it, and
 * undefined converts the (possibly modified) node as usual.
 */
type Transform = (node: HtmlNode, index: number) => React.ReactNode | undefined;

const isValidStyle = (value: unknown): value is React.CSSProperties => {
  return isPlainObject(value);
};

// Whitelist of iframe allow tokens we consider safe
const ALLOWED_IFRAME_ALLOW_TOKENS = new Set<string>([
  "autoplay",
  "encrypted-media",
  "picture-in-picture",
  "clipboard-write",
  // fullscreen is typically controlled by allowFullScreen, but include to be lenient
  "fullscreen",
]);

const DEFAULT_IFRAME_ALLOW = "autoplay; encrypted-media; picture-in-picture";

/**
 * Sanitize the iframe allow attribute by keeping only whitelisted tokens.
 * Falls back to DEFAULT_IFRAME_ALLOW if nothing safe remains.
 */
const sanitizeIframeAllow = (allowAttribute?: string): string => {
  if (!allowAttribute) return DEFAULT_IFRAME_ALLOW;
  const allowedTokens = allowAttribute
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((part) => {
      // token may be followed by origins; only keep the feature token
      const token = part.split(/\s+/)[0]?.toLowerCase();
      return token && ALLOWED_IFRAME_ALLOW_TOKENS.has(token) ? token : undefined;
    })
    .filter((t): t is string => Boolean(t));
  const uniqueTokens = Array.from(new Set(allowedTokens));
  return uniqueTokens.length ? uniqueTokens.join("; ") : DEFAULT_IFRAME_ALLOW;
};

/**
 * Pre-process HTML to convert special tags to custom elements
 * Converts [conceptart:id] to <conceptart data-id="id"></conceptart>
 */
const preprocessHtml = (html: string): string => {
  // Convert [conceptart:id] tags to custom HTML elements
  return html.replace(
    /\[conceptart:([a-zA-Z0-9_-]+)\]/g,
    '<conceptart data-id="$1"></conceptart>',
  );
};

/**
 * Parse and sanitize style attribute from JSON string
 */
const parseStyleAttribute = (styleJson?: string): React.CSSProperties | undefined => {
  if (!styleJson) return undefined;
  try {
    const parsedStyle = JSON.parse(styleJson) as unknown;
    return isValidStyle(parsedStyle) ? parsedStyle : undefined;
  } catch {
    // Malformed JSON
    return undefined;
  }
};

/**
 * Post images without authored dimensions reserve a 4:3 placeholder until their
 * intrinsic aspect ratio loads. Original-size uploads use their recorded dimensions.
 */
const LEGACY_IMAGE_RESERVE = { width: 512, height: 384 };

/**
 * Transform image nodes with error handling and fallback.
 * Returns undefined if the node cannot be transformed (e.g., missing attributes).
 */
const tryTransformImageNode = (imageNode: HtmlNode): React.ReactElement | undefined => {
  if (!imageNode.attribs) return undefined;

  const {
    src: sourceUrl,
    alt: alternativeText,
    id: imageIdentifier,
    style,
    width,
    height,
  } = imageNode.attribs;
  const parsedStyle = parseStyleAttribute(style);

  // Posts written before uploads recorded their dimensions have no width/height, so the
  // image reserves zero height and shoves the rest of the thread down once it loads.
  // Tailwind's preflight sets `img { height: auto }`, which turns these attributes into
  // an `aspect-ratio: auto w / h` hint: the estimate reserves space before load and the
  // image's real aspect ratio takes over afterwards, so nothing is ever distorted.
  const hasAuthoredSize = width !== undefined || height !== undefined;
  const reservedWidth = hasAuthoredSize ? width : String(LEGACY_IMAGE_RESERVE.width);
  const reservedHeight = hasAuthoredSize ? height : String(LEGACY_IMAGE_RESERVE.height);

  const imageAttributes: React.ImgHTMLAttributes<HTMLImageElement> = {
    src: sourceUrl,
    alt: alternativeText || "Post image",
    id: imageIdentifier,
    style: parsedStyle,
    width: reservedWidth,
    height: reservedHeight,
    onError: (event: React.SyntheticEvent<HTMLImageElement>) => {
      const target = event.currentTarget;
      target.onerror = null;
      target.src = IMG_AVATAR_DEFAULT;
    },
  };

  const image = React.createElement("img", { ...imageAttributes, key: sourceUrl });
  let parent = imageNode.parent;
  while (parent) {
    if (parent.name === "a") return image;
    parent = parent.parent;
  }
  // Only navigable web URLs become links; authored links retain their own destination.
  if (!sourceUrl || !/^(https?:\/\/|\/(?!\/))/i.test(sourceUrl)) return image;
  return React.createElement(
    "a",
    {
      href: sourceUrl,
      target: "_blank",
      rel: "noopener noreferrer",
      title: "Open original image",
      className: "inline-block max-w-full cursor-zoom-in",
      key: sourceUrl,
    },
    image,
  );
};

/**
 * Render quote children with the same media transforms and filtering as the post.
 */
const transformBlockquoteNode = (
  blockquoteNode: HtmlNode,
  index: number,
  transform: Transform,
): React.ReactElement => {
  const author = blockquoteNode.attribs?.author || undefined;
  const date = blockquoteNode.attribs?.date || undefined;
  const commentId = blockquoteNode.attribs?.["data-comment-id"] || undefined;

  return React.createElement(
    Quote,
    {
      author,
      date,
      commentId,
      key: index,
    },
    processNodes(blockquoteNode.children ?? [], transform),
  );
};

/**
 * Transform concept art nodes to embedded component
 */
const transformConceptArtNode = (
  conceptArtNode: HtmlNode,
): React.ReactElement | null => {
  if (!conceptArtNode.attribs) return null;
  const imageId = conceptArtNode.attribs["data-id"];
  if (!imageId) return null;

  return React.createElement(EmbeddedConceptArt, {
    imageId,
    key: `conceptart-${imageId}`,
  });
};

/**
 * Transform iframe nodes with security restrictions
 */
const transformIframeNode = (iframeNode: HtmlNode): React.ReactElement | undefined => {
  if (!iframeNode.attribs) return undefined;

  const {
    src: sourceUrl,
    width,
    height,
    title,
    class: classAttribute,
    id: elementIdentifier,
    style,
    allow: allowAttribute,
    allowfullscreen,
    frameborder: frameBorder,
  } = iframeNode.attribs;

  if (!sourceUrl || !isAllowedIframeUrl(sourceUrl)) {
    return React.createElement("div", {
      key: sourceUrl ? `blocked-${sourceUrl}` : undefined,
    });
  }

  const parsedStyle = parseStyleAttribute(style);
  const sanitizedAllowAttribute = sanitizeIframeAllow(allowAttribute);
  const allowFullScreen =
    typeof allowfullscreen !== "undefined" &&
    allowfullscreen.toLowerCase() !== "false" &&
    allowfullscreen !== "0";

  const props: React.IframeHTMLAttributes<HTMLIFrameElement> & {
    src: string;
    "data-user-iframe"?: string;
  } = {
    src: toPrivacyEnhancedEmbedUrl(sourceUrl),
    width,
    height,
    title,
    className: classAttribute,
    id: elementIdentifier,
    style: parsedStyle,
    allow: sanitizedAllowAttribute,
    allowFullScreen,
    frameBorder,
    sandbox: "allow-scripts allow-same-origin",
    // YouTube rejects embeds without a referrer (player error 153); the origin alone
    // satisfies it without exposing the page path
    referrerPolicy: "strict-origin-when-cross-origin",
    "data-user-iframe": "true",
  };

  return React.createElement(ConsentGatedIframe, { ...props, key: sourceUrl });
};

/**
 * Check if node should be filtered out during transformation
 */
const shouldFilterNode = (htmlNode: HtmlNode): boolean => {
  return (
    htmlNode.type === "directive" ||
    htmlNode.type === "style" ||
    htmlNode.type === "script" ||
    (htmlNode.type === "tag" &&
      (htmlNode.name === "body" ||
        htmlNode.name === "html" ||
        htmlNode.name === "meta" ||
        htmlNode.name === "title" ||
        htmlNode.name === "head"))
  );
};

/**
 * Parse HTML string into React components
 */
export const parseHtml = (html: string) => {
  const preprocessedHtml = preprocessHtml(html);

  const transform: Transform = (node: HtmlNode, index) => {
    if (shouldFilterNode(node)) {
      return null;
    }

    if (node.type === "tag") {
      switch (node.name) {
        case "img":
          return tryTransformImageNode(node);
        case "h1":
        case "h2":
          node.name = "h2";
          node.attribs = { ...node.attribs, class: "my-3 text-xl font-bold" };
          return undefined;
        case "h3":
          node.attribs = { ...node.attribs, class: "my-2 text-lg font-semibold" };
          return undefined;
        case "ul":
          node.attribs = { ...node.attribs, class: "my-2 list-disc pl-6" };
          return undefined;
        case "ol":
          node.attribs = { ...node.attribs, class: "my-2 list-decimal pl-6" };
          return undefined;
        case "blockquote":
          // Authored rich-text quotes keep their formatting; attributed reply quotes
          // use the shared Quote presentation and its author/date metadata.
          if (node.attribs?.author || node.attribs?.date)
            return transformBlockquoteNode(node, index, transform);
          node.attribs = {
            ...node.attribs,
            class: "my-3 border-l-4 border-primary bg-accent p-3 italic",
          };
          return undefined;
        case "conceptart":
          return transformConceptArtNode(node);
        case "iframe":
          return transformIframeNode(node);
        default:
          return undefined;
      }
    }

    return undefined;
  };

  const dom = parseDocument(preprocessedHtml);
  return processNodes(dom.children as unknown as HtmlNode[], transform);
};

/** parseHtml as a component, for consumers that load the parser on demand. */
export const ParsedHtml = ({ html }: { html: string }) => parseHtml(html);

/** Element names that never take children. */
const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "command",
  "embed",
  "hr",
  "img",
  "input",
  "keygen",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/** Attributes whose presence alone switches them on; React receives a truthy value. */
const BOOLEAN_ATTRIBUTES = new Set([
  "allowfullscreen",
  "async",
  "autoplay",
  "capture",
  "checked",
  "controls",
  "default",
  "defer",
  "disabled",
  "formnovalidate",
  "hidden",
  "loop",
  "multiple",
  "muted",
  "novalidate",
  "open",
  "playsinline",
  "readonly",
  "required",
  "reversed",
  "scoped",
  "seamless",
  "selected",
  "itemscope",
]);

/** Lowercase HTML attribute names whose React prop is spelled differently. */
const REACT_ATTRIBUTE_NAMES: Record<string, string> = {
  "accept-charset": "acceptCharset",
  accesskey: "accessKey",
  allowfullscreen: "allowFullScreen",
  allowtransparency: "allowTransparency",
  autocapitalize: "autoCapitalize",
  autocomplete: "autoComplete",
  autocorrect: "autoCorrect",
  autoplay: "autoPlay",
  autosave: "autoSave",
  cellpadding: "cellPadding",
  cellspacing: "cellSpacing",
  charset: "charSet",
  class: "className",
  classid: "classID",
  colspan: "colSpan",
  contenteditable: "contentEditable",
  contextmenu: "contextMenu",
  crossorigin: "crossOrigin",
  datetime: "dateTime",
  enctype: "encType",
  for: "htmlFor",
  formaction: "formAction",
  formenctype: "formEncType",
  formmethod: "formMethod",
  formnovalidate: "formNoValidate",
  formtarget: "formTarget",
  frameborder: "frameBorder",
  hreflang: "hrefLang",
  "http-equiv": "httpEquiv",
  inputmode: "inputMode",
  itemid: "itemID",
  itemprop: "itemProp",
  itemref: "itemRef",
  itemscope: "itemScope",
  itemtype: "itemType",
  keyparams: "keyParams",
  keytype: "keyType",
  marginheight: "marginHeight",
  marginwidth: "marginWidth",
  maxlength: "maxLength",
  mediagroup: "mediaGroup",
  minlength: "minLength",
  novalidate: "noValidate",
  playsinline: "playsInline",
  radiogroup: "radioGroup",
  readonly: "readOnly",
  referrerpolicy: "referrerPolicy",
  rowspan: "rowSpan",
  spellcheck: "spellCheck",
  srcdoc: "srcDoc",
  srclang: "srcLang",
  srcset: "srcSet",
  tabindex: "tabIndex",
  usemap: "useMap",
};

/** Tag and attribute names React can render; anything else is dropped. */
const VALID_NAME_REGEX = /^[a-zA-Z][a-zA-Z:_.\-\d]*$/;

/**
 * Convert parsed nodes to React nodes, skipping whitespace-only lines between elements,
 * and give the transform the first say over each node.
 */
const processNodes = (nodes: HtmlNode[], transform: Transform): React.ReactNode[] =>
  nodes
    .filter((node) => !isEmptyTextLine(node))
    .map((node, index) => {
      const transformed = transform(node, index);
      if (transformed === null || transformed) return transformed;
      return convertNode(node, index, transform);
    });

/** Text renders as itself and tags as elements; comments and the like render nothing. */
const convertNode = (
  node: HtmlNode,
  index: number,
  transform: Transform,
): React.ReactNode => {
  if (node.type === "text") return node.data;
  if (node.type !== "tag" || !VALID_NAME_REGEX.test(node.name)) return null;
  const children = VOID_ELEMENTS.has(node.name)
    ? null
    : processNodes(node.children ?? [], transform);
  return React.createElement(
    node.name,
    attributesToProps(node.attribs ?? {}, index),
    children,
  );
};

/** A text node that only carries the line breaks and indentation between elements. */
const isEmptyTextLine = (node: HtmlNode) =>
  node.type === "text" && /\r?\n/.test(node.data ?? "") && node.data?.trim() === "";

/** React props for HTML attributes, with an inline style string turned into an object. */
const attributesToProps = (attributes: Record<string, string>, key: number) => {
  const props: Record<string, unknown> = {};
  for (const [attribute, value] of Object.entries(attributes)) {
    if (!VALID_NAME_REGEX.test(attribute)) continue;
    const lowerCaseAttribute = attribute.toLowerCase();
    const name = REACT_ATTRIBUTE_NAMES[lowerCaseAttribute] ?? lowerCaseAttribute;
    props[name] = BOOLEAN_ATTRIBUTES.has(lowerCaseAttribute) ? name : value;
  }
  props.key = key;
  if (typeof props.style === "string") props.style = inlineStyleToObject(props.style);
  else delete props.style;
  return props;
};

/** `color: Red; font-size: 2px` as `{ color: "red", fontSize: "2px" }`. */
const inlineStyleToObject = (inlineStyle: string) => {
  const style: Record<string, string> = {};
  for (const declaration of inlineStyle.split(";")) {
    const [, property, value] = declaration
      .split(/^([^:]+):/)
      .map((part) => part.trim().toLowerCase());
    if (property === undefined || value === undefined) continue;
    const reactProperty = property
      .replace(/^-ms-/, "ms-")
      .replace(/-(.)/g, (_, character: string) => character.toUpperCase());
    style[reactProperty] = value;
  }
  return style;
};
