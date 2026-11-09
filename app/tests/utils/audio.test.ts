import { describe, expect, it } from "bun:test";
import { getIframeProviderName, toPrivacyEnhancedEmbedUrl } from "@/utils/audio";

describe("toPrivacyEnhancedEmbedUrl", () => {
  it("moves bare youtube-nocookie.com embeds to the www host the CSP allows", () => {
    expect(toPrivacyEnhancedEmbedUrl("https://youtube-nocookie.com/embed/abc")).toBe(
      "https://www.youtube-nocookie.com/embed/abc",
    );
  });

  it("moves YouTube embeds to youtube-nocookie.com", () => {
    expect(toPrivacyEnhancedEmbedUrl("https://youtube.com/embed/abc?start=5")).toBe(
      "https://www.youtube-nocookie.com/embed/abc?start=5",
    );
  });

  it("leaves other URLs untouched", () => {
    for (const url of [
      "https://www.youtube-nocookie.com/embed/abc",
      "https://www.youtube.com/watch?v=abc",
      "https://player.vimeo.com/video/1",
      "not a url",
    ]) {
      expect(toPrivacyEnhancedEmbedUrl(url)).toBe(url);
    }
  });
});

describe("getIframeProviderName", () => {
  it("names providers by exact domain or subdomain only", () => {
    expect(getIframeProviderName("https://www.youtube-nocookie.com/embed/a")).toBe(
      "YouTube",
    );
    expect(getIframeProviderName("https://player.vimeo.com/video/1")).toBe("Vimeo");
    expect(getIframeProviderName("https://w.soundcloud.com/player")).toBe("SoundCloud");
    expect(getIframeProviderName("https://evilvimeo.com/video/1")).toBe(
      "an external site",
    );
    expect(getIframeProviderName("https://youtube.com.example.org/")).toBe(
      "an external site",
    );
  });
});
