import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import * as image from "@/layout/Image";
import {
  getDodgedPanelTop,
  getPanelPlaceOverDialog,
  getSpotlightPanel,
  getSpotlightScene,
  getToastClearance,
  getUsableHighlightElement,
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

  it("stands over a dialog's blank space, on the side clear of its buttons", () => {
    const dialog = document.body.appendChild(document.createElement("div"));
    dialog.setAttribute("role", "dialog");
    // The whole dialog is the target, its buttons at the right of its foot.
    const height = window.innerHeight;
    const width = document.documentElement.clientWidth || window.innerWidth;
    place(dialog, { top: 200, left: 100, width: width - 200, height: height - 400 });
    place(dialog.appendChild(document.createElement("button")), {
      top: height - 260,
      left: width - 200,
      width: 80,
      height: 40,
    });
    const dock = { left: width - 440, right: width - 20, height: 300 };
    expect(getPanelPlaceOverDialog(dialog, dock, 60)).toEqual({
      side: "left",
      top: height - 12 - 300,
    });
    expect(getPanelPlaceOverDialog(document.body, dock, 60)).toBeNull();
  });
});

describe("a target under a modal", () => {
  it("is passed over for one in the modal, and found again once it closes", () => {
    const page = document.body.appendChild(document.createElement("main"));
    const box = { top: 100, left: 40, width: 100, height: 40 };
    const covered = place(page.appendChild(document.createElement("button")), box);
    covered.id = "level-up";
    // Radix hides the page behind an open modal with both attributes.
    page.setAttribute("aria-hidden", "true");
    page.setAttribute("data-aria-hidden", "true");
    expect(getUsableHighlightElement("level-up")).toBeNull();
    const modal = document.body.appendChild(document.createElement("div"));
    const proceed = place(modal.appendChild(document.createElement("button")), box);
    proceed.id = "level-up-proceed";
    expect(getUsableHighlightElement("level-up-proceed")).toBe(proceed);
    page.removeAttribute("aria-hidden");
    page.removeAttribute("data-aria-hidden");
    expect(getUsableHighlightElement("level-up")).toBe(covered);
  });

  it("ignores content hidden from assistive technology alone", () => {
    const page = document.body.appendChild(document.createElement("main"));
    page.setAttribute("aria-hidden", "true");
    const target = place(page.appendChild(document.createElement("button")), {
      top: 100,
      left: 40,
      width: 100,
      height: 40,
    });
    target.id = "marker";
    expect(getUsableHighlightElement("marker")).toBe(target);
  });
});

describe("a spotlight inside a scene", () => {
  const box = { top: 100, left: 50, width: 40, height: 40 };
  const sceneBox = { top: 60, left: 20, width: 600, height: 400 };

  it("finds the nearest scene around the target, and none for a target outside one", () => {
    const page = place(document.body.appendChild(document.createElement("div")), {
      ...sceneBox,
      height: 900,
    });
    page.setAttribute("data-spotlight-scene", "");
    const map = place(page.appendChild(document.createElement("div")), sceneBox);
    map.setAttribute("data-spotlight-scene", "");
    const tile = place(map.appendChild(document.createElement("div")), box);
    const tab = place(document.body.appendChild(document.createElement("button")), box);

    expect(getSpotlightScene(tile)).toEqual(sceneBox);
    expect(getSpotlightScene(tab)).toBeNull();
  });

  it("leaves the scene undimmed around the control", () => {
    document.elementsFromPoint = () => [];
    const view = render(<Spotlight box={box} scene={sceneBox} pointer={false} />);
    const hole = document.querySelector("mask [data-spotlight-lit-scene]");
    expect(hole?.getAttribute("fill")).toBe("black");
    expect(
      ["x", "y", "width", "height"].map((name) => Number(hole?.getAttribute(name))),
    ).toEqual([sceneBox.left, sceneBox.top, sceneBox.width, sceneBox.height]);

    view.rerender(<Spotlight box={box} scene={null} pointer={false} />);
    expect(document.querySelector("[data-spotlight-lit-scene]")).toBeNull();
  });
});

describe("a spotlight inside a panel", () => {
  const button = { top: 300, left: 420, width: 200, height: 40 };
  /** A button in nested panels, outermost first. */
  const nest = (...boxes: (typeof button)[]) => {
    let parent: Element = document.body;
    for (const box of boxes) {
      parent = place(parent.appendChild(document.createElement("div")), box);
      parent.setAttribute("data-spotlight-panel", "");
    }
    return place(parent.appendChild(document.createElement("button")), button);
  };
  const card = { top: 260, left: 400, width: 640, height: 200 };
  const padded = (box: typeof button) => ({
    top: box.top - 6,
    left: box.left - 6,
    width: box.width + 12,
    height: box.height + 12,
  });

  it("lights the largest panel around the control that leaves the page dimmed", () => {
    viewport(1440, 900);
    const page = { top: 100, left: 380, width: 690, height: 500 };
    expect(getSpotlightPanel(nest(page, card))).toEqual(padded(page));
  });

  it("gives way to the panels inside one that fills a phone or runs on for screens", () => {
    viewport(390, 844);
    const phoneCard = { top: 260, left: 20, width: 350, height: 300 };
    expect(
      getSpotlightPanel(
        nest({ top: 90, left: 9, width: 372, height: 1600 }, phoneCard),
      ),
    ).toEqual(padded(phoneCard));
    viewport(1440, 900);
    expect(
      getSpotlightPanel(nest({ top: 90, left: 380, width: 690, height: 1500 }, card)),
    ).toEqual(padded(card));
  });

  it("lights none where every panel is too large, or there is none", () => {
    viewport(390, 844);
    expect(
      getSpotlightPanel(nest({ top: 0, left: 0, width: 390, height: 840 })),
    ).toBeNull();
    expect(getSpotlightPanel(nest())).toBeNull();
  });
});

describe("pressing the highlight", () => {
  const box = { top: 100, left: 40, width: 300, height: 80 };
  const lit = (html: string) => {
    const row = place(document.body.appendChild(document.createElement("div")), box);
    row.innerHTML = html;
    document.elementsFromPoint = () => [row];
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
      new DOMRect(0, 0, 10, 10),
    ] as never);
    return row;
  };

  it("presses on when the step only shows the element", () => {
    const onPress = vi.fn();
    render(<Spotlight box={box} onPress={onPress} />);
    const hole = document.querySelector<HTMLElement>("[data-spotlight-press]");
    hole?.click();
    expect(onPress).toHaveBeenCalledTimes(1);
    // Next stays the one control a keyboard or screen reader finds.
    expect(hole?.getAttribute("aria-hidden")).toBe("true");
    expect(hole?.tabIndex).toBe(-1);
  });

  it.each([
    ["the only control in it", "<p>Streak</p><button>Claim</button>", 1],
    ["nothing among several", "<p>Pick</p><button>A</button><button>B</button>", 0],
    ["no disabled control", "<p>Streak</p><button disabled>Claim</button>", 0],
    ["no control beside a map", "<p>Map</p><canvas></canvas><button>Zoom</button>", 0],
  ])("presses %s", (_, html, presses) => {
    const row = lit(html);
    const onClick = vi.fn();
    for (const button of row.querySelectorAll("button"))
      button.addEventListener("click", onClick);
    render(<Spotlight box={box} />);
    row.querySelector("p")?.click();
    expect(onClick).toHaveBeenCalledTimes(presses);
    // The control's own press counts once.
    onClick.mockClear();
    row.querySelector<HTMLElement>("button:not(:disabled)")?.click();
    expect(onClick).toHaveBeenCalledTimes(row.querySelector("button:disabled") ? 0 : 1);
  });

  it("leaves the element to itself when the spotlight only marks it", () => {
    const row = lit("<p>Streak</p><button>Claim</button>");
    const onClick = vi.fn();
    row.querySelector("button")?.addEventListener("click", onClick);
    render(<Spotlight box={box} pointer={false} />);
    row.querySelector("p")?.click();
    expect(onClick).not.toHaveBeenCalled();
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
