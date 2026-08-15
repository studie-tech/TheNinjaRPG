import { describe, expect, it } from "vitest";
import {
  bunnyImageUrl,
  isBunnyCdnUrl,
  transformImageUrl,
} from "@/utils/image";

describe("image URL utilities", () => {
  it.each([
    ["https://utfs.io/f/example.png", "https://uploadthing.b-cdn.net/f/example.png"],
    [
      "https://ui0arpl8sm.ufs.sh/f/example.png",
      "https://uploadthing.b-cdn.net/f/example.png",
    ],
  ])("routes UploadThing URLs through Bunny", (source, expected) => {
    expect(transformImageUrl(source)).toBe(expected);
  });

  it("requests a rendition from supported Bunny pull zones", () => {
    expect(bunnyImageUrl("https://uploadthing.b-cdn.net/f/example.png", 200)).toBe(
      "https://uploadthing.b-cdn.net/f/example.png?width=200",
    );
    expect(bunnyImageUrl("https://tnr-storage-cdn.b-cdn.net/example.png", 400)).toBe(
      "https://tnr-storage-cdn.b-cdn.net/example.png?width=400",
    );
  });

  it("leaves unsupported URLs alone and composes existing Bunny parameters", () => {
    expect(bunnyImageUrl("/images/example.png", 200)).toBe("/images/example.png");
    expect(bunnyImageUrl("https://example.com/image.png", 200)).toBe(
      "https://example.com/image.png",
    );
    expect(
      bunnyImageUrl("https://uploadthing.b-cdn.net/f/example.png?quality=70", 200),
    ).toBe("https://uploadthing.b-cdn.net/f/example.png?quality=70&width=200");
  });

  it("forces Bunny image detection for extensionless UploadThing files", () => {
    expect(bunnyImageUrl("https://utfs.io/f/extensionless-key", 100)).toBe(
      "https://uploadthing.b-cdn.net/f/extensionless-key?width=100&optimizer=image",
    );
  });

  it("replaces an existing width and preserves fragments", () => {
    expect(
      bunnyImageUrl(
        "https://tnr-storage-cdn.b-cdn.net/image.webp?width=50#preview",
        400,
      ),
    ).toBe("https://tnr-storage-cdn.b-cdn.net/image.webp?width=400#preview");
  });

  it("matches and transforms parsed hostnames rather than URL text", () => {
    expect(isBunnyCdnUrl("https://example.com/?host=uploadthing.b-cdn.net")).toBe(false);
    expect(transformImageUrl("https://example.com/?host=utfs.io")).toBe(
      "https://example.com/?host=utfs.io",
    );
  });
});
