/**
 * The desktop sidebar columns are `hidden md:block`. Below md a phone cannot see them,
 * so layouts unmount their contents there to stop the widgets' timers and queries.
 * The server and the first client render keep them, so hydration output is unchanged.
 */
export const SIDEBAR_COLUMNS_HIDDEN_QUERY = "(max-width: 767.98px)";
/** Below-the-fold sidebar extras mount only once the columns are known to be visible. */
export const SIDEBAR_COLUMNS_SHOWN_QUERY = "(min-width: 768px)";

export const isClerkElement = (target: EventTarget | null) => {
  return (
    target instanceof HTMLElement &&
    (target.closest("[data-clerk-element]") ||
      target.closest("[class*='cl-userButton']") ||
      target.closest("[class*='cl-userPreview']") ||
      target.closest("[class*='cl-menuItem']") ||
      target.closest("[class*='cl-navbar']") ||
      target.closest("[data-localization-key]"))
  );
};

/** `onInteractOutside` guard: Clerk's popovers portal outside the sheet they open from. */
export const keepSheetOpenForClerk = (
  event: Pick<Event, "target" | "preventDefault">,
) => {
  if (isClerkElement(event.target)) event.preventDefault();
};

/**
 * Determines whether a click inside the right sidebar sheet should close it.
 *
 * The sidebar contains tabs, form controls, and other interactive widgets that
 * should keep the sheet open while the user interacts with them. Button and link
 * clicks are allowed to close the sheet unless they belong to a tab control.
 */
export const shouldCloseRightSidebar = (target: HTMLElement) => {
  const shouldKeepOpen =
    target.closest("[data-sidebar-keep-open]") || isClerkElement(target);
  const isTabElement =
    target.closest('[role="tab"]') ||
    target.closest("[data-radix-tabs-trigger]") ||
    target.closest("[data-radix-tabs-list]") ||
    target.closest("[data-radix-tabs-content]");

  const isOtherInteractive =
    target.closest("input") || target.closest("select") || target.closest("textarea");

  const hasPointerCursor =
    target.style.cursor === "pointer" ||
    target.closest('[style*="cursor: pointer"]') ||
    target.closest('[class*="cursor-pointer"]');

  const isInteractive =
    shouldKeepOpen || isTabElement || isOtherInteractive || hasPointerCursor;
  const isButtonOrLink =
    target.closest("button") !== null || target.closest("a") !== null;

  return !isInteractive || (isButtonOrLink && !isTabElement && !shouldKeepOpen);
};
