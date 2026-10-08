import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as contentBox from "@/layout/ContentBox";
import { ensureDom } from "../../../../../tests/setup-dom.mjs";
import CookieConsent from "../page";

beforeEach(() => {
  ensureDom();
  vi.useFakeTimers();
  vi.spyOn(contentBox, "default").mockImplementation(({ children }) => (
    <div>{children}</div>
  ));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("cookie declaration loading", () => {
  it("replaces loading with recovery when the script fails", () => {
    render(<CookieConsent />);
    fireEvent.error(document.getElementById("CookieDeclaration") as HTMLScriptElement);
    const screen = within(document.body);
    expect(screen.queryByText("Loading consent data")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain(
      "Cookie settings unavailable",
    );
    expect(screen.getByRole("button", { name: "Reload page" })).toBeTruthy();
  });

  it("stops waiting when the declaration never finishes", () => {
    render(<CookieConsent />);
    act(() => vi.advanceTimersByTime(30_000));
    expect(within(document.body).getByRole("alert").textContent).toContain(
      "Cookie settings unavailable",
    );
    expect(within(document.body).queryByText("Loading consent data")).toBeNull();
  });

  it("reveals completed content and cancels the failure deadline", async () => {
    render(<CookieConsent />);
    const container = document.getElementById("CookiebotDeclaration") as HTMLDivElement;
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      height: 200,
    } as DOMRect);
    await act(async () => {
      const panel = document.createElement("div");
      panel.id = "CookieDeclarationUserStatusPanel";
      container.appendChild(panel);
    });
    act(() => vi.advanceTimersByTime(30_000));
    expect(within(document.body).queryByRole("alert")).toBeNull();
    expect(within(document.body).queryByText("Loading consent data")).toBeNull();
    expect(
      (document.getElementById("cookie-consent-mount") as HTMLDivElement).className,
    ).not.toContain("opacity-0");
  });

  it("removes pending content and timers when leaving the page", () => {
    const view = render(<CookieConsent />);
    const script = document.getElementById("CookieDeclaration") as HTMLScriptElement;
    view.unmount();
    expect(script.isConnected).toBe(false);
    expect(script.onerror).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
