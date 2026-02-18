import * as Sentry from "@sentry/nextjs";
import { nanoid } from "nanoid";
import React from "react";
import type { Transform } from "react-html-parser";
import ReactHtmlParser from "react-html-parser";
import { Quote } from "@/components/ui/quote";
import { IMG_AVATAR_DEFAULT } from "@/drizzle/constants";
import EmbeddedConceptArt from "@/layout/EmbeddedConceptArt";
import { randomString } from "@/libs/random";
import { isAllowedIframeUrl } from "@/utils/audio";
import { isPlainObject } from "@/utils/typeutils";

// Default length for randomly generated alt text when images lack alt attributes
const DEFAULT_ALT_TEXT_LENGTH = 10;

interface HtmlNode {
  type: string;
  name: string;
  attribs?: Record<string, string>;
  children?: HtmlNode[];
  data?: string;
}

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
  } catch (error) {
    // Expected: SyntaxError for malformed JSON
    if (error instanceof SyntaxError) {
      return undefined;
    }
    // Capture unexpected errors in Sentry for monitoring
    Sentry.captureException(error, {
      tags: { source: "parse-style-attribute" },
      extra: { style: styleJson },
    });
    throw error;
  }
};

/**
 * Transform image nodes with error handling and fallback.
 * Returns undefined if the node cannot be transformed (e.g., missing attributes).
 */
const tryTransformImageNode = (imageNode: HtmlNode): React.ReactElement | undefined => {
  if (!imageNode.attribs) return undefined;

  const {
    src: sourceUrl,
    alt: alternativeText,
    className,
    id: imageIdentifier,
    style,
    width,
    height,
  } = imageNode.attribs;
  const parsedStyle = parseStyleAttribute(style);

  const imageAttributes: React.ImgHTMLAttributes<HTMLImageElement> = {
    src: sourceUrl,
    alt: alternativeText || randomString(DEFAULT_ALT_TEXT_LENGTH),
    className,
    id: imageIdentifier,
    style: parsedStyle,
    width,
    height,
    onError: (event: React.SyntheticEvent<HTMLImageElement>) => {
      const target = event.currentTarget;
      target.onerror = null;
      target.src = IMG_AVATAR_DEFAULT;
    },
  };

  const filteredAttributes = Object.fromEntries(
    Object.entries(imageAttributes).filter(([, value]) => value !== undefined),
  ) as React.ImgHTMLAttributes<HTMLImageElement>;

  return React.createElement("img", { ...filteredAttributes, key: nanoid() });
};

/**
 * Transform blockquote nodes to Quote component
 */
const transformBlockquoteNode = (blockquoteNode: HtmlNode): React.ReactElement => {
  const content = blockquoteNode.children?.reduce((acc, child) => {
    if (child.type === "text") {
      return acc + child.data;
    }
    return acc;
  }, "");

  return React.createElement(
    Quote,
    {
      author: blockquoteNode.attribs?.author || undefined,
      date: blockquoteNode.attribs?.date || undefined,
      key: nanoid(),
    },
    content,
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
    key: `conceptart-${imageId}-${nanoid()}`,
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
    className,
    class: classAttribute,
    id: elementIdentifier,
    style,
    allow: allowAttribute,
    allowfullscreen,
    frameborder: frameBorder,
  } = iframeNode.attribs as Record<string, string> & { class?: string };

  if (!sourceUrl || !isAllowedIframeUrl(sourceUrl)) {
    return React.createElement("div", { key: nanoid() });
  }

  const parsedStyle = parseStyleAttribute(style);
  const finalClassName = className ?? classAttribute;
  const sanitizedAllowAttribute = sanitizeIframeAllow(allowAttribute);
  const allowFullScreen =
    typeof allowfullscreen !== "undefined" &&
    allowfullscreen.toLowerCase() !== "false" &&
    allowfullscreen !== "0";

  const props: React.IframeHTMLAttributes<HTMLIFrameElement> & {
    "data-user-iframe"?: string;
  } = {
    src: sourceUrl,
    width,
    height,
    title,
    className: finalClassName,
    id: elementIdentifier,
    style: parsedStyle,
    allow: sanitizedAllowAttribute,
    allowFullScreen,
    frameBorder,
    sandbox: "allow-scripts allow-same-origin",
    referrerPolicy: "no-referrer",
    "data-user-iframe": "true",
  };

  const filteredProperties = Object.fromEntries(
    Object.entries(props).filter(([, value]) => value !== undefined),
  ) as React.IframeHTMLAttributes<HTMLIFrameElement> & { "data-user-iframe"?: string };

  return React.createElement("iframe", { ...filteredProperties, key: nanoid() });
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

  const transform: Transform = (node: HtmlNode) => {
    if (shouldFilterNode(node)) {
      return null;
    }

    if (node.type === "tag") {
      switch (node.name) {
        case "img":
          return tryTransformImageNode(node);
        case "h1":
          node.name = "h2";
          return undefined;
        case "blockquote":
          return transformBlockquoteNode(node);
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

  return ReactHtmlParser(preprocessedHtml, { transform });
};
