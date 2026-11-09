import { afterEach, describe, expect, it } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHtml } from "@/utils/parse";

const EMBED =
  '<iframe src="https://www.youtube.com/embed/KgXxLOb-lEk?si=abc" width="560" height="315"></iframe>';

const setMarketingConsent = (marketing: boolean) => {
  window.Cookiebot = { consent: { marketing } };
  act(() => {
    window.dispatchEvent(
      new window.Event(marketing ? "CookiebotOnAccept" : "CookiebotOnDecline"),
    );
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
    expect(iframe?.getAttribute("referrerpolicy")).toBe(
      "strict-origin-when-cross-origin",
    );
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
