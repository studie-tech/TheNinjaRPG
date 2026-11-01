import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { HotkeyCaptureDialog } from "@/layout/HotkeyControls";
import { ensureDom } from "../setup/dom.mjs";

// Radix dispatches DOM events through the global constructors.
const browserGlobals = ["Event", "CustomEvent", "KeyboardEvent"] as const;
const browserDescriptors = browserGlobals.map((key) =>
  Object.getOwnPropertyDescriptor(globalThis, key),
);

beforeEach(() => {
  ensureDom();
  for (const key of browserGlobals) {
    Object.defineProperty(globalThis, key, { configurable: true, value: window[key] });
  }
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  browserGlobals.forEach((key, index) => {
    const descriptor = browserDescriptors[index];
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  });
});

const open = (onAssign = vi.fn(() => true)) => {
  const onClose = vi.fn();
  const view = render(
    <HotkeyCaptureDialog
      target={{ id: "fireball", name: "Fireball", kind: "jutsu" }}
      currentKey="f"
      onAssign={onAssign}
      onClose={onClose}
    />,
  );
  return { view, onAssign, onClose };
};

it("leaves Tab and Enter to the dialog's own buttons", () => {
  const { view, onAssign, onClose } = open();
  for (const key of ["Tab", "Enter", " "]) {
    const event = new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  }
  expect(onAssign).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(view.queryByRole("alert")).toBeNull();
});

it("binds a pressed key and ignores modifier chords", () => {
  const { onAssign, onClose } = open();
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  expect(onAssign).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { key: "K" });
  expect(onAssign).toHaveBeenCalledWith("k");
  expect(onClose).toHaveBeenCalledTimes(1);
});
