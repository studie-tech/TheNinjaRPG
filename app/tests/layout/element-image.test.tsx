import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "bun:test";
import ElementImage from "@/layout/ElementImage";

const browserGlobals = ["Event", "CustomEvent"] as const;
const saved = browserGlobals.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));

// Radix dispatches jsdom events, which must come from the jsdom window.
beforeEach(() => {
  for (const key of browserGlobals)
    Object.defineProperty(globalThis, key, { configurable: true, value: window[key] });
});

afterEach(() => {
  cleanup();
  browserGlobals.forEach((key, index) => {
    const descriptor = saved[index];
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  });
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
