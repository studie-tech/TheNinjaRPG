import { afterEach, beforeEach, expect, it, mock } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LONG_PRESS_MS, ReactionPill } from "@/layout/ReactionPill";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";

// Radix dispatches jsdom CustomEvents when the popover opens.
beforeEach(() => installBrowserGlobals({ events: ["CustomEvent"] }));
afterEach(() => {
  cleanup();
  restoreBrowserGlobals();
});

const names = ["Ana", "Ben", "Cy", "Dee", "Eli", "Fay"];

const renderPill = (onToggle?: () => void) =>
  render(
    <TooltipProvider>
      <ReactionPill emoji="👍" usernames={names} isMine={false} onToggle={onToggle} />
    </TooltipProvider>,
  );

const wait = (ms: number) =>
  act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

it("names the first three who reacted and counts the rest", () => {
  const view = renderPill();
  expect(
    view.getByRole("button", { name: "👍 6, reacted by Ana, Ben, Cy and 3 others" }),
  ).toBeDefined();
});

it("toggles on a tap", () => {
  const onToggle = mock(() => {});
  const view = renderPill(onToggle);
  const pill = view.getByRole("button");
  fireEvent.pointerDown(pill, { pointerType: "touch" });
  fireEvent.pointerUp(pill, { pointerType: "touch" });
  fireEvent.click(pill);
  expect(onToggle).toHaveBeenCalledTimes(1);
  expect(view.queryByText("6 reacted with 👍")).toBeNull();
});

it("lists everyone on a touch long-press without toggling", async () => {
  const onToggle = mock(() => {});
  const view = renderPill(onToggle);
  const pill = view.getByRole("button");
  fireEvent.pointerDown(pill, { pointerType: "touch" });
  await wait(LONG_PRESS_MS + 50);
  fireEvent.pointerUp(pill, { pointerType: "touch" });
  fireEvent.click(pill);
  expect(view.getByText("6 reacted with 👍")).toBeDefined();
  for (const name of names) expect(view.getByText(name)).toBeDefined();
  expect(onToggle).not.toHaveBeenCalled();
});

it("cancels the long-press when the finger scrolls away", async () => {
  const view = renderPill(() => {});
  const pill = view.getByRole("button");
  fireEvent.pointerDown(pill, { pointerType: "touch", clientX: 0, clientY: 0 });
  fireEvent.pointerMove(pill, { pointerType: "touch", clientX: 0, clientY: 40 });
  await wait(LONG_PRESS_MS + 50);
  expect(view.queryByText("6 reacted with 👍")).toBeNull();
});

it("suppresses the touch context menu on the pill", () => {
  const view = renderPill(() => {});
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  view.getByRole("button").dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
});

it("closes the names and toggles on the next tap", async () => {
  const onToggle = mock(() => {});
  const view = renderPill(onToggle);
  const pill = view.getByRole("button");
  fireEvent.pointerDown(pill, { pointerType: "touch" });
  await wait(LONG_PRESS_MS + 50);
  fireEvent.pointerUp(pill, { pointerType: "touch" });
  fireEvent.click(pill);
  fireEvent.click(pill);
  expect(onToggle).toHaveBeenCalledTimes(1);
  await wait(0);
  expect(view.queryByText("6 reacted with 👍")).toBeNull();
});
