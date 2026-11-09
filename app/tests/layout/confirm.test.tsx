import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import Confirm from "@/layout/Confirm";
import * as Modal from "@/layout/Modal";

beforeEach(() => {
  vi.spyOn(Modal, "default").mockImplementation(({ isOpen, onAccept, children }) =>
    isOpen ? (
      <div role="dialog">
        <button type="button" onClick={onAccept}>
          Proceed
        </button>
        {children}
      </div>
    ) : null,
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const trigger = () => screen.getByRole("button", { name: "Delete art" });
const open = () => fireEvent.click(trigger());

const confirm = (props: Partial<ComponentProps<typeof Confirm>> = {}) => (
  <Confirm
    title="Delete?"
    button={<svg aria-hidden />}
    triggerLabel="Delete art"
    {...props}
  >
    Body
  </Confirm>
);

describe("Confirm trigger", () => {
  it("opens the dialog without activating a surrounding link", () => {
    const onLinkClick = vi.fn();
    render(<div onClick={onLinkClick}>{confirm()}</div>);
    open();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(onLinkClick).not.toHaveBeenCalled();
  });

  it("stays inert inside a link while disabled", () => {
    const onLinkClick = vi.fn();
    render(<div onClick={onLinkClick}>{confirm({ disabled: true })}</div>);
    open();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onLinkClick).not.toHaveBeenCalled();
    expect(trigger().getAttribute("aria-disabled")).toBe("true");
    expect(trigger().getAttribute("tabindex")).toBe("-1");
  });

  it("adds trigger classes without replacing its own", () => {
    render(confirm({ triggerClassName: "text-white" }));
    expect(trigger().className).toContain("inline-flex");
    expect(trigger().className).toContain("cursor-pointer");
    expect(trigger().className).toContain("text-white");
  });
});

describe("Confirm onAccept", () => {
  it("lets a kept-open dialog close itself after success", async () => {
    let close = () => {};
    render(
      confirm({
        keepOpenOnAccept: true,
        onAccept: (_event, actions) => {
          close = actions.close;
        },
      }),
    );
    open();
    fireEvent.click(screen.getByRole("button", { name: "Proceed" }));
    expect(screen.getByRole("dialog")).toBeTruthy();

    act(() => close());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
