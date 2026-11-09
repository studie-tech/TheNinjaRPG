import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { SearchSelect } from "@/layout/SearchSelect";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";

beforeEach(() => {
  installBrowserGlobals({ resizeObserver: true, scrollIntoView: true });
});
afterEach(() => {
  cleanup();
  restoreBrowserGlobals();
});

const select = (
  props: { disabled?: boolean; searchLabel?: string; emptyText?: string } = {},
) => (
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
