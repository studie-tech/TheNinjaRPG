import { getScrollBehavior } from "@/utils/dom";

/** A scroll under way; `isActive` is false once it has arrived, or was stopped. */
export type ScrollGlide = { readonly isActive: boolean; stop: () => void };

/**
 * Scrolls by an offset with momentum: the page gathers speed and settles, longer for a
 * longer way. It stops where anything else scrolls the page meanwhile. A visitor who asks
 * for reduced motion is taken there at once. `onEnd` runs once it stops. Browser only.
 */
export const glideScrollBy = (
  scroller: Element,
  offset: number,
  onEnd?: () => void,
): ScrollGlide => {
  const glide = {
    isActive: false,
    stop: () => {
      if (!glide.isActive) return;
      glide.isActive = false;
      cancelAnimationFrame(frame);
      onEnd?.();
    },
  };
  if (getScrollBehavior() === "auto") {
    scroller.scrollBy({ top: offset, behavior: "auto" });
    return glide;
  }
  const from = scroller.scrollTop;
  // Aimed no further than the page goes, so it settles there too.
  const end = scroller.scrollHeight - scroller.clientHeight;
  const way = Math.max(0, Math.min(end, from + offset)) - from;
  const duration = Math.min(MAX_MS, BASE_MS + Math.abs(way) * MS_PER_PX);
  let expected = from;
  let startedAt: number | undefined;
  const step = (now: number) => {
    startedAt ??= now;
    if (Math.abs(scroller.scrollTop - expected) > 1) {
      glide.stop();
      return;
    }
    const progress = Math.min(1, (now - startedAt) / duration);
    scroller.scrollTo({
      top: from + way * easeInOut(progress),
      behavior: "instant",
    });
    expected = scroller.scrollTop;
    if (progress < 1) frame = requestAnimationFrame(step);
    else glide.stop();
  };
  glide.isActive = true;
  let frame = requestAnimationFrame(step);
  return glide;
};

const BASE_MS = 350;
const MS_PER_PX = 0.5;
const MAX_MS = 800;

const easeInOut = (progress: number) =>
  progress < 0.5 ? 4 * progress ** 3 : 1 - (2 - 2 * progress) ** 3 / 2;
