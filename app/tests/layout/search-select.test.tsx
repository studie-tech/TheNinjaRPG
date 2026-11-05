import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { SearchSelect } from "@/layout/SearchSelect";

// SearchSelect needs browser-native events, measurements and scrolling absent from the DOM shim.
const browserGlobals = ["Event", "CustomEvent", "ResizeObserver"] as const;
const originalGlobals = browserGlobals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
beforeEach(() => {
  Object.defineProperties(globalThis, {
    Event: { configurable: true, value: window.Event },
    CustomEvent: { configurable: true, value: window.CustomEvent },
    ResizeObserver: { configurable: true, value: class { observe() {} unobserve() {} disconnect() {} } },
  });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => undefined });
});
afterEach(() => {
  cleanup();
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  if (originalScroll) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScroll);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

const select = (props: { disabled?: boolean; searchLabel?: string; emptyText?: string } = {}) => (
  <SearchSelect
    label="Wanted item"
    placeholder="Choose"
    value=""
    options={[{ value: "a", label: "Alpha" }]}
    onChange={() => undefined}
    {...props}
  />
);
const trigger = () => screen.getByRole("combobox", { name: "Wanted item" });

describe("SearchSelect", () => {
  it("does not reopen after being disabled while open", () => {
    const view = render(select());
    fireEvent.click(trigger());
    expect(screen.getByPlaceholderText("Search wanted item...")).toBeTruthy();

    view.rerender(select({ disabled: true }));
    expect(screen.queryByPlaceholderText("Search wanted item...")).toBeNull();

    view.rerender(select());
    expect(screen.queryByPlaceholderText("Search wanted item...")).toBeNull();
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
  });

  it("uses a custom search label", () => {
    render(select({ searchLabel: "Search inventory" }));
    fireEvent.click(trigger());
    expect(screen.getByPlaceholderText("Search inventory...")).toBeTruthy();
  });
});
