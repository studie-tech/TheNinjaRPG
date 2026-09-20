import * as clerk from "@clerk/nextjs";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as shell from "@/hooks/useNativeShell";
import { ensureDom } from "../../../../tests/setup-dom.mjs";
import { NativeSettingsEntry } from "../NativeSettingsEntry";

const state = { native: true, signedIn: true };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => {
  ensureDom();
  state.native = true;
  state.signedIn = true;
  vi.spyOn(clerk, "useUser").mockImplementation(
    () => ({ isSignedIn: state.signedIn }) as ReturnType<typeof clerk.useUser>,
  );
  vi.spyOn(shell, "useNativeShell").mockImplementation(() => state.native);
});
describe("native settings navigation", () => {
  it.each([
    ["App settings", "/settings/device"],
    ["Delete account", "/account/delete"],
  ])("navigates to %s and dismisses settings", (name, href) => {
    const onNavigate = vi.fn();
    const view = render(<NativeSettingsEntry onNavigate={onNavigate} />);
    const link = view.getByRole("link", { name });
    expect(link.getAttribute("href")).toBe(href);
    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledOnce();
  });
  it("does not expose native account controls on the website or signed out", () => {
    state.native = false;
    const view = render(<NativeSettingsEntry />);
    expect(view.queryByRole("link")).toBeNull();
    state.native = true;
    state.signedIn = false;
    view.rerender(<NativeSettingsEntry />);
    expect(view.queryByRole("link")).toBeNull();
  });
});
