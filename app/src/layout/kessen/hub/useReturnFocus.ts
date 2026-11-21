"use client";

import { useRef } from "react";

/**
 * Focus handlers for a controlled dialog (`onOpenAutoFocus` / `onCloseAutoFocus` of
 * `DialogContent`): closing returns keyboard focus to the element that was focused when
 * the dialog opened. Radix restores focus only to a `DialogTrigger`, which controlled
 * dialogs do not have, so focus would otherwise fall to the page body. When that element
 * has left the page (a pack stack that ran out), focus goes to `fallback`, else to the
 * first control of the opener's `data-focus-group` ancestor if that is still shown.
 */
export const useReturnFocus = (fallback?: () => HTMLElement | null | undefined) => {
  const origin = useRef<{ element: HTMLElement; group: HTMLElement | null } | null>(
    null,
  );
  return {
    onOpenAutoFocus: () => {
      // Radix dispatches this before it moves focus, so the opener is still active.
      const active = document.activeElement;
      origin.current =
        active instanceof HTMLElement && active !== document.body
          ? {
              element: active,
              group: active.closest<HTMLElement>("[data-focus-group]"),
            }
          : null;
    },
    onCloseAutoFocus: (event: Event) => {
      const opened = origin.current;
      origin.current = null;
      const target = opened?.element.isConnected
        ? opened.element
        : (fallback?.() ??
          (opened?.group?.isConnected
            ? opened.group.querySelector<HTMLElement>(FOCUSABLE)
            : null));
      if (!target) return;
      event.preventDefault();
      target.focus({ preventScroll: true });
    },
  };
};

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
