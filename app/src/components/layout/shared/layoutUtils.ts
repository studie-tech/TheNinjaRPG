import type React from "react";

/**
 * Determines whether a click inside the right sidebar sheet should close it.
 *
 * The sidebar contains tabs, form controls, and other interactive widgets that
 * should keep the sheet open while the user interacts with them. Button and link
 * clicks are allowed to close the sheet because they usually represent a clear
 * navigation/action choice.
 */
export const shouldCloseRightSidebar = (target: HTMLElement) => {
  const isTabElement =
    target.closest('[role="tab"]') ||
    target.closest("[data-state]") ||
    target.closest("[data-radix-tabs-trigger]") ||
    target.closest("[data-radix-tabs-list]") ||
    target.closest("[data-radix-tabs-content]");

  const isOtherInteractive =
    target.closest("input") || target.closest("select") || target.closest("textarea");

  const hasPointerCursor =
    target.style.cursor === "pointer" ||
    target.closest('[style*="cursor: pointer"]') ||
    target.closest('[class*="cursor-pointer"]');

  const isInteractive = isTabElement || isOtherInteractive || hasPointerCursor;
  const isButtonOrLink =
    target.closest("button") !== null || target.closest("a") !== null;

  return !isInteractive || isButtonOrLink;
};

/**
 * Returns whether a nested element can consume the current vertical wheel delta.
 *
 * This lets `forwardVerticalWheelToDocumentScroll` preserve native scrolling for
 * real nested scroll areas, such as notification lists or panels, while still
 * forwarding wheel events from non-vertical layout containers to the document.
 */
const canScrollVertically = (element: HTMLElement, deltaY: number) => {
  const style = window.getComputedStyle(element);
  if (!["auto", "scroll", "overlay"].includes(style.overflowY)) return false;
  const maxScrollTop = element.scrollHeight - element.clientHeight;
  if (maxScrollTop <= 1) return false;
  return deltaY < 0 ? element.scrollTop > 0 : element.scrollTop < maxScrollTop - 1;
};

/**
 * Converts wheel deltas to pixels.
 *
 * Browsers may report wheel movement in pixels, lines, or pages. Normalizing the
 * value keeps manual document scrolling close to native browser behavior across
 * mice, trackpads, and embedded browser runtimes.
 */
const normalizeWheelDeltaY = (event: React.WheelEvent<HTMLElement>) => {
  switch (event.deltaMode) {
    case WheelEvent.DOM_DELTA_LINE:
      return event.deltaY * 16;
    case WheelEvent.DOM_DELTA_PAGE:
      return event.deltaY * window.innerHeight;
    default:
      return event.deltaY;
  }
};

/**
 * Forwards vertical wheel movement from horizontal layout containers to the page.
 *
 * The in-game content panes need horizontal overflow for wide tables and tools,
 * but those panes can trap vertical wheel events in the Codex embedded browser.
 * This handler keeps horizontal/zoom gestures untouched, allows genuinely
 * scrollable descendants to handle their own vertical scroll, and otherwise
 * applies the vertical delta to `document.scrollingElement`.
 */
export const forwardVerticalWheelToDocumentScroll: React.WheelEventHandler<
  HTMLElement
> = (event) => {
  if (typeof window === "undefined" || event.ctrlKey || event.shiftKey) return;
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;

  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  const deltaY = normalizeWheelDeltaY(event);
  let element: HTMLElement | null = target;
  while (element && element !== event.currentTarget) {
    if (canScrollVertically(element, deltaY)) return;
    element = element.parentElement;
  }

  const scrollingElement = document.scrollingElement;
  if (!scrollingElement) return;

  const maxScrollTop = scrollingElement.scrollHeight - scrollingElement.clientHeight;
  const nextScrollTop = Math.min(
    maxScrollTop,
    Math.max(0, scrollingElement.scrollTop + deltaY),
  );
  if (nextScrollTop === scrollingElement.scrollTop) return;

  event.preventDefault();
  scrollingElement.scrollTop = nextScrollTop;
};
