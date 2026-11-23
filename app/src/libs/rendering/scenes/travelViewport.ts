/**
 * Height that lets a travel map, and any loadout row under it, reach down to the first
 * thing covering the foot of the screen: the fixed activity dock when it overlaps the
 * map's column, otherwise the phone navigation bar or the window's edge. Measured against the page's own position rather than the scroll, so
 * scrolling never resizes the map; never below `minimum`.
 */
export const travelViewportHeight = (
  mount: HTMLElement,
  minimum: number,
  { hasRowBelow = false } = {},
) => {
  if (typeof window === "undefined") return minimum;
  const rect = mount.getBoundingClientRect();
  const pageTop = rect.top + window.scrollY;
  const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  const isPhone = !window.matchMedia(WIDE_LAYOUT_QUERY).matches;
  const dock = document
    .querySelector<HTMLElement>(ACTIVITY_DOCK_SELECTOR)
    ?.getBoundingClientRect();
  const dockTop =
    dock &&
    dock.height > 0 &&
    dock.left < rect.right &&
    dock.right > rect.left &&
    dock.top > pageTop + minimum
      ? dock.top
      : null;
  return fillHeight({
    pageTop,
    viewportHeight: window.innerHeight,
    dockTop,
    rem: Number.isFinite(rem) ? rem : 12,
    isPhone,
    minimum,
    hasRowBelow,
  });
};

/** The arithmetic of travelViewportHeight, in CSS pixels. */
export const fillHeight = ({
  pageTop,
  viewportHeight,
  dockTop,
  rem,
  isPhone,
  minimum,
  hasRowBelow,
}: {
  pageTop: number;
  viewportHeight: number;
  dockTop: number | null;
  rem: number;
  isPhone: boolean;
  minimum: number;
  /** Whether the loadout row under the sector map should stay in view too. */
  hasRowBelow: boolean;
}) => {
  const layoutBottom = viewportHeight - (isPhone ? PHONE_NAV_REM : WIDE_EDGE_REM) * rem;
  const bottom =
    Math.min(layoutBottom, dockTop ?? layoutBottom) -
    (hasRowBelow ? LOADOUT_ROW_REM : GAP_REM) * rem;
  // A phone opens with the map in its first screen. Wider layouts open under a tall
  // banner and are scrolled to the map, its title row kept, so they fill that view.
  const top = isPhone ? pageTop : Math.min(pageTop, WIDE_TITLE_REM * rem);
  return Math.max(minimum, Math.floor(bottom - top));
};

/**
 * Re-measure when the window resizes, the dock changes size, or the lesson dock changes
 * the space it reserves on the root element (`--activity-dock-space`). Returns the cleanup.
 */
export const watchTravelViewport = (refit: () => void) => {
  if (
    typeof window === "undefined" ||
    typeof ResizeObserver === "undefined" ||
    typeof MutationObserver === "undefined"
  )
    return () => {};
  let dock: Element | null = null;
  const dockObserver = new ResizeObserver(refit);
  const followDock = () => {
    const next = document.querySelector(ACTIVITY_DOCK_SELECTOR);
    if (next === dock) return;
    if (dock) dockObserver.unobserve(dock);
    if (next) dockObserver.observe(next);
    dock = next;
  };
  followDock();
  const rootObserver = new MutationObserver(() => {
    followDock();
    refit();
  });
  rootObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["style"],
  });
  window.addEventListener("resize", refit);
  return () => {
    window.removeEventListener("resize", refit);
    rootObserver.disconnect();
    dockObserver.disconnect();
  };
};

const ACTIVITY_DOCK_SELECTOR = "[data-activity-dock]";
/** Tailwind's `md`: media queries resolve rem against 16px, so this is 768px. */
const WIDE_LAYOUT_QUERY = "(min-width: 48rem)";
/** The phone layouts' bottom padding (`pb-[calc(7rem+…)]`) clears the fixed navigation bar. */
const PHONE_NAV_REM = 7;
/** Breathing room at the foot of the window on wider layouts. */
const WIDE_EDGE_REM = 1;
/** The loadout and fullscreen row under the sector map, with its gap. */
const LOADOUT_ROW_REM = 4.5;
/** Space between the map and whatever covers the foot of the screen. */
const GAP_REM = 1;
/** The travel box's title row and the frame above it, kept in view over the map. */
const WIDE_TITLE_REM = 8;
