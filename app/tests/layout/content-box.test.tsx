import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import * as navigation from "next/navigation";
import { useState } from "react";
import Confirm from "@/layout/Confirm";
import ContentBox, * as contentBox from "@/layout/ContentBox";
import {
  type HeaderActionItem,
  layoutHeaderMenu,
  REVEAL_CONTENT_BOX_CONTROLS,
  splitHeaderActions,
} from "@/layout/ContentBoxHeaderActions";
import Modal from "@/layout/Modal";
import {
  flushRadixFocus,
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../setup/browserGlobals";
import { actualContentBox } from "../setup/preload";

let headerWidth = 600;
let controlWidth = 240;
let actionsWidth = 400;
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
  actionsWidth = 400;
  vi.spyOn(contentBox, "default").mockImplementation(actualContentBox);
  vi.spyOn(navigation, "useRouter").mockReturnValue({
    back: vi.fn(),
    push: vi.fn(),
  } as never);
  Object.defineProperty(Element.prototype, "clientWidth", {
    configurable: true,
    get() {
      if (this.hasAttribute("data-content-box-header")) return headerWidth;
      return this.hasAttribute("data-content-box-actions") ? actionsWidth : 100;
    },
  });
  Object.defineProperty(Element.prototype, "scrollWidth", {
    configurable: true,
    get() {
      return this.hasAttribute("data-content-box-controls") ? controlWidth : 100;
    },
  });
  // Priority header controls are 44px wide, the tabs 90px.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
    this: Element,
  ) {
    const key = this.getAttribute("data-header-item");
    const width =
      key === null || this.childElementCount === 0 ? 0 : key === "tabs" ? 90 : 44;
    return new window.DOMRect(0, 0, width, 44);
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

it("keeps named action menus collapsed at every width and reveals guided targets", () => {
  const view = render(
    <ContentBox
      title="Travel"
      collapsedActionsLabel="Map controls"
      collapsedActionsIconOnly
      headerStartContent={
        <div>
          <button type="button">Sector</button>
          <button type="button">Global</button>
        </div>
      }
      topRightContent={
        <input id="guided-map-setting" aria-label="Map setting" defaultValue="Saved" />
      }
    >
      Map
    </ContentBox>,
  );
  const trigger = view.getByRole("button", { name: "Map controls" });
  const target = view.container.querySelector(
    "#guided-map-setting",
  ) as HTMLInputElement;
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(trigger.textContent).toBe("");
  expect(view.getByRole("button", { name: "Sector" }).closest("[inert]")).toBeNull();
  expect(view.getByRole("button", { name: "Global" }).closest("[inert]")).toBeNull();
  expect(
    view.getByRole("button", { name: "Global" }).compareDocumentPosition(trigger) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(view.queryByRole("textbox", { name: "Map setting" })).toBeNull();
  fireEvent(target, new Event(REVEAL_CONTENT_BOX_CONTROLS, { bubbles: true }));
  expect(view.getByRole("textbox", { name: "Map setting" })).toBe(target);
  fireEvent.change(target, { target: { value: "Edited" } });
  resizeHeader(1200);
  expect(view.getByRole("button", { name: "Map controls" })).toBe(trigger);
  fireEvent.keyDown(target, { key: "Escape" });
  expect(document.activeElement).toBe(trigger);
  expect(view.queryByRole("textbox", { name: "Map setting" })).toBeNull();
  fireEvent.click(trigger);
  expect(view.getByRole("textbox", { name: "Map setting" })).toBe(target);
  expect(target.value).toBe("Edited");
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

it("goes back only to a previous page of the game, otherwise to its parent page", () => {
  const router = { back: vi.fn(), push: vi.fn() };
  vi.spyOn(navigation, "useRouter").mockReturnValue(router as never);
  const setPrevious = (url: string | null) =>
    Object.defineProperty(window, "navigation", {
      configurable: true,
      value: {
        currentEntry: { index: url ? 1 : 0 },
        entries: () => (url ? [{ url }, { url: window.location.href }] : []),
      },
    });
  const view = render(
    <ContentBox title="Bank" defaultBackHref="/village">
      Body
    </ContentBox>,
  );
  const back = view.getByRole("button", { name: "Bank" });
  try {
    setPrevious(null);
    fireEvent.click(back);
    setPrevious(`${window.location.origin}/items`);
    fireEvent.click(back);
    setPrevious("https://www.google.com/search?q=tnr");
    fireEvent.click(back);
  } finally {
    Reflect.deleteProperty(window, "navigation");
  }
  expect(router.back).toHaveBeenCalledTimes(1);
  expect(router.push).toHaveBeenCalledTimes(2);
  expect(router.push).toHaveBeenCalledWith("/village");
});

const travelLikeItems = (
  overrides: Partial<Record<string, Partial<HeaderActionItem>>> = {},
): HeaderActionItem[] =>
  [
    { key: "players", priority: 6, label: "Show players" },
    { key: "stealth", priority: 1, label: "Stealth" },
    { key: "quick-travel", priority: 4, label: "Quick travel" },
    { key: "nothing", priority: 10, label: undefined },
    { key: "tabs", priority: 3, label: "Tabs" },
  ].map(({ key, priority, label }) => ({
    key,
    priority,
    node: label ? (
      <button type="button" id={`tool-${key}`}>
        {label}
      </button>
    ) : null,
    ...overrides[key],
  }));

const PriorityBox = ({ items }: { items: HeaderActionItem[] }) => (
  <ContentBox title="Travel" topRightItems={items}>
    Map
  </ContentBox>
);

const setupPriority = (items = travelLikeItems()) =>
  render(<PriorityBox items={items} />);

/** Gives the priority controls `width` beside the title's text. */
const resizeActions = (width: number) => {
  act(() => {
    headerWidth = width + titleTextWidth();
    for (const notify of resizeCallbacks) notify();
  });
};

/** The test environment's width for the "Travel" title text. */
const titleTextWidth = () => {
  const range = document.createRange();
  return range.getBoundingClientRect?.().width ?? 100;
};

const rowNames = (view: ReturnType<typeof render>) =>
  Array.from(
    view.container.querySelectorAll<HTMLElement>("[data-header-item]:not(.absolute)"),
  ).map((element) => element.textContent);

const menuNames = (view: ReturnType<typeof render>) =>
  (
    view
      .getByRole("region", { name: "More Travel controls", hidden: true })
      .getAttribute("aria-owns") ?? ""
  )
    .split(" ")
    .map((id) => document.getElementById(id)?.textContent);

it("keeps every priority control in the header row while they fit", () => {
  const view = setupPriority();
  expect(rowNames(view)).toEqual([
    "Show players",
    "Stealth",
    "Quick travel",
    "",
    "Tabs",
  ]);
  expect(view.queryByRole("button", { name: /More Travel controls/ })).toBeNull();
});

it("measures the room for controls from the title, not a longer subtitle", () => {
  // A long subtitle widens the title block and squeezes the actions; it truncates instead.
  actionsWidth = 150;
  const view = render(
    <ContentBox
      title="Travel"
      subtitle="Sector 115 (Konoki) · 12, 8, a long subtitle"
      topRightItems={travelLikeItems()}
    >
      Map
    </ContentBox>,
  );
  expect(view.queryByRole("button", { name: /More Travel controls/ })).toBeNull();
  expect(rowNames(view)).toEqual([
    "Show players",
    "Stealth",
    "Quick travel",
    "",
    "Tabs",
  ]);
});

it("moves the lowest-priority controls behind More, keeping both lists in display order", () => {
  const view = setupPriority();
  // Room for More (44) + stealth (44) + tabs (90): quick travel and show players leave.
  resizeActions(200);
  expect(rowNames(view)).toEqual(["Stealth", "", "Tabs"]);
  expect(menuNames(view)).toEqual(["Show players", "Quick travel"]);
  const more = view.getByRole("button", { name: "More Travel controls" });
  expect(more.getAttribute("aria-expanded")).toBe("false");
  const quickTravel = view.container.querySelector("#tool-quick-travel") as HTMLElement;
  expect(quickTravel.closest("[inert]")).not.toBeNull();
  fireEvent.click(more);
  expect(more.getAttribute("aria-expanded")).toBe("true");
  expect(quickTravel.closest("[inert]")).toBeNull();
  resizeActions(400);
  expect(view.queryByRole("button", { name: /More Travel controls/ })).toBeNull();
});

it("keeps the same control element when it moves between the row and More", () => {
  const view = setupPriority();
  const quickTravel = view.getByRole("button", { name: "Quick travel" });
  resizeActions(200);
  fireEvent.click(view.getByRole("button", { name: "More Travel controls" }));
  expect(view.getByRole("button", { name: "Quick travel" })).toBe(quickTravel);
  resizeActions(400);
  expect(view.getByRole("button", { name: "Quick travel" })).toBe(quickTravel);
});

it("gives the row back the room of a control that stops rendering", () => {
  const view = setupPriority();
  resizeActions(200);
  expect(menuNames(view)).toEqual(["Show players", "Quick travel"]);
  view.rerender(
    <PriorityBox items={travelLikeItems({ "quick-travel": { node: null } })} />,
  );
  act(() => {
    for (const notify of resizeCallbacks) notify();
  });
  // Without quick travel everything fits again, so the menu goes away.
  expect(view.queryByRole("button", { name: /More Travel controls/ })).toBeNull();
  expect(rowNames(view)).toEqual(["Show players", "Stealth", "", "", "Tabs"]);
});

it("places a control that starts rendering before the browser paints it", () => {
  const view = setupPriority(travelLikeItems({ players: { node: null } }));
  resizeActions(200);
  expect(view.queryByRole("button", { name: /More Travel controls/ })).toBeNull();
  // No resize notification: the new control is measured in the same commit.
  view.rerender(<PriorityBox items={travelLikeItems()} />);
  expect(menuNames(view)).toEqual(["Show players", "Quick travel"]);
});

it("closes More when it empties, so it does not reopen by itself", () => {
  const view = setupPriority();
  resizeActions(200);
  fireEvent.click(view.getByRole("button", { name: "More Travel controls" }));
  resizeActions(400);
  resizeActions(200);
  expect(
    view
      .getByRole("button", { name: "More Travel controls" })
      .getAttribute("aria-expanded"),
  ).toBe("false");
});

it("marks More while a control that needs attention is hidden in it", () => {
  const view = setupPriority(travelLikeItems({ players: { attention: true } }));
  expect(view.container.querySelector("[data-attention]")).toBeNull();
  resizeActions(200);
  const more = view.getByRole("button", { name: /More Travel controls/ });
  expect(more.getAttribute("aria-label")).toBe(
    "More Travel controls, includes a changed setting",
  );
  expect(more.querySelector("[data-attention]")).not.toBeNull();
});

it("closes More on Escape and returns focus to it", async () => {
  const view = setupPriority();
  resizeActions(200);
  const more = view.getByRole("button", { name: "More Travel controls" });
  fireEvent.click(more);
  fireEvent.keyDown(view.getByRole("button", { name: "Quick travel" }), {
    key: "Escape",
  });
  expect(more.getAttribute("aria-expanded")).toBe("false");
  await waitFor(() => expect(document.activeElement).toBe(more));
});

it("moves focus to More when moving the focused control behind it blurs the browser", () => {
  const view = setupPriority();
  const quickTravel = view.getByRole("button", { name: "Quick travel" });
  const appendChild = Node.prototype.appendChild;
  const blur = vi.spyOn(quickTravel, "blur");
  // Native Chrome blurs a focused descendant when React moves its keyed wrapper.
  vi.spyOn(Node.prototype, "appendChild").mockImplementation(function <T extends Node>(
    this: Node,
    node: T,
  ): T {
    if (node.contains(document.activeElement)) quickTravel.blur();
    return appendChild.call(this, node) as T;
  });
  quickTravel.focus();
  resizeActions(200);
  expect(blur).toHaveBeenCalled();
  expect(document.activeElement).toBe(
    view.getByRole("button", { name: "More Travel controls" }),
  );
});

it("leaves focus alone when the focused control stays in the row", () => {
  const view = setupPriority();
  const stealth = view.getByRole("button", { name: "Stealth" });
  stealth.focus();
  resizeActions(200);
  expect(document.activeElement).toBe(stealth);
});

it("orders the row, then More, then the controls behind it, so Tab follows what is shown", () => {
  const view = setupPriority();
  resizeActions(200);
  const order = Array.from(
    view.container.querySelectorAll<HTMLElement>(
      "[data-content-box-actions] > [data-header-item], [data-content-box-actions] > button",
    ),
  ).map((element) => element.dataset.headerItem ?? element.getAttribute("aria-label"));
  expect(order).toEqual([
    "stealth",
    "nothing",
    "tabs",
    "More Travel controls",
    "players",
    "quick-travel",
  ]);
});

it("reveals a tutorial target hidden behind More", () => {
  const view = setupPriority();
  resizeActions(200);
  const target = view.container.querySelector("#tool-quick-travel") as HTMLElement;
  expect(target.closest("[inert]")).not.toBeNull();
  fireEvent(target, new Event(REVEAL_CONTENT_BOX_CONTROLS, { bubbles: true }));
  expect(target.closest("[inert]")).toBeNull();
});

it("keeps narrower controls by priority when a wider, more important one cannot fit", () => {
  const items = [
    { key: "a", priority: 1 },
    { key: "wide", priority: 2 },
    { key: "b", priority: 3 },
  ];
  const width = (key: string) => (key === "wide" ? 200 : 44);
  expect([...splitHeaderActions(items, width, 400, 44)]).toEqual([]);
  expect([...splitHeaderActions(items, width, 150, 44)]).toEqual(["wide"]);
  expect([...splitHeaderActions(items, width, 100, 44)]).toEqual(["wide", "b"]);
});

it("lays the More menu out in rows no wider than the screen", () => {
  const layout = layoutHeaderMenu(["a", "b", "c"], () => 44, 120);
  // Two controls fit in 120 - 2 x 8 padding; the third starts a second row.
  expect(layout).toEqual({
    places: {
      a: { top: 8, right: 52 },
      b: { top: 8, right: 8 },
      c: { top: 52, right: 52 },
    },
    width: 104,
    height: 104,
  });
});
