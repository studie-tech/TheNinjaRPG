import { ensureDom } from "../setup/dom.mjs";
const { cleanup, fireEvent, render } = await import("@testing-library/react");
import type { HTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as dialogComponents from "@/components/ui/dialog";
import Modal, {
  modalScrollableBodyClassName,
  modalViewportClassName,
} from "@/layout/Modal";
import { NumberInput } from "@/components/ui/number-input";
import AutoAttackModal from "@/layout/AutoAttackModal";

const dialogMocks = {
  Dialog: ({ open, children }: { open?: boolean; children: ReactNode }) =>
    open ? children : null,
  DialogContent: ({
    className,
    children,
    id,
  }: HTMLAttributes<HTMLDivElement> & { id?: string }) => (
    <div role="dialog" id={id} className={className}>
      {children}
    </div>
  ),
  DialogHeader: ({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) => (
    <div className={className} {...props}>
      {children}
    </div>
  ),
  DialogFooter: ({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) => (
    <div className={className} {...props}>
      {children}
    </div>
  ),
  DialogTitle: ({
    className,
    children,
    ...props
  }: HTMLAttributes<HTMLHeadingElement>) => (
    <h2 className={className} {...props}>
      {children}
    </h2>
  ),
};

const dialogSpies: { mockRestore: () => void }[] = [];
beforeEach(() => {
  for (const [name, implementation] of Object.entries(dialogMocks)) {
    dialogSpies.push(vi.spyOn(dialogComponents, name as keyof typeof dialogMocks).mockImplementation(implementation as never));
  }
});
afterEach(() => {
  for (const spy of dialogSpies.splice(0)) spy.mockRestore();
});

describe("Modal", () => {
  beforeEach(ensureDom);
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

  it("blocks confirmation and closure for invalid numeric controls", () => {
    const accept = vi.fn();
    const close = vi.fn();
    const { getByRole, rerender } = render(
      <Modal isOpen setIsOpen={close} title="Quantity" proceed_label="Proceed" onAccept={accept}>
        <NumberInput value="" min={1} />
      </Modal>,
    );
    fireEvent.click(getByRole("button", { name: "Proceed" }));
    fireEvent.keyDown(document, { key: "Enter" });
    expect(accept).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    rerender(
      <Modal isOpen setIsOpen={close} title="Quantity" proceed_label="Proceed" onAccept={accept}>
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
        <Modal isOpen setIsOpen={close} title="Quantity" proceed_label="Proceed" onAccept={accept}>
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

  it("keeps invalid auto-attack drafts out of storage and commits before enabling", () => {
    const originalCustomEvent = globalThis.CustomEvent;
    globalThis.CustomEvent = window.CustomEvent;
    localStorage.setItem("autoAttackMinLevel", "1");
    localStorage.setItem("autoAttackDelay", "5");
    const enabled = vi.fn(() => {
      expect(localStorage.getItem("autoAttackMinLevel")).toBe("3");
      expect(localStorage.getItem("autoAttackDelay")).toBe("2");
    });
    const { getByRole } = render(<AutoAttackModal isOpen setIsOpen={vi.fn()} onEnable={enabled} />);
    fireEvent.input(getByRole("spinbutton", { name: "Minimum Level to Attack" }), { target: { value: "" } });
    expect(localStorage.getItem("autoAttackMinLevel")).toBe("1");
    expect((getByRole("button", { name: "Enable Auto Attack" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.input(getByRole("spinbutton", { name: "Minimum Level to Attack" }), { target: { value: "3" } });
    fireEvent.input(getByRole("spinbutton", { name: "Attack Delay (seconds)" }), { target: { value: "2" } });
    fireEvent.click(getByRole("button", { name: "Enable Auto Attack" }));
    expect(enabled).toHaveBeenCalledTimes(1);
    localStorage.removeItem("autoAttackMinLevel");
    localStorage.removeItem("autoAttackDelay");
    globalThis.CustomEvent = originalCustomEvent;
  });
});
