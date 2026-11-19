import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import CookieConsent from "@/app/[shell]/consent/page";
import * as contentBox from "@/layout/ContentBox";

beforeEach(() => {
  vi.spyOn(contentBox, "default").mockImplementation(({ children }) => (
    <div>{children}</div>
  ));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete window.Cookiebot;
});

describe("first-party cookie settings", () => {
  it("shows essential-only settings without contacting a hosted declaration", () => {
    render(<CookieConsent />);
    const screen = within(document.body);
    expect(screen.getByText("Always enabled")).toBeTruthy();
    expect(screen.getAllByText("Off")).toHaveLength(3);
    expect(document.querySelector('script[src*="cookiebot"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Change or withdraw consent" }));
    expect(screen.getByRole("status").textContent).toContain(
      "Optional tracking is off",
    );
  });
  it("reopens preferences and reports the stored choices", () => {
    const renew = vi.fn();
    window.Cookiebot = {
      consent: { preferences: false, statistics: true, marketing: false },
      hasResponse: true,
      renew,
    };
    render(<CookieConsent />);
    const screen = within(document.body);
    expect(screen.getAllByText("Enabled")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Change or withdraw consent" }));
    expect(renew).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
