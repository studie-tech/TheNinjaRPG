"use client";

import { Ellipsis } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { useEffect, useId, useRef, useState } from "react";
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
        className={cn("h-[44px] w-[44px]", !isOverflowing && "hidden")}
        hidden={!isOverflowing}
        aria-hidden={!isOverflowing || undefined}
        aria-label={`${label} controls`}
        aria-controls={panelId}
        aria-expanded={isOverflowing && isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        <Ellipsis className="h-6 w-6" aria-hidden />
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
            "bg-popover text-popover-foreground absolute top-full right-0 z-[60] mt-1 max-h-[60dvh] max-w-[calc(100vw-2rem)] overflow-auto rounded-md border p-3 shadow-md",
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
