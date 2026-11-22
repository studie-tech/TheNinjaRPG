import { afterEach, beforeEach, expect, it } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { FullScreenDialog, FullScreenDialogTitle } from "@/layout/TutorialScreens";
import {
  flushRadixFocus,
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../setup/browserGlobals";

beforeEach(() => installBrowserGlobals());
afterEach(async () => {
  cleanup();
  await flushRadixFocus();
  restoreBrowserGlobals();
});

const Page = () => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setIsOpen(true)}>
        Open screen
      </button>
      {isOpen && (
        <FullScreenDialog>
          <FullScreenDialogTitle>Tomorrow</FullScreenDialogTitle>
          <button type="button" onClick={() => setIsOpen(false)}>
            Continue
          </button>
        </FullScreenDialog>
      )}
    </>
  );
};

it("moves focus into a full-screen tutorial dialog and returns it on close", async () => {
  render(<Page />);
  const trigger = screen.getByRole("button", { name: "Open screen" });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "Tomorrow" });
  const proceed = screen.getByRole("button", { name: "Continue" });
  expect(dialog.contains(document.activeElement)).toBe(true);

  // Escape does not dismiss it: the screen leaves through its own buttons.
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(screen.getByRole("dialog", { name: "Tomorrow" })).toBeTruthy();

  fireEvent.click(proceed);
  await flushRadixFocus();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
