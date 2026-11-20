import { afterEach, describe, expect, it, vi } from "bun:test";
import { serveBundledMedia, textureImageUrl, transformImageUrl } from "@/utils/image";

afterEach(() => serveBundledMedia(null));

describe("bundled media", () => {
  it("leaves CDN URLs alone until a build serves its own files", () => {
    expect(transformImageUrl("https://ui0arpl8sm.ufs.sh/f/abc")).toBe(
      "https://uploadthing.b-cdn.net/f/abc",
    );
  });

  it("serves bundled files for CDN URLs, renditions and legacy hosts alike", () => {
    const missing = vi.fn();
    serveBundledMedia(
      new Map([
        ["https://uploadthing.b-cdn.net/f/abc", "https://game.test/assets/abc.webp"],
      ]),
      missing,
    );
    expect(transformImageUrl("https://ui0arpl8sm.ufs.sh/f/abc")).toBe(
      "https://game.test/assets/abc.webp",
    );
    // A rendition request resolves to the bundled original, without query parameters.
    expect(textureImageUrl("https://uploadthing.b-cdn.net/f/abc", 64)).toBe(
      "https://game.test/assets/abc.webp",
    );
    expect(
      transformImageUrl("https://uploadthing.b-cdn.net/f/abc?width=64#preview"),
    ).toBe("https://game.test/assets/abc.webp");
    expect(missing).not.toHaveBeenCalled();
    expect(transformImageUrl("https://uploadthing.b-cdn.net/f/other")).toBe(
      "https://uploadthing.b-cdn.net/f/other",
    );
    expect(missing).toHaveBeenCalledWith("https://uploadthing.b-cdn.net/f/other");
  });
});
