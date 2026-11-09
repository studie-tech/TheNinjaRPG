import { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "bun:test";
import { parseHtml } from "@/utils/parse";

const render = (html: string) => renderToStaticMarkup(parseHtml(html) as React.ReactNode);

describe("parseHtml image dimensions", () => {
  it("reserves space for legacy images stored without dimensions", () => {
    const markup = render('<p><img src="https://uploadthing.b-cdn.net/f/legacy.webp" /></p>');
    expect(markup).toContain('width="512"');
    expect(markup).toContain('height="384"');
  });

  it("keeps dimensions authored on the image", () => {
    const markup = render(
      '<p><img src="https://uploadthing.b-cdn.net/f/sized.webp" width="240" height="180" /></p>',
    );
    expect(markup).toContain('width="240"');
    expect(markup).toContain('height="180"');
    expect(markup).not.toContain('width="512"');
  });

  it("does not invent a height when only a width was authored", () => {
    const markup = render(
      '<p><img src="https://uploadthing.b-cdn.net/f/wide.webp" width="200" /></p>',
    );
    expect(markup).toContain('width="200"');
    expect(markup).not.toContain('height="384"');
  });
});

describe("parseHtml media attributes", () => {
  it("never passes a class to post images", () => {
    const markup = render(
      '<p><img src="https://uploadthing.b-cdn.net/f/a.webp" class="one" className="two" id="pic" /></p>',
    );
    expect(markup).not.toContain("one");
    expect(markup).not.toContain("two");
    expect(markup).toContain('id="pic"');
  });

  it("leaves unset image attributes out of the markup", () => {
    const image = render('<p><img src="https://uploadthing.b-cdn.net/f/a.webp" /></p>');
    expect(image).not.toContain(" id=");
    expect(image).toContain('alt="Post image"');
    expect(render('<p><img alt="x" /></p>')).not.toContain("src=");
  });

  it("hands an iframe its class attribute", () => {
    const iframe = findElement(
      parseHtml(
        '<iframe src="https://www.youtube.com/embed/a" class="one" className="two"></iframe>',
      ),
      (element) => (element.props as { "data-user-iframe"?: string })["data-user-iframe"] === "true",
    );
    expect(iframe?.props).toEqual(
      expect.objectContaining({
        className: "one",
        sandbox: "allow-scripts allow-same-origin",
        allowFullScreen: false,
      }),
    );
  });
});

const findElement = (
  node: unknown,
  matches: (element: React.ReactElement) => boolean,
): React.ReactElement | undefined => {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, matches);
      if (found) return found;
    }
    return undefined;
  }
  if (!isValidElement(node)) return undefined;
  if (matches(node)) return node;
  return findElement((node.props as { children?: unknown }).children, matches);
};
