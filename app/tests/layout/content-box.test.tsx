import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import * as navigation from "next/navigation";
import { useState } from "react";
import Confirm from "@/layout/Confirm";
import ContentBox, * as contentBox from "@/layout/ContentBox";
import { REVEAL_CONTENT_BOX_CONTROLS } from "@/layout/ContentBoxHeaderActions";
import Modal from "@/layout/Modal";
import {
  flushRadixFocus,
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../setup/browserGlobals";
import { actualContentBox } from "../setup/preload";

let headerWidth = 600;
let controlWidth = 240;
const resizeCallbacks = new Set<() => void>();
const originalClientWidth = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "clientWidth",
);
const originalScrollWidth = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "scrollWidth",
);

class HeaderResizeObserver {
  notify: () => void;
  constructor(callback: ResizeObserverCallback) {
    this.notify = () => callback([], this as unknown as ResizeObserver);
    resizeCallbacks.add(this.notify);
  }
  observe() {}
  unobserve() {}
  disconnect() {
    resizeCallbacks.delete(this.notify);
  }
}

beforeEach(() => {
  installBrowserGlobals({ resizeObserver: HeaderResizeObserver });
  headerWidth = 600;
  controlWidth = 240;
  vi.spyOn(contentBox, "default").mockImplementation(actualContentBox);
  vi.spyOn(navigation, "useRouter").mockReturnValue({
    back: vi.fn(),
    push: vi.fn(),
  } as never);
  Object.defineProperty(Element.prototype, "clientWidth", {
    configurable: true,
    get() {
      return this.hasAttribute("data-content-box-header") ? headerWidth : 100;
    },
  });
  Object.defineProperty(Element.prototype, "scrollWidth", {
    configurable: true,
    get() {
      return this.hasAttribute("data-content-box-controls") ? controlWidth : 100;
    },
  });
  vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function (
    this: Element,
  ) {
    return (this.getAttribute("role") === "dialog"
      ? [new window.DOMRect(0, 0, 200, 200)]
      : []) as unknown as DOMRectList;
  });
});
afterEach(async () => {
  cleanup();
  await flushRadixFocus();
  vi.restoreAllMocks();
  if (originalClientWidth)
    Object.defineProperty(Element.prototype, "clientWidth", originalClientWidth);
  if (originalScrollWidth)
    Object.defineProperty(Element.prototype, "scrollWidth", originalScrollWidth);
  restoreBrowserGlobals();
  resizeCallbacks.clear();
});

const resizeHeader = (width: number) => {
  act(() => {
    headerWidth = width;
    for (const notify of resizeCallbacks) notify();
  });
};

const setup = () =>
  render(
    <ContentBox
      title="Town Hall"
      subtitle="Village controls"
      topRightContent={
        <div>
          <input aria-label="Control draft" defaultValue="Keep this draft" />
          <Confirm
            title="Change village"
            button={<button type="button">Change</button>}
          >
            <input aria-label="Dialog draft" defaultValue="Keep this dialog" />
          </Confirm>
          <button type="button" id="tutorial-header-action">
            Guided action
          </button>
        </div>
      }
    >
      Body
    </ContentBox>,
  );

it("keeps title and controls beside each other when the panel has space", () => {
  const view = setup();
  const header = view.getByText("Town Hall").closest("[data-content-box-header]");
  expect(header?.className).toContain("flex-row");
  expect(header?.className).not.toContain("flex-col");
  expect(view.queryByRole("button", { name: "Town Hall controls" })).toBeNull();
  expect(view.getByRole("textbox", { name: "Control draft" })).toBeDefined();
});

it("uses the panel width and preserves the same control and draft across resizes", () => {
  const view = setup();
  const draft = view.getByRole("textbox", { name: "Control draft" });
  fireEvent.change(draft, { target: { value: "Edited before resizing" } });
  resizeHeader(300);
  expect(view.queryByRole("textbox", { name: "Control draft" })).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Town Hall controls" }));
  expect(view.getByRole("textbox", { name: "Control draft" })).toBe(draft);
  expect((draft as HTMLInputElement).value).toBe("Edited before resizing");
  resizeHeader(800);
  expect(view.queryByRole("button", { name: "Town Hall controls" })).toBeNull();
  expect(view.getByRole("textbox", { name: "Control draft" })).toBe(draft);
});

it("measures changing controls as well as changes in the available panel width", () => {
  const view = setup();
  act(() => {
    controlWidth = 550;
    for (const notify of resizeCallbacks) notify();
  });
  expect(view.getByRole("button", { name: "Town Hall controls" })).toBeDefined();
  act(() => {
    controlWidth = 100;
    for (const notify of resizeCallbacks) notify();
  });
  expect(view.queryByRole("button", { name: "Town Hall controls" })).toBeNull();
});

it("preserves nested dialogs through interactions and resizes, then returns keyboard focus", async () => {
  const view = setup();
  resizeHeader(300);
  const trigger = view.getByRole("button", { name: "Town Hall controls" });
  fireEvent.click(trigger);
  fireEvent.click(view.getByText("Change", { selector: "button" }));
  const dialog = await view.findByRole("dialog", { name: "Change village" });
  const draft = view.getByRole("textbox", { name: "Dialog draft" });
  fireEvent.change(draft, { target: { value: "Edited inside the dialog" } });
  fireEvent.pointerDown(draft);
  resizeHeader(800);
  expect(view.getByRole("dialog", { name: "Change village" })).toBe(dialog);
  expect((draft as HTMLInputElement).value).toBe("Edited inside the dialog");
  resizeHeader(300);
  const close = view.getAllByRole("button", { name: /^Close$/ })[0];
  if (!close) throw new Error("Missing dialog close button");
  fireEvent.click(close);
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  fireEvent.keyDown(trigger, { key: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});

it("dismisses overflow on an outside pointer interaction without discarding its contents", () => {
  const view = setup();
  resizeHeader(300);
  const trigger = view.getByRole("button", { name: "Town Hall controls" });
  fireEvent.click(trigger);
  const draft = view.getByRole("textbox", { name: "Control draft" });
  fireEvent.change(draft, { target: { value: "Preserved after dismissal" } });
  fireEvent.pointerDown(document.body);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(trigger);
  expect(view.getByRole("textbox", { name: "Control draft" })).toBe(draft);
  expect((draft as HTMLInputElement).value).toBe("Preserved after dismissal");
});

it("reveals a collapsed tutorial target without changing its identity", () => {
  const view = setup();
  const target = view.getByRole("button", { name: "Guided action" });
  resizeHeader(300);
  expect(target.closest("[inert]")).not.toBeNull();
  fireEvent(target, new Event(REVEAL_CONTENT_BOX_CONTROLS, { bubbles: true }));
  expect(target.closest("[inert]")).toBeNull();
  expect(view.getByRole("button", { name: "Guided action" })).toBe(target);
});

it("returns a programmatic dialog to the persistent overflow button", async () => {
  function HeaderDialog() {
    const [isOpen, setIsOpen] = useState(false);
    return (
      <ContentBox
        title="Town Hall"
        topRightContent={
          <>
            <button type="button" onClick={() => setIsOpen(true)}>
              Edit village
            </button>
            <Modal title="Edit village" isOpen={isOpen} setIsOpen={setIsOpen}>
              Village settings
            </Modal>
          </>
        }
      >
        Body
      </ContentBox>
    );
  }
  const view = render(<HeaderDialog />);
  resizeHeader(300);
  const trigger = view.getByRole("button", { name: "Town Hall controls" });
  fireEvent.click(trigger);
  fireEvent.click(view.getByRole("button", { name: "Edit village" }));
  await view.findByRole("dialog", { name: "Edit village" });
  const close = view.getAllByRole("button", { name: /^Close$/ })[0];
  if (!close) throw new Error("Missing dialog close button");
  fireEvent.click(close);
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});

it("closes the header disclosure before dismissing a containing dialog", async () => {
  function DialogWithHeader() {
    const [isOpen, setIsOpen] = useState(true);
    return (
      <Modal title="Outer dialog" isOpen={isOpen} setIsOpen={setIsOpen}>
        <ContentBox
          title="Town Hall"
          topRightContent={<button type="button">Inner action</button>}
        >
          Village settings
        </ContentBox>
      </Modal>
    );
  }
  const view = render(<DialogWithHeader />);
  resizeHeader(300);
  const trigger = view.getByRole("button", { name: "Town Hall controls" });
  fireEvent.click(trigger);
  fireEvent.keyDown(view.getByRole("button", { name: "Inner action" }), {
    key: "Escape",
  });
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(view.queryByRole("dialog", { name: "Outer dialog" }) !== null).toBe(true);
});

it("opens controls above a header near the bottom of the viewport", () => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
    this: Element,
  ) {
    return this.hasAttribute("data-content-box-actions")
      ? new window.DOMRect(0, window.innerHeight - 60, 44, 44)
      : new window.DOMRect(0, 0, 100, 30);
  });
  const view = setup();
  resizeHeader(300);
  fireEvent.click(view.getByRole("button", { name: "Town Hall controls" }));
  const panel = view.getByRole("region", { name: "Town Hall controls" });
  expect(panel.className).toContain("bottom-full");
});
