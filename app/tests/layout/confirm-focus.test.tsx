import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import Confirm from "@/layout/Confirm";
import Modal from "@/layout/Modal";
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

const confirmation = (props: Partial<ComponentProps<typeof Confirm>> = {}) => (
  <Confirm
    title="Purchase pass?"
    triggerLabel="Open purchase confirmation"
    button={<button type="button">Purchase</button>}
    {...props}
  >
    {props.children ?? "Confirm purchase details."}
  </Confirm>
);

const openConfirmation = () => {
  const trigger = screen.getByRole("button", { name: "Open purchase confirmation" });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
  expect(
    document.activeElement === screen.getByRole("button", { name: "Proceed" }),
  ).toBe(true);
  return trigger;
};

describe("Confirm focus with real dialogs", () => {
  for (const nested of [false, true]) {
    for (const dismissal of ["Escape", "Close"]) {
      it(`returns focus after ${dismissal}${nested ? " inside another Modal" : ""}`, async () => {
        const onAccept = vi.fn();
        const onClose = vi.fn();
        const parentClose = vi.fn();
        const content = confirmation({ onAccept, onClose });
        render(
          nested ? (
            <Modal title="Pass details" isOpen setIsOpen={parentClose}>
              {content}
            </Modal>
          ) : (
            content
          ),
        );
        const trigger = openConfirmation();
        const dialog = screen.getByRole("dialog", { name: "Purchase pass?" });
        if (dismissal === "Escape")
          fireEvent.keyDown(document.activeElement!, { key: "Escape" });
        else
          fireEvent.click(within(dialog).getAllByRole("button", { name: "Close" })[0]!);
        await waitFor(() => expect(document.activeElement === trigger).toBe(true));
        expect(screen.queryByRole("dialog", { name: "Purchase pass?" })).toBeNull();
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onAccept).not.toHaveBeenCalled();
        expect(parentClose).not.toHaveBeenCalled();
        if (nested)
          expect(screen.getByRole("dialog", { name: "Pass details" })).toBeTruthy();
      });
    }
  }

  it("keeps pending actions guarded and restores focus after explicit success", async () => {
    let close = () => {};
    const onAccept = vi.fn((_event, actions: { close: () => void }) => {
      close = actions.close;
    });
    const view = render(confirmation({ keepOpenOnAccept: true, onAccept }));
    const trigger = openConfirmation();
    fireEvent.click(screen.getByRole("button", { name: "Proceed" }));
    view.rerender(confirmation({ keepOpenOnAccept: true, onAccept, isLoading: true }));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Proceed" }));
    expect(screen.getByRole("dialog", { name: "Purchase pass?" })).toBeTruthy();
    expect(onAccept).toHaveBeenCalledTimes(1);
    view.rerender(confirmation({ keepOpenOnAccept: true, onAccept }));
    act(close);
    await waitFor(() => expect(document.activeElement === trigger).toBe(true));
  });

  it("allows cancellation and restores focus after an action error clears pending", async () => {
    const onAccept = vi.fn();
    const view = render(confirmation({ keepOpenOnAccept: true, onAccept }));
    const trigger = openConfirmation();
    fireEvent.click(screen.getByRole("button", { name: "Proceed" }));
    view.rerender(confirmation({ keepOpenOnAccept: true, onAccept, isLoading: true }));
    view.rerender(
      confirmation({
        keepOpenOnAccept: true,
        onAccept,
        children: <p role="alert">Try again</p>,
      }),
    );
    expect(screen.getByRole("alert").textContent).toBe("Try again");
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(document.activeElement === trigger).toBe(true));
    expect(onAccept).toHaveBeenCalledTimes(1);
  });
});
