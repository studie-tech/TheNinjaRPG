"use client";

import { ChevronDown, Ellipsis, List, Menu } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DISMISS_HEADER_ACTIONS,
  HeaderActionsFocusContext,
} from "@/hooks/useHeaderActionsFocus";
import { cn } from "@/libs/shadui";

export const REVEAL_CONTENT_BOX_CONTROLS = "reveal-content-box-controls";

/**
 * Keep header controls inline when they fit and expose overflow in a disclosure.
 * The controls stay mounted in the same DOM tree: responsive changes and closing
 * the disclosure must not discard a dialog, form draft, or its focus target.
 */
export function ContentBoxHeaderActions({
  children,
  headerRef,
  titleRef,
  label,
  noRightAlign,
  collapsedLabel,
  iconOnly = false,
  collapsedIcon,
  align = "end",
}: ContentBoxHeaderActionsProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [placement, setPlacement] = useState({
    above: false,
    maxHeight: 0,
    maxWidth: 0,
    offset: 0,
  });
  const panelId = useId();
  const isDisclosure = !!collapsedLabel || isOverflowing;
  const controlsLabel = collapsedLabel ?? `${label} controls`;

  useEffect(() => {
    if (collapsedLabel) return;
    const header = headerRef.current;
    const content = contentRef.current;
    if (!header || !content) return;
    const measure = () => {
      const titleWidth = titleTextWidth(titleRef.current);
      const gap = titleWidth
        ? Number.parseFloat(getComputedStyle(header).columnGap) || 0
        : 0;
      // Measure the inline width even while the disclosure wraps its controls.
      const maxWidth = content.style.maxWidth;
      content.style.maxWidth = "none";
      const controlsWidth = content.scrollWidth;
      content.style.maxWidth = maxWidth;
      setIsOverflowing(titleWidth + controlsWidth + gap > header.clientWidth + 1);
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    observer.observe(content);
    if (titleRef.current) observer.observe(titleRef.current);
    return () => observer.disconnect();
  }, [children, headerRef, titleRef, label, collapsedLabel]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const reveal = () => setIsOpen(true);
    const dismiss = () => {
      setIsOpen(false);
      triggerRef.current?.focus();
    };
    root.addEventListener(REVEAL_CONTENT_BOX_CONTROLS, reveal);
    root.addEventListener(DISMISS_HEADER_ACTIONS, dismiss);
    return () => {
      root.removeEventListener(REVEAL_CONTENT_BOX_CONTROLS, reveal);
      root.removeEventListener(DISMISS_HEADER_ACTIONS, dismiss);
    };
  }, []);

  useEffect(() => {
    if (!isDisclosure || !isOpen) return;
    const root = rootRef.current;
    if (!root) return;

    const place = () => {
      const rect = root.getBoundingClientRect();
      const viewportTop = window.visualViewport?.offsetTop ?? 0;
      const viewportBottom =
        viewportTop + (window.visualViewport?.height ?? window.innerHeight);
      const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
      const bottomNavInset =
        Number.parseFloat(
          document.documentElement.style.getPropertyValue("--game-bottom-nav-h"),
        ) || 0;
      // Leave a viewport margin and the menu's 4px gap, clearing any raised mobile nav.
      const above = rect.top - viewportTop - 20;
      const usableBottom = Math.min(
        viewportBottom,
        window.innerHeight - bottomNavInset,
      );
      const below = usableBottom - rect.bottom - 20;
      const wanted = (contentRef.current?.scrollHeight ?? 0) + 26;
      const opensAbove = below < wanted && above > below;
      const maxHeight = Math.max(44, opensAbove ? above : below);
      // Persistent controls can follow a named menu; use the header edge so they
      // do not squeeze its options into the space left of its trigger.
      const menuRight = collapsedLabel
        ? (headerRef.current?.getBoundingClientRect().right ?? rect.right)
        : rect.right;
      const menuLeft = Math.max(
        16,
        headerRef.current?.getBoundingClientRect().left ?? rect.left,
      );
      const offset = align === "start" ? menuLeft - rect.left : rect.right - menuRight;
      const availableWidth =
        align === "start" ? viewportWidth - menuLeft - 16 : menuRight - 16;
      const maxWidth = Math.max(44, Math.min(viewportWidth - 32, availableWidth));
      setPlacement((previous) =>
        previous.above === opensAbove &&
        previous.maxHeight === maxHeight &&
        previous.maxWidth === maxWidth &&
        previous.offset === offset
          ? previous
          : { above: opensAbove, maxHeight, maxWidth, offset },
      );
    };
    place();

    const dismissOutside = (event: Event) => {
      if (
        event.target instanceof Node &&
        !root.contains(event.target) &&
        !hasPortalledControlLayer(root)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("focusin", dismissOutside);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    if (contentRef.current) observer?.observe(contentRef.current);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("focusin", dismissOutside);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
      observer?.disconnect();
    };
  }, [isDisclosure, isOpen, collapsedLabel, headerRef, align]);

  return (
    <div
      ref={rootRef}
      className={cn(
        "relative min-w-0",
        !isDisclosure && noRightAlign ? "grow" : "ml-auto shrink-0",
      )}
      onKeyDownCapture={(event) => {
        if (
          !isDisclosure ||
          !isOpen ||
          event.key !== "Escape" ||
          hasPortalledControlLayer(event.currentTarget)
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        setIsOpen(false);
        triggerRef.current?.focus();
      }}
      data-content-box-actions
      data-overflow={isDisclosure || undefined}
      data-expanded={(isDisclosure && isOpen) || undefined}
    >
      <Button
        ref={triggerRef}
        size={collapsedLabel && !iconOnly ? "default" : "icon"}
        variant={iconOnly ? "ghost" : collapsedLabel ? "outline" : "default"}
        className={cn(
          !isDisclosure && "hidden",
          collapsedLabel && "min-h-[44px] gap-2",
          iconOnly && "size-[44px]",
        )}
        hidden={!isDisclosure}
        aria-hidden={!isDisclosure || undefined}
        aria-label={controlsLabel}
        aria-controls={panelId}
        aria-expanded={isDisclosure && isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        {iconOnly ? (
          (collapsedIcon ?? <Menu className="size-6" aria-hidden />)
        ) : (
          <List className="h-5 w-5" aria-hidden />
        )}
        {collapsedLabel && !iconOnly && (
          <>
            {collapsedLabel}
            <ChevronDown className="size-4" aria-hidden />
          </>
        )}
      </Button>
      <section
        id={panelId}
        aria-label={isDisclosure ? controlsLabel : undefined}
        aria-hidden={isDisclosure && !isOpen ? true : undefined}
        inert={isDisclosure && !isOpen}
        style={
          isDisclosure && isOpen && placement.maxHeight
            ? {
                maxHeight: placement.maxHeight,
                maxWidth: placement.maxWidth,
                left: align === "start" ? placement.offset : undefined,
                right: align === "end" ? placement.offset : undefined,
              }
            : undefined
        }
        className={cn(
          isDisclosure &&
            "bg-popover text-popover-foreground absolute top-full z-[45] mt-1 max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] overflow-auto rounded-md border p-3 shadow-md",
          isDisclosure && (align === "start" ? "left-0" : "right-0"),
          collapsedLabel && "w-96",
          isDisclosure && placement.above && "top-auto bottom-full mb-1",
          isDisclosure &&
            !isOpen &&
            "pointer-events-none invisible h-0 overflow-hidden border-0 py-0",
        )}
      >
        <div
          ref={contentRef}
          style={
            isDisclosure
              ? {
                  maxWidth: placement.maxWidth
                    ? Math.max(44, placement.maxWidth - 26)
                    : "calc(100vw - 4rem)",
                }
              : undefined
          }
          className={cn(
            collapsedLabel ? "w-full" : "w-max",
            noRightAlign && !isDisclosure && "min-w-full",
            isDisclosure && "[&>div]:flex-wrap [&>div]:gap-y-2",
          )}
          data-content-box-controls
        >
          <HeaderActionsFocusContext value={isDisclosure ? triggerRef : null}>
            {children}
          </HeaderActionsFocusContext>
        </div>
      </section>
    </div>
  );
}

/**
 * Keep as many header controls in the row as fit, in their display order, and show the rest in
 * a "More" menu. Controls leave the row by priority (lower stays longer), so the ones a player
 * needs at a moment's notice stay one tap away on narrow screens. Every control keeps one parent
 * element whether it sits in the row or in the menu: the menu is drawn around the controls it
 * holds, so moving between the two never remounts a control or discards its state.
 */
export function ContentBoxPriorityActions({
  items,
  label,
}: {
  items: HeaderActionItem[];
  label: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const focusedItemRef = useRef<HTMLElement | null>(null);
  const [menu, setMenu] = useState<HeaderMenuLayout>(EMPTY_MENU);
  const [isOpen, setIsOpen] = useState(false);
  const baseId = useId();
  const keys = items
    .map((item) => `${item.key}:${item.priority}:${item.node ? 1 : 0}`)
    .join(",");
  const menuId = `${baseId}-menu`;
  const itemId = (key: string) => `${baseId}-${key}`;

  // `keys` stands for the items: their nodes are new on every render, their keys change with
  // the set of controls and with whether each renders, so a control that appears is placed
  // before it paints. Each control's wrapper is observed, so one that changes width or renders
  // nothing from inside its node is measured again.
  useLayoutEffect(() => {
    const root = rootRef.current;
    // The header row holds the title block, then these controls.
    const header = root?.parentElement;
    if (!root || !header) return;
    const title = root.previousElementSibling as HTMLElement | null;
    const measure = () => {
      // The controls get the header beside the title's text: a longer subtitle truncates
      // rather than moving controls behind More.
      const titleWidth = titleTextWidth(title);
      const headerStyle = getComputedStyle(header);
      const padding =
        (Number.parseFloat(headerStyle.paddingLeft) || 0) +
        (Number.parseFloat(headerStyle.paddingRight) || 0);
      const gap = titleWidth ? Number.parseFloat(headerStyle.columnGap) || 0 : 0;
      const widths = new Map<string, number>();
      for (const element of root.querySelectorAll<HTMLElement>("[data-header-item]")) {
        // A control that renders nothing measures 0 and takes no room.
        widths.set(
          element.dataset.headerItem ?? "",
          element.getBoundingClientRect().width,
        );
      }
      const widthOf = (key: string) => widths.get(key) ?? HEADER_TOOL_WIDTH;
      const hidden = splitHeaderActions(
        items,
        widthOf,
        header.clientWidth - padding - titleWidth - gap,
        HEADER_TOOL_WIDTH,
      );
      const next = layoutHeaderMenu(
        items.filter((item) => hidden.has(item.key)).map((item) => item.key),
        widthOf,
        Math.max(HEADER_TOOL_WIDTH, window.innerWidth - 32),
      );
      // Moving a keyed wrapper can blur its control before layout effects run.
      focusedItemRef.current =
        document.activeElement?.closest<HTMLElement>("[data-header-item]") ?? null;
      setMenu((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    if (title) observer.observe(title);
    for (const element of root.querySelectorAll("[data-header-item]")) {
      observer.observe(element);
    }
    return () => observer.disconnect();
  }, [keys]);

  const isMenuShown = Object.keys(menu.places).length > 0;
  const isExpanded = isMenuShown && isOpen;
  const previousPlacesRef = useRef(menu.places);

  // A focused control that moves behind the closed menu turns inert and would drop keyboard
  // focus, so focus moves to More before the browser repaints.
  useLayoutEffect(() => {
    const previousPlaces = previousPlacesRef.current;
    previousPlacesRef.current = menu.places;
    const focused = focusedItemRef.current;
    focusedItemRef.current = null;
    if (isExpanded) return;
    const key = focused?.dataset.headerItem;
    if (
      key &&
      rootRef.current?.contains(focused) &&
      menu.places[key] &&
      !previousPlaces[key]
    ) {
      triggerRef.current?.focus();
    }
  }, [menu, isExpanded]);

  // A menu that empties (the screen grew) closes, so it does not reopen by itself later.
  useEffect(() => {
    if (!isMenuShown) setIsOpen(false);
  }, [isMenuShown]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reveal = () => setIsOpen(true);
    const dismiss = () => {
      setIsOpen(false);
      triggerRef.current?.focus();
    };
    root.addEventListener(REVEAL_CONTENT_BOX_CONTROLS, reveal);
    root.addEventListener(DISMISS_HEADER_ACTIONS, dismiss);
    return () => {
      root.removeEventListener(REVEAL_CONTENT_BOX_CONTROLS, reveal);
      root.removeEventListener(DISMISS_HEADER_ACTIONS, dismiss);
    };
  }, []);

  useEffect(() => {
    if (!isExpanded) return;
    const root = rootRef.current;
    if (!root) return;
    const dismissOutside = (event: Event) => {
      if (
        event.target instanceof Node &&
        !root.contains(event.target) &&
        !hasPortalledControlLayer(root)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("focusin", dismissOutside);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("focusin", dismissOutside);
    };
  }, [isExpanded]);

  const needsAttention = items.some((item) => menu.places[item.key] && item.attention);
  const renderItem = (item: HeaderActionItem) => {
    const place = menu.places[item.key];
    const isFolded = !!place && !isExpanded;
    return (
      <div
        key={item.key}
        id={itemId(item.key)}
        data-header-item={item.key}
        aria-hidden={isFolded || undefined}
        inert={isFolded}
        className={cn(
          "flex shrink-0 items-center",
          // A control keeps its own width in the menu rather than wrapping to fit it.
          place && "absolute z-[46] w-max",
          isFolded && "pointer-events-none invisible",
        )}
        style={
          place
            ? { top: `calc(100% + 4px + ${place.top}px)`, right: place.right }
            : undefined
        }
      >
        <HeaderActionsFocusContext value={place ? triggerRef : null}>
          {item.node}
        </HeaderActionsFocusContext>
      </div>
    );
  };
  return (
    <div
      ref={rootRef}
      className="relative ml-auto flex shrink-0 flex-row items-center justify-end"
      onKeyDownCapture={(event) => {
        if (
          !isExpanded ||
          event.key !== "Escape" ||
          hasPortalledControlLayer(event.currentTarget)
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        setIsOpen(false);
        triggerRef.current?.focus();
      }}
      data-content-box-actions
      data-expanded={isExpanded || undefined}
    >
      {isMenuShown && (
        <section
          id={menuId}
          aria-label={`More ${label} controls`}
          aria-owns={Object.keys(menu.places).map(itemId).join(" ")}
          className={cn(
            "bg-popover absolute top-full right-0 z-[45] mt-1 rounded-md border shadow-md",
            !isExpanded && "invisible",
          )}
          style={{ width: menu.width, height: menu.height }}
        ></section>
      )}
      {/* A single keyed list preserves controls as they move into More. */}
      {[
        ...items.filter((item) => !menu.places[item.key]).map(renderItem),
        <Button
          key={MORE_TRIGGER_KEY}
          ref={triggerRef}
          variant="ghost"
          className={cn("relative size-[44px] shrink-0 p-0", !isMenuShown && "hidden")}
          hidden={!isMenuShown}
          aria-label={`More ${label} controls${needsAttention ? ", includes a changed setting" : ""}`}
          aria-controls={isMenuShown ? menuId : undefined}
          aria-expanded={isExpanded}
          onClick={() => setIsOpen((open) => !open)}
        >
          <Ellipsis className="size-7" aria-hidden />
          {needsAttention && (
            <span
              aria-hidden
              data-attention
              className="ring-background absolute top-2 right-2 size-2.5 rounded-full bg-orange-500 ring-2"
            />
          )}
        </Button>,
        ...items.filter((item) => menu.places[item.key]).map(renderItem),
      ]}
    </div>
  );
}

const MORE_TRIGGER_KEY = "content-box-more-trigger";

/** The width of a content box title's text and back icon, independent of its subtitle. */
const titleTextWidth = (title: HTMLElement | null) => {
  if (title?.classList.contains("sr-only")) return 0;
  const heading = title?.querySelector("h1,h2");
  const text = heading?.querySelector<HTMLElement>("[data-content-box-title-text]");
  if (!text) return 0;
  const range = document.createRange();
  range.selectNodeContents(text);
  return (
    (range.getBoundingClientRect?.().width ?? text.scrollWidth) +
    (heading?.querySelector("svg")?.getBoundingClientRect().width ?? 0)
  );
};

/**
 * Places the menu's controls in rows, in display order, no wider than `maxWidth`. Offsets are
 * measured from the menu's top and right edges, which sit under the root's right edge.
 */
export const layoutHeaderMenu = (
  keys: string[],
  widthOf: (key: string) => number,
  maxWidth: number,
): HeaderMenuLayout => {
  if (keys.length === 0) return EMPTY_MENU;
  const rows: { key: string; left: number; width: number }[][] = [[]];
  let x = 0;
  for (const key of keys) {
    const width = widthOf(key);
    const row = rows[rows.length - 1] ?? [];
    if (row.length > 0 && x + width > maxWidth - 2 * MENU_PADDING) {
      rows.push([{ key, left: 0, width }]);
      x = width;
    } else {
      row.push({ key, left: x, width });
      x += width;
    }
  }
  const contentWidth = Math.max(
    ...rows.map((row) => row.reduce((sum, entry) => sum + entry.width, 0)),
  );
  const width = contentWidth + 2 * MENU_PADDING;
  const places: HeaderMenuLayout["places"] = {};
  rows.forEach((row, index) => {
    for (const entry of row) {
      places[entry.key] = {
        top: MENU_PADDING + index * HEADER_TOOL_WIDTH,
        right: width - MENU_PADDING - entry.left - entry.width,
      };
    }
  });
  return { places, width, height: rows.length * HEADER_TOOL_WIDTH + 2 * MENU_PADDING };
};

/**
 * The controls that leave the header row: none when all fit; otherwise, with room kept for
 * the "More" trigger, controls are kept by priority while they fit.
 */
export const splitHeaderActions = (
  items: Pick<HeaderActionItem, "key" | "priority">[],
  widthOf: (key: string) => number,
  available: number,
  triggerWidth: number,
) => {
  const total = items.reduce((sum, item) => sum + widthOf(item.key), 0);
  if (total <= available) return new Set<string>();
  let used = triggerWidth;
  const kept = new Set<string>();
  for (const item of [...items].sort((a, b) => a.priority - b.priority)) {
    const width = widthOf(item.key);
    if (used + width <= available) {
      kept.add(item.key);
      used += width;
    }
  }
  return new Set(items.filter((item) => !kept.has(item.key)).map((item) => item.key));
};

/** Width of one header tool button and of the "More" trigger, and the height of a menu row. */
const HEADER_TOOL_WIDTH = 44;

/** Space between the "More" menu's edge and its controls. */
const MENU_PADDING = 8;

const EMPTY_MENU: HeaderMenuLayout = { places: {}, width: 0, height: 0 };

/** Portalled dialogs and selects own dismissal while their header trigger stays visible. */
function hasPortalledControlLayer(root: HTMLElement) {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      '[role="dialog"],[role="listbox"],[role="menu"]',
    ),
  ).some(
    (layer) =>
      !root.contains(layer) &&
      !layer.contains(root) &&
      layer.getClientRects().length > 0 &&
      layer.getAttribute("aria-hidden") !== "true",
  );
}

type ContentBoxHeaderActionsProps = {
  children: ReactNode;
  headerRef: RefObject<HTMLDivElement | null>;
  titleRef: RefObject<HTMLDivElement | null>;
  label: string;
  noRightAlign?: boolean;
  collapsedLabel?: string;
  iconOnly?: boolean;
  collapsedIcon?: ReactNode;
  align?: "start" | "end";
};

/** One header control for `ContentBoxPriorityActions`. */
export type HeaderActionItem = {
  key: string;
  node: ReactNode;
  /** Lower stays in the row longer. */
  priority: number;
  /** Marks the "More" trigger while this control is hidden in it. */
  attention?: boolean;
};

/** Where each control in the "More" menu sits, and the menu's size. */
export type HeaderMenuLayout = {
  places: Record<string, { top: number; right: number }>;
  width: number;
  height: number;
};
