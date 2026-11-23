import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import * as image from "@/layout/Image";
import {
  getDodgedPanelTop,
  getToastClearance,
  Spotlight,
  SpotlightPointer,
} from "@/layout/tutorial/Spotlight";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";

const originalElementsFromPoint = Object.getOwnPropertyDescriptor(
  document,
  "elementsFromPoint",
);
const originalInnerHeight = window.innerHeight;
const originalInnerWidth = window.innerWidth;
const originalOffsetWidth = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "offsetWidth",
);

beforeEach(() => {
  installBrowserGlobals();
  vi.spyOn(image, "default").mockImplementation(() => null);
});

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  if (originalElementsFromPoint) {
    Object.defineProperty(document, "elementsFromPoint", originalElementsFromPoint);
  } else {
    Reflect.deleteProperty(document, "elementsFromPoint");
  }
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: originalInnerHeight,
  });
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: originalInnerWidth,
  });
  if (originalOffsetWidth) {
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", originalOffsetWidth);
  }
  document.documentElement.style.removeProperty("--tutorial-toast-top");
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

/** Set the viewport's size. */
const viewport = (width: number, height: number) => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
};

/** A DOMRect at this box. */
const rect = (top: number, left: number, width: number, height: number) =>
  ({
    top,
    left,
    width,
    height,
    x: left,
    y: top,
    right: left + width,
    bottom: top + height,
  }) as DOMRect;

/** Give an element a fixed viewport box. */
const place = <T extends Element>(
  element: T,
  box: { top: number; left: number; width: number; height: number },
) => {
  element.getBoundingClientRect = () =>
    ({
      ...box,
      x: box.left,
      y: box.top,
      right: box.left + box.width,
      bottom: box.top + box.height,
      toJSON: () => box,
    }) as DOMRect;
  return element;
};

/** Hit testing at any point returns these elements, topmost first. */
const stubHits = (hits: () => Element[]) =>
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: hits,
  });

describe("tutorial spotlight", () => {
  const box = { top: 100, left: 50, width: 120, height: 160 };

  it("lights the element drawn at the hole, and only while the spotlight shows", () => {
    const wrapper = document.body.appendChild(document.createElement("div"));
    const card = place(wrapper.appendChild(document.createElement("button")), box);
    const faded = place(card.appendChild(document.createElement("div")), box);
    faded.className = "hover:opacity-50";
    const art = place(faded.appendChild(document.createElement("img")), {
      ...box,
      height: 120,
    });
    place(wrapper, { ...box, height: 400 });
    stubHits(() => [art, faded, card, wrapper, document.body]);

    const view = render(<Spotlight box={box} pointer={false} />);

    expect(card.hasAttribute("data-tutorial-spotlit")).toBe(true);
    expect(faded.hasAttribute("data-tutorial-spotlit")).toBe(false);
    expect(wrapper.hasAttribute("data-tutorial-spotlit")).toBe(false);
    const style = document.querySelector(
      "[data-battle-focus-layer] style",
    )?.textContent;
    expect(style).toContain('[class*="opacity-"]:not([class*="opacity-0"])');
    expect(style).toContain("opacity: 1 !important");

    view.unmount();
    expect(card.hasAttribute("data-tutorial-spotlit")).toBe(false);
  });

  it("skips its own layer when hit testing and moves the light with the box", () => {
    const first = place(document.body.appendChild(document.createElement("div")), box);
    const nextBox = { ...box, left: 300 };
    const second = place(
      document.body.appendChild(document.createElement("div")),
      nextBox,
    );
    let current: Element = first;
    stubHits(() => [
      ...Array.from(document.querySelectorAll("[data-battle-focus-layer] *")),
      current,
    ]);

    const view = render(<Spotlight box={box} pointer={false} />);
    expect(first.hasAttribute("data-tutorial-spotlit")).toBe(true);

    current = second;
    view.rerender(<Spotlight box={nextBox} pointer={false} />);
    expect(first.hasAttribute("data-tutorial-spotlit")).toBe(false);
    expect(second.hasAttribute("data-tutorial-spotlit")).toBe(true);
  });

  it("lights nothing where the browser cannot hit test", () => {
    const card = place(document.body.appendChild(document.createElement("div")), box);
    Reflect.deleteProperty(document, "elementsFromPoint");
    render(<Spotlight box={box} pointer={false} />);
    expect(card.hasAttribute("data-tutorial-spotlit")).toBe(false);
  });
});

describe("dodged lesson dock placement", () => {
  const panel = { left: 16, right: 359, height: 190 };

  /** A phone-sized shop dialog: header on top, stats in the middle, buy controls below. */
  const shopDialog = () => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 812 });
    const dialog = document.body.appendChild(document.createElement("div"));
    dialog.setAttribute("role", "dialog");
    const add = (tag: string, top: number, height: number) =>
      place(dialog.appendChild(document.createElement(tag)), {
        top,
        left: 32,
        width: 310,
        height,
      });
    add("h2", 24, 24);
    add("img", 60, 120);
    add("label", 190, 20);
    add("input", 212, 28);
    // The list of stats: plain text the dock may cover.
    add("div", 250, 300);
    add("label", 565, 16);
    add("div", 584, 30).setAttribute("role", "slider");
    const buy = add("button", 635, 40);
    return { dialog, buy };
  };

  it("keeps its usual place outside a dialog", () => {
    const target = place(document.body.appendChild(document.createElement("button")), {
      top: 600,
      left: 40,
      width: 100,
      height: 40,
    });
    expect(getDodgedPanelTop(target, panel, 60)).toBeNull();
  });

  it("covers the dialog's stats rather than its header or its buy controls", () => {
    const { buy } = shopDialog();
    const top = getDodgedPanelTop(buy, panel, 60);
    expect(top).not.toBeNull();
    const dockTop = top ?? 0;
    // Clear of the header's title, art and field...
    expect(dockTop).toBeGreaterThanOrEqual(240);
    // ...and of the quantity slider and the button with its pointer below it.
    expect(dockTop + panel.height).toBeLessThanOrEqual(565);
  });

  it("finds no place when the dock cannot fit clear of the target", () => {
    const { buy } = shopDialog();
    expect(getDodgedPanelTop(buy, { ...panel, height: 700 }, 60)).toBeNull();
  });
});

describe("edge pointer", () => {
  it("keeps its label on one line, inside the page beside the screen's edge", () => {
    viewport(375, 812);
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get() {
        return this instanceof HTMLButtonElement ? 120 : 0;
      },
    });
    const view = render(
      <SpotlightPointer box={{ top: -400, left: 330, width: 40, height: 40 }} />,
    );
    const pill = view.getByRole("button", {
      name: "Scroll up to the highlighted control",
    });
    expect(pill.textContent).toBe("Scroll up");
    expect(pill.className).toContain("whitespace-nowrap");
    expect(pill.className).toContain("w-max");
    // Centred under the highlight (x 350) it would cross the right edge: 375 - 8 - 120.
    expect(pill.style.left).toBe("247px");
    expect(pill.style.top).toBe("12px");
  });
});

describe("toast clearance", () => {
  it("starts toasts below a highlight in their column near the top of the screen", () => {
    viewport(375, 812);
    expect(getToastClearance([rect(8, 300, 60, 44), rect(60, 310, 42, 42)])).toBe(114);
  });

  it("leaves toasts in place for a highlight outside their column or lower down", () => {
    viewport(1440, 900);
    // A desktop's toasts stack on the right; a highlight on the left is clear of them.
    expect(getToastClearance([rect(20, 40, 200, 40)])).toBeNull();
    expect(getToastClearance([rect(500, 1200, 100, 40)])).toBeNull();
    expect(getToastClearance([])).toBeNull();
  });

  it("never pushes toasts past the middle of the screen", () => {
    viewport(375, 812);
    expect(getToastClearance([rect(100, 0, 375, 500)])).toBeNull();
  });

  it("publishes the clearance for the toaster while the spotlight shows", () => {
    viewport(375, 812);
    const box = { top: 10, left: 300, width: 60, height: 40 };
    let shown = box;
    // The hole, padded by 8 px around the box.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        return this.hasAttribute("data-spotlight-keep")
          ? rect(shown.top - 8, shown.left - 8, shown.width + 16, shown.height + 16)
          : rect(0, 0, 0, 0);
      },
    );
    const root = document.documentElement.style;
    const view = render(<Spotlight box={shown} pointer={false} />);
    expect(root.getPropertyValue("--tutorial-toast-top")).toBe("70px");
    shown = { ...box, top: 600 };
    view.rerender(<Spotlight box={shown} pointer={false} />);
    expect(root.getPropertyValue("--tutorial-toast-top")).toBe("");
    shown = box;
    view.rerender(<Spotlight box={shown} pointer={false} />);
    expect(root.getPropertyValue("--tutorial-toast-top")).toBe("70px");
    view.unmount();
    expect(root.getPropertyValue("--tutorial-toast-top")).toBe("");
  });
});
