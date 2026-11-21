"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A number that counts to each new value over `duration` ms, so a changing total reads
 * as one numeral moving rather than two drawn over each other. Without motion it jumps.
 */
export const useTweenedNumber = (value: number, motion: boolean, duration = 320) => {
  const [shown, setShown] = useState(value);
  const shownRef = useRef(value);

  useEffect(() => {
    const from = shownRef.current;
    if (
      !motion ||
      from === value ||
      typeof window.requestAnimationFrame !== "function"
    ) {
      shownRef.current = value;
      setShown(value);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - progress) ** 3;
      const next = Math.round(from + (value - from) * eased);
      shownRef.current = next;
      setShown(next);
      if (progress < 1) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [value, motion, duration]);

  return shown;
};
