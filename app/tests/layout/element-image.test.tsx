import { afterEach, beforeEach, expect, it } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ElementImage from "@/layout/ElementImage";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";

beforeEach(() => {
  installBrowserGlobals();
});

afterEach(() => {
  cleanup();
  restoreBrowserGlobals();
});

it("shows its label above the page so a scrolling side panel cannot clip it", async () => {
  const { container } = render(
    <div style={{ overflow: "auto", width: 40 }}>
      <ElementImage element="Intelligence" className="h-6 w-6" />
    </div>,
  );
  fireEvent.focus(container.querySelector("[data-state]")!);
  const label = await screen.findByRole("tooltip");
  expect(label.textContent).toBe("Intelligence");
  expect(container.contains(label)).toBe(false);
});

it("labels the highest-stat badge on hover", async () => {
  const { container } = render(<ElementImage element="Highest" className="h-6 w-6" />);
  fireEvent.focus(container.querySelector("[data-state]")!);
  expect((await screen.findByRole("tooltip")).textContent).toBe("Highest");
});
