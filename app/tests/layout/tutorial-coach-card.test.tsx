import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { CoachCard } from "@/layout/tutorial/CoachCard";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";

const originalInnerHeight = window.innerHeight;

beforeEach(() => {
  installBrowserGlobals();
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
});

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: originalInnerHeight,
  });
  restoreBrowserGlobals();
});

/** Give an element a fixed viewport box. */
const place = (
  element: Element,
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
};

/**
 * A lesson in a dock of this box whose lead is `leadHeight` px tall, with the page's
 * highlight (what the spotlight keeps in view) at `highlight`.
 */
const lesson = ({
  dock,
  leadHeight = 160,
  highlight,
}: {
  dock: { top: number; left: number; width: number; height: number };
  leadHeight?: number;
  highlight?: { top: number; left: number; width: number; height: number };
}) => {
  if (highlight) {
    const hole = document.body.appendChild(document.createElement("div"));
    hole.setAttribute("data-spotlight-keep", "");
    place(hole, highlight);
  }
  const view = render(
    <aside data-activity-dock>
      <CoachCard
        title="Report for duty"
        foldKey="report"
        action="Walk to the marker: tap it on the map."
        lead={<p data-testid="lead">Welcome home. Every new Genin reports…</p>}
      />
    </aside>,
  );
  const aside = view.container.querySelector("[data-activity-dock]")!;
  place(aside, dock);
  const lead = view.getByTestId("lead").parentElement!;
  Object.defineProperty(lead, "scrollHeight", {
    configurable: true,
    value: leadHeight,
  });
  const page = document.body.appendChild(document.createElement("main"));
  return {
    view,
    tapPage: () => fireEvent.pointerDown(page),
    isFolded: () => !!view.container.querySelector("[data-lead-folded]"),
  };
};

/** A desktop dock: beside the page, a third of the screen tall. */
const desktopDock = { top: 600, left: 16, width: 334, height: 280 };

describe("coach card folding", () => {
  it("keeps the whole lesson open when the dock leaves the page and its highlight in view", () => {
    const { tapPage, isFolded } = lesson({
      dock: desktopDock,
      highlight: { top: 480, left: 480, width: 60, height: 70 },
    });
    tapPage();
    expect(isFolded()).toBe(false);
  });

  it("folds when the open lesson covers the highlighted control, until Show all", () => {
    const { view, tapPage, isFolded } = lesson({
      dock: desktopDock,
      highlight: { top: 640, left: 120, width: 60, height: 40 },
    });
    // A tap inside the dock is reading the lesson.
    fireEvent.pointerDown(view.getByText("Report for duty"));
    expect(isFolded()).toBe(false);
    tapPage();
    expect(isFolded()).toBe(true);
    fireEvent.click(view.getByRole("button", { name: "Show all" }));
    expect(isFolded()).toBe(false);
  });

  it("folds when the open lesson takes more than half the screen", () => {
    const { tapPage, isFolded } = lesson({
      dock: { top: 300, left: 16, width: 343, height: 480 },
    });
    tapPage();
    expect(isFolded()).toBe(true);
  });

  it("keeps a lead that already fits its two folded lines open", () => {
    const { tapPage, isFolded } = lesson({
      dock: { top: 300, left: 16, width: 343, height: 480 },
      leadHeight: 30,
    });
    tapPage();
    expect(isFolded()).toBe(false);
  });
});

it("opens folded where the whole lesson would cover its target, until asked to show all", () => {
  const view = render(
    <CoachCard
      title="Choose your strengths"
      action="Tap Mind, Body, Resolve or Tactics."
      lead={<p>Each specialization raises two stats.</p>}
      foldKey="strengths"
      startFolded
    />,
  );
  const folded = () => view.container.querySelector("[data-lead-folded]");
  expect(folded()).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Show all" }));
  expect(folded()).toBeNull();
  // The next lesson folds by itself again.
  view.rerender(
    <CoachCard
      title="Grow stronger"
      action="Pick a specialization."
      lead={<p>This time the choice is yours.</p>}
      foldKey="stronger"
      startFolded
    />,
  );
  expect(folded()).toBeTruthy();
});
