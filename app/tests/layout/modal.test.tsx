import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as dialogComponents from "@/components/ui/dialog";
import Modal, {
  modalScrollableBodyClassName,
  modalViewportClassName,
} from "@/layout/Modal";
import { NumberInput } from "@/components/ui/number-input";
import { stubDialog } from "../setup/dialog";

let restoreDialog: () => void;
beforeEach(() => {
  restoreDialog = stubDialog();
});
afterEach(() => {
  restoreDialog();
});

describe("Modal", () => {
  afterEach(cleanup);

  it("keeps the footer outside the scrollable body on small viewports", () => {
    const { getByRole } = render(
      <Modal isOpen setIsOpen={vi.fn()} title="Test Modal">
        Scrollable body content
      </Modal>,
    );

    const dialog = getByRole("dialog");
    for (const className of modalViewportClassName.split(" ")) {
      expect(dialog.className).toContain(className);
    }

    const [header, scrollableBody, footer] = Array.from(dialog.children);
    expect(header?.querySelector("h2")?.textContent).toBe("Test Modal");
    expect(scrollableBody).not.toBeNull();
    for (const className of modalScrollableBodyClassName.split(" ")) {
      expect(scrollableBody?.className).toContain(className);
    }
    expect(scrollableBody?.textContent).toContain("Scrollable body content");

    const closeButton = getByRole("button", { name: "Close" });
    expect(footer).not.toBeNull();
    expect(footer?.contains(closeButton)).toBe(true);
    expect(scrollableBody?.nextElementSibling).toBe(footer);
    expect(scrollableBody?.contains(closeButton)).toBe(false);
  });

  it("omits the footer for content dialogs without a Close button", () => {
    const { getByRole, queryByRole } = render(
      <Modal isOpen setIsOpen={vi.fn()} title="Farm" closeButton={false}>
        Farm content
      </Modal>,
    );
    const dialog = getByRole("dialog");
    expect(queryByRole("button", { name: "Close" })).toBeNull();
    expect(dialog.children).toHaveLength(2);
  });

  it("keeps the confirmation footer when only the Close button is dropped", () => {
    const { getByRole, queryByRole } = render(
      <Modal
        isOpen
        setIsOpen={vi.fn()}
        title="Confirm"
        closeButton={false}
        proceed_label="Accept"
        onAccept={vi.fn()}
      >
        Body
      </Modal>,
    );
    expect(getByRole("button", { name: "Accept" })).toBeTruthy();
    expect(queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("shows caller extras, Close, then Proceed, styled from the theme unless the caller colours it", () => {
    const { getByRole, rerender } = render(
      <Modal
        isOpen
        setIsOpen={vi.fn()}
        title="Confirm"
        proceed_label="Proceed"
        onAccept={vi.fn()}
        footerExtra={<button type="button">Cancel listing</button>}
      >
        Body
      </Modal>,
    );
    const proceed = getByRole("button", { name: "Proceed" });
    const close = getByRole("button", { name: "Close" });
    // Proceed stays first in the DOM, where the dialog puts focus on open so Enter
    // confirms; CSS order shows it last, after the extras and Close.
    expect(proceed.parentElement?.firstElementChild).toBe(proceed);
    expect(close.className).toContain("order-1");
    expect(proceed.className).toContain("order-2");
    expect(getByRole("button", { name: "Cancel listing" }).className).not.toContain(
      "order-",
    );
    expect(proceed.className).toContain("bg-primary");
    expect(close.className).toContain("bg-card");

    rerender(
      <Modal
        isOpen
        setIsOpen={vi.fn()}
        title="Confirm"
        proceed_label="Abandon"
        onAccept={vi.fn()}
        confirmClassName="bg-red-600 text-white hover:bg-red-700"
      >
        Body
      </Modal>,
    );
    const destructive = getByRole("button", { name: "Abandon" }).className;
    expect(destructive).toContain("bg-red-600");
    expect(destructive).not.toContain("bg-primary");
  });

  it("blocks confirmation and closure for invalid numeric controls", () => {
    const accept = vi.fn();
    const close = vi.fn();
    const { getByRole, rerender } = render(
      <Modal
        isOpen
        setIsOpen={close}
        title="Quantity"
        proceed_label="Proceed"
        onAccept={accept}
      >
        <NumberInput value="" min={1} />
      </Modal>,
    );
    fireEvent.click(getByRole("button", { name: "Proceed" }));
    fireEvent.keyDown(document, { key: "Enter" });
    expect(accept).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    rerender(
      <Modal
        isOpen
        setIsOpen={close}
        title="Quantity"
        proceed_label="Proceed"
        onAccept={accept}
      >
        <NumberInput value={3} min={1} />
      </Modal>,
    );
    fireEvent.click(getByRole("button", { name: "Proceed" }));
    expect(accept).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith(false);
  });

  for (const value of ["", 3]) {
    it(`ignores composing Enter with a ${value === "" ? "blank" : "valid"} numeric draft`, () => {
      const accept = vi.fn();
      const close = vi.fn();
      const invalid = vi.fn();
      const { getByRole } = render(
        <Modal
          isOpen
          setIsOpen={close}
          title="Quantity"
          proceed_label="Proceed"
          onAccept={accept}
        >
          <NumberInput value={value} min={1} onInvalid={invalid} />
        </Modal>,
      );
      const input = getByRole("spinbutton");
      input.focus();
      expect(fireEvent.keyDown(input, { key: "Enter", isComposing: true })).toBe(true);
      expect(invalid).not.toHaveBeenCalled();
      expect(accept).not.toHaveBeenCalled();
      expect(close).not.toHaveBeenCalled();

      fireEvent.keyDown(input, { key: "Enter" });
      if (value === "") {
        expect(invalid).toHaveBeenCalled();
        expect(accept).not.toHaveBeenCalled();
        expect(close).not.toHaveBeenCalled();
      } else {
        expect(invalid).not.toHaveBeenCalled();
        expect(accept).toHaveBeenCalledTimes(1);
        expect(close).toHaveBeenCalledTimes(1);
        expect(close).toHaveBeenCalledWith(false);
      }
    });
  }

  it("runs onClose when the dialog's own close control dismisses it", () => {
    vi.spyOn(dialogComponents, "Dialog").mockImplementation((({
      open,
      onOpenChange,
      children,
    }: {
      open?: boolean;
      onOpenChange?: (open: boolean) => void;
      children: ReactNode;
    }) =>
      open ? (
        <>
          <button type="button" onClick={() => onOpenChange?.(false)}>
            Dismiss
          </button>
          {children}
        </>
      ) : null) as never);
    const onClose = vi.fn();
    const setIsOpen = vi.fn();
    const { getByRole } = render(
      <Modal isOpen setIsOpen={setIsOpen} onClose={onClose} title="Award">
        Body
      </Modal>,
    );
    fireEvent.click(getByRole("button", { name: "Dismiss" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(setIsOpen).toHaveBeenCalledWith(false);
  });
});
