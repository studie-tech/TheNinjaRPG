import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "bun:test";
import { parseHtml } from "@/utils/parse";
import { getIframeProviderName, toPrivacyEnhancedEmbedUrl } from "@/utils/audio";
import { ensureDom } from "../setup-dom.mjs";

ensureDom();

const EMBED =
  '<iframe src="https://www.youtube.com/embed/KgXxLOb-lEk?si=abc" width="560" height="315"></iframe>';

const setMarketingConsent = (marketing: boolean) => {
  window.Cookiebot = { consent: { marketing } };
  act(() => {
    window.dispatchEvent(new window.Event(marketing ? "CookiebotOnAccept" : "CookiebotOnDecline"));
  });
};

afterEach(() => {
  cleanup();
  delete window.Cookiebot;
});

describe("user-embedded iframes", () => {
  it("renders a placeholder on the server, before consent is known", () => {
    const markup = renderToStaticMarkup(parseHtml(EMBED) as React.ReactNode);
    expect(markup).not.toContain("<iframe");
    expect(markup).toContain("hosted by YouTube");
  });

  it("stays a placeholder without Cookiebot, until the visitor loads it", () => {
    const { container, getByRole } = render(<>{parseHtml(EMBED)}</>);
    expect(container.querySelector("iframe")).toBeNull();

    fireEvent.click(getByRole("button", { name: /load content/i }));
    const iframe = container.querySelector("iframe");
    expect(iframe?.getAttribute("src")).toBe(
      "https://www.youtube-nocookie.com/embed/KgXxLOb-lEk?si=abc",
    );
    expect(iframe?.hasAttribute("data-user-iframe")).toBe(true);
    expect(iframe?.getAttribute("referrerpolicy")).toBe("strict-origin-when-cross-origin");
  });

  it("loads once marketing consent is given and hides again when it is withdrawn", () => {
    const { container } = render(<>{parseHtml(EMBED)}</>);
    expect(container.querySelector("iframe")).toBeNull();

    setMarketingConsent(true);
    expect(container.querySelector("iframe")).not.toBeNull();

    setMarketingConsent(false);
    expect(container.querySelector("iframe")).toBeNull();
  });
});

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
    expect(getIframeProviderName("https://www.youtube-nocookie.com/embed/a")).toBe("YouTube");
    expect(getIframeProviderName("https://player.vimeo.com/video/1")).toBe("Vimeo");
    expect(getIframeProviderName("https://w.soundcloud.com/player")).toBe("SoundCloud");
    expect(getIframeProviderName("https://evilvimeo.com/video/1")).toBe("an external site");
    expect(getIframeProviderName("https://youtube.com.example.org/")).toBe(
      "an external site",
    );
  });
});
