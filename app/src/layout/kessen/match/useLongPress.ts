"use client";

import { type MouseEvent, type PointerEvent, useRef } from "react";

/**
 * Long-press on touch or right-click (inspect) and hover on fine pointers. A long press
 * swallows the click that follows it, so inspecting a card never also selects it.
 */
export const useLongPress = ({
  onLongPress,
  onHover,
  delay = 450,
}: {
  onLongPress: () => void;
  onHover?: () => void;
  delay?: number;
}) => {
  const timer = useRef<number | null>(null);
  const fired = useRef(false);
  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  return {
    onPointerDown: (event: PointerEvent) => {
      fired.current = false;
      if (event.pointerType === "mouse") return;
      clear();
      timer.current = window.setTimeout(() => {
        fired.current = true;
        onLongPress();
      }, delay);
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    onPointerEnter: (event: PointerEvent) => {
      if (event.pointerType === "mouse") onHover?.();
    },
    onContextMenu: (event: MouseEvent) => {
      // A right-click inspects, and the context menu a touch browser opens on a long
      // press gives way to the inspect sheet.
      event.preventDefault();
      if (fired.current) return;
      clear();
      fired.current = true;
      onLongPress();
    },
    /** True once when the click belongs to a long press that already inspected. */
    consumeLongPress: () => {
      const was = fired.current;
      fired.current = false;
      return was;
    },
  };
};
