import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import type { HotkeyTarget } from "@/layout/HotkeyControls";
import { HotkeyCaptureDialog } from "@/layout/HotkeyControls";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";

beforeEach(() => {
  installBrowserGlobals();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  restoreBrowserGlobals();
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

/** Drive the controlled dialog through open, target changes and dismissal. */
const controlledCapture = () => {
  const onAssign = vi.fn(() => true);
  const onClose = () => show(null);
  const content = (target: HotkeyTarget | null) => (
    <HotkeyCaptureDialog target={target} onAssign={onAssign} onClose={onClose} />
  );
  const view = render(content(null));
  const show = (target: HotkeyTarget | null) => view.rerender(content(target));
  return { view, show, onAssign };
};

it("leaves Tab and Enter to the dialog's own buttons", () => {
  const { view, onAssign, onClose } = open();
  for (const key of ["Tab", "Enter", " "]) {
    const event = new window.KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    });
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

for (const key of ["Escape", "k"]) {
  it(`returns focus to each opener after ${key === "Escape" ? "cancellation" : "assignment"}, including target changes`, async () => {
    const { view, show, onAssign } = controlledCapture();
    for (const name of ["Fireball", "Waterball"]) {
      const opener = document.createElement("button");
      opener.textContent = `Set ${name} hotkey`;
      document.body.append(opener);
      opener.focus();
      show({ id: name, name, kind: "jutsu" });
      expect(view.getByRole("dialog").contains(document.activeElement)).toBe(true);
      show({ id: "changed", name: "Changed target", kind: "jutsu" });
      fireEvent.keyDown(document.activeElement!, { key });

      await waitFor(() => expect(document.activeElement === opener).toBe(true));
    }
    expect(onAssign).toHaveBeenCalledTimes(key === "Escape" ? 0 : 2);
  });
}

it("leaves focus moved elsewhere during dismissal alone", async () => {
  const { show } = controlledCapture();
  const opener = document.createElement("button");
  const destination = document.createElement("button");
  document.body.append(opener, destination);
  opener.focus();
  show({ id: "fireball", name: "Fireball", kind: "jutsu" });
  show(null);
  destination.focus();
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  expect(document.activeElement === destination).toBe(true);
});

it("does not focus an opener removed during dismissal", async () => {
  const { show } = controlledCapture();
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  show({ id: "fireball", name: "Fireball", kind: "jutsu" });
  const focus = vi.spyOn(opener, "focus");
  show(null);
  opener.remove();
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  expect(focus).not.toHaveBeenCalled();
  focus.mockRestore();
});
