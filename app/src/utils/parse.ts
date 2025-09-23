import ReactHtmlParser from "react-html-parser";
import type { Transform } from "react-html-parser";
import { randomString } from "@/libs/random";
import { IMG_AVATAR_DEFAULT } from "@/drizzle/constants";
import React from "react";
import { Quote } from "@/components/ui/quote";
import { nanoid } from "nanoid";
import { isAllowedIframeUrl } from "@/utils/audio";

interface HtmlNode {
  type: string;
  name: string;
  attribs?: Record<string, string>;
  children?: HtmlNode[];
  data?: string;
}

const isValidStyle = (value: unknown): value is React.CSSProperties => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

/*
 * Parse HTML string into React components
 * @param html - HTML string to parse
 */
export const parseHtml = (html: string) => {
  const transform: Transform = (node: HtmlNode) => {
    if (
      node.type === "directive" ||
      node.type === "style" ||
      node.type === "script" ||
      (node.type === "tag" && node.name === "body") ||
      (node.type === "tag" && node.name === "html") ||
      (node.type === "tag" && node.name === "meta") ||
      (node.type === "tag" && node.name === "title") ||
      (node.type === "tag" && node.name === "head")
    ) {
      return null;
    } else if (node.type === "tag" && node.name === "img" && node.attribs) {
      const {
        src,
        alt: originalAlt,
        className,
        id,
        style,
        width,
        height,
      } = node.attribs;

      let parsedStyle: React.CSSProperties | undefined;
      if (style) {
        try {
          const parsed = JSON.parse(style) as unknown;
          if (isValidStyle(parsed)) {
            parsedStyle = parsed;
          }
        } catch {
          // Invalid JSON style string, ignore it
        }
      }

      const props: React.ImgHTMLAttributes<HTMLImageElement> = {
        src,
        alt: originalAlt || randomString(10),
        className,
        id,
        style: parsedStyle,
        width,
        height,
        onError: (e: React.SyntheticEvent<HTMLImageElement>) => {
          const target = e.currentTarget;
          target.onerror = null;
          target.src = IMG_AVATAR_DEFAULT;
        },
      };
      const cleanProps = Object.fromEntries(
        Object.entries(props).filter(([_, value]) => value !== undefined),
      ) as React.ImgHTMLAttributes<HTMLImageElement>;

      return React.createElement("img", cleanProps);
    } else if (node.type === "tag" && node.name === "h1") {
      node.name = "h2";
    } else if (node.type === "tag" && node.name === "blockquote") {
      // Process our quote markers      // Use our Quote component
      const content = node.children?.reduce((acc, child) => {
        if (child.type === "text") {
          return acc + child.data;
        }
        return acc;
      }, "");

      return React.createElement(
        Quote,
        {
          author: node.attribs?.author || undefined,
          date: node.attribs?.date || undefined,
          key: nanoid(),
        },
        content,
      );
    } else if (node.type === "tag" && node.name === "iframe" && node.attribs) {
      const {
        src,
        width,
        height,
        title,
        className,
        id,
        style,
        allow,
        allowfullscreen,
        frameborder,
      } = node.attribs;

      // Only allow iframes from approved providers; otherwise return empty element
      if (!src || !isAllowedIframeUrl(src)) {
        return React.createElement("div", {});
      }

      let parsedStyle: React.CSSProperties | undefined;
      if (style) {
        try {
          const parsed = JSON.parse(style) as unknown;
          if (isValidStyle(parsed)) {
            parsedStyle = parsed;
          }
        } catch {
          // Invalid JSON style string, ignore it
        }
      }

      // Identify user-embedded iframes (used for global mute capabilities)
      const isUserEmbed = !!src;

      const props: React.IframeHTMLAttributes<HTMLIFrameElement> = {
        src,
        width,
        height,
        title,
        className,
        id,
        style: parsedStyle,
        allow,
        allowFullScreen: allowfullscreen === "true" || allowfullscreen === "1",
        frameBorder: frameborder,
        // Mark as user iframe to enable mute management
        ...(isUserEmbed && { "data-user-iframe": "true" }),
      };

      const cleanProps = Object.fromEntries(
        Object.entries(props).filter(([_, value]) => value !== undefined),
      ) as React.IframeHTMLAttributes<HTMLIFrameElement>;

      return React.createElement("iframe", cleanProps);
    }
    return undefined;
  };

  return ReactHtmlParser(html, { transform });
};
