import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseHtml } from "@/utils/parse";

/**
 * Images inside user-authored posts used to render with no width or height, so they
 * occupied zero pixels until their bytes arrived and then pushed the rest of the thread
 * down. Forum threads were the worst Cumulative Layout Shift group on the site.
 */
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
