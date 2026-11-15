"use client";

import { Ellipsis, List } from "lucide-react";
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
  });
  const panelId = useId();

  useEffect(() => {
    const header = headerRef.current;
    const content = contentRef.current;
    if (!header || !content) return;
    const measure = () => {
      const heading = titleRef.current?.querySelector("h1,h2");
      const text = heading?.querySelector<HTMLElement>("[data-content-box-title-text]");
      const range = document.createRange();
      if (text) range.selectNodeContents(text);
      // Measure the title's text, independent of the subtitle and its block width.
      const titleWidth = text
        ? (range.getBoundingClientRect?.().width ?? text.scrollWidth) +
          (heading?.querySelector("svg")?.getBoundingClientRect().width ?? 0)
        : 0;
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
  }, [children, headerRef, titleRef, label]);

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
    if (!isOverflowing || !isOpen) return;
    const root = rootRef.current;
    if (!root) return;

    const place = () => {
      const rect = root.getBoundingClientRect();
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
      const above = rect.top - 16;
      // Keep controls clear of the fixed mobile navigation and Activity dock.
      const below = viewportHeight - rect.bottom - 80;
      const wanted = Math.min(
        (contentRef.current?.scrollHeight ?? 0) + 24,
        viewportHeight * 0.6,
      );
      const opensAbove = below < wanted && above > below;
      const maxHeight = Math.max(
        44,
        Math.min(viewportHeight * 0.6, opensAbove ? above : below),
      );
      const maxWidth = Math.max(44, Math.min(viewportWidth - 32, rect.right - 16));
      setPlacement((previous) =>
        previous.above === opensAbove &&
        previous.maxHeight === maxHeight &&
        previous.maxWidth === maxWidth
          ? previous
          : { above: opensAbove, maxHeight, maxWidth },
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
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("focusin", dismissOutside);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [isOverflowing, isOpen]);

  return (
    <div
      ref={rootRef}
      className={cn(
        "relative min-w-0",
        !isOverflowing && noRightAlign ? "grow" : "ml-auto shrink-0",
      )}
      onKeyDownCapture={(event) => {
        if (
          !isOverflowing ||
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
      data-overflow={isOverflowing || undefined}
      data-expanded={(isOverflowing && isOpen) || undefined}
    >
      <Button
        ref={triggerRef}
        size="icon"
        className={cn(!isOverflowing && "hidden")}
        hidden={!isOverflowing}
        aria-hidden={!isOverflowing || undefined}
        aria-label={`${label} controls`}
        aria-controls={panelId}
        aria-expanded={isOverflowing && isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        <List className="h-5 w-5" aria-hidden />
      </Button>
      <section
        id={panelId}
        aria-label={isOverflowing ? `${label} controls` : undefined}
        aria-hidden={isOverflowing && !isOpen ? true : undefined}
        inert={isOverflowing && !isOpen}
        style={
          isOverflowing && isOpen && placement.maxHeight
            ? { maxHeight: placement.maxHeight, maxWidth: placement.maxWidth }
            : undefined
        }
        className={cn(
          isOverflowing &&
            "bg-popover text-popover-foreground absolute top-full right-0 z-[45] mt-1 max-h-[60dvh] max-w-[calc(100vw-2rem)] overflow-auto rounded-md border p-3 shadow-md",
          isOverflowing && placement.above && "top-auto bottom-full mb-1",
          isOverflowing &&
            !isOpen &&
            "pointer-events-none invisible h-0 overflow-hidden border-0 py-0",
        )}
      >
        <div
          ref={contentRef}
          style={
            isOverflowing
              ? {
                  maxWidth: placement.maxWidth
                    ? Math.max(44, placement.maxWidth - 26)
                    : "calc(100vw - 4rem)",
                }
              : undefined
          }
          className={cn(
            "w-max",
            noRightAlign && !isOverflowing && "min-w-full",
            isOverflowing && "[&>div]:flex-wrap [&>div]:gap-y-2",
          )}
          data-content-box-controls
        >
          <HeaderActionsFocusContext value={isOverflowing ? triggerRef : null}>
            {children}
          </HeaderActionsFocusContext>
        </div>
      </section>
    </div>
  );
}

/**
 * Keep as many header controls in the row as fit, in their display order, and move the rest
 * behind a "More" menu. Controls leave the row by priority (lower stays longer), so the ones a
 * player needs at a moment's notice stay one tap away on narrow screens. Controls change place
 * only when the available width or the set of controls changes.
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
  const widths = useRef(new Map<string, number>());
  const [hiddenKeys, setHiddenKeys] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const panelId = useId();
  const keys = items.map((item) => `${item.key}:${item.priority}`).join(",");

  // `keys` stands for the items: their nodes are new on every render, their keys only when
  // the set of controls changes.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () => {
      for (const element of root.querySelectorAll<HTMLElement>("[data-header-item]")) {
        // A control that renders nothing measures 0 and takes no room.
        widths.current.set(
          element.dataset.headerItem ?? "",
          element.getBoundingClientRect().width,
        );
      }
      const hidden = splitHeaderActions(
        items,
        (key) => widths.current.get(key) ?? HEADER_TOOL_WIDTH,
        root.clientWidth,
        HEADER_TOOL_WIDTH,
      );
      setHiddenKeys([...hidden].join(","));
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    for (const element of root.querySelectorAll("[data-header-item]")) {
      observer.observe(element);
    }
    return () => observer.disconnect();
  }, [keys]);

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
    if (!isOpen) return;
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
  }, [isOpen]);

  const hidden = new Set(hiddenKeys ? hiddenKeys.split(",") : []);
  const isMenuShown = hidden.size > 0;
  const needsAttention = items.some((item) => hidden.has(item.key) && item.attention);
  return (
    <div
      ref={rootRef}
      className="relative ml-auto flex min-w-0 flex-1 flex-row items-center justify-end"
      onKeyDownCapture={(event) => {
        if (
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
      data-expanded={(isMenuShown && isOpen) || undefined}
    >
      {items
        .filter((item) => !hidden.has(item.key))
        .map((item) => (
          <div
            key={item.key}
            data-header-item={item.key}
            className="flex shrink-0 items-center"
          >
            {item.node}
          </div>
        ))}
      <Button
        ref={triggerRef}
        variant="ghost"
        className={cn("relative size-[44px] shrink-0 p-0", !isMenuShown && "hidden")}
        hidden={!isMenuShown}
        aria-label={`More ${label} controls${needsAttention ? " (one is changed)" : ""}`}
        aria-controls={panelId}
        aria-expanded={isMenuShown && isOpen}
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
      </Button>
      <section
        id={panelId}
        aria-label={`More ${label} controls`}
        aria-hidden={!isOpen || undefined}
        inert={!isOpen}
        className={cn(
          "bg-popover text-popover-foreground absolute top-full right-0 z-[45] mt-1 flex max-w-[calc(100vw-2rem)] flex-row flex-wrap items-center rounded-md border p-2 shadow-md",
          (!isOpen || !isMenuShown) && "pointer-events-none invisible",
        )}
      >
        <HeaderActionsFocusContext value={triggerRef}>
          {items
            .filter((item) => hidden.has(item.key))
            .map((item) => (
              <div
                key={item.key}
                data-header-item={item.key}
                className="flex shrink-0 items-center"
              >
                {item.node}
              </div>
            ))}
        </HeaderActionsFocusContext>
      </section>
    </div>
  );
}

/**
 * The controls that leave the header row: none when all fit; otherwise, with room kept for
 * the "More" trigger, controls are kept by priority (lower first) while they fit.
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

/** Width of one header tool button and of the "More" trigger. */
const HEADER_TOOL_WIDTH = 44;

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
