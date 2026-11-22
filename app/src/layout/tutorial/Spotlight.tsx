"use client";

import { type CSSProperties, type ReactNode, useId } from "react";
import { createPortal } from "react-dom";
import { IMG_URL_HANDPOINTER } from "@/drizzle/constants";
import { REVEAL_CONTENT_BOX_CONTROLS } from "@/layout/ContentBoxHeaderActions";
import Image from "@/layout/Image";
import { cn } from "@/libs/shadui";
import {
  getHighlightScrollDirection,
  isUsableHighlightRect,
  TUTORIAL_LAYOUT_EVENT,
  type TutorialScreenBox,
} from "@/libs/tutorial";

/**
 * The tutorial's spotlight over the viewport: the page dims around one control, an amber
 * ring marks it and a hand points at it. The layer lets every tap through except where
 * `children` (placed inside the ring) take them, so the real control under the hole
 * receives the press. It is portalled into the body as a `data-battle-focus-layer`, so a
 * focus view keeps it interactive.
 */
export const Spotlight = ({
  box,
  marks = [],
  ping = true,
  pointer = true,
  holeClassName,
  children,
}: {
  box: SpotlightBox;
  /** Further elements the step refers to: uncovered and marked with a dashed ring. */
  marks?: SpotlightMark[];
  /** The expanding ring that draws the eye to the hole. */
  ping?: boolean;
  /** The bouncing hand, for a control the player should press. */
  pointer?: boolean;
  /** Classes for the hole box (pointer events, background). */
  holeClassName?: string;
  /** Rendered inside the ring, such as a button covering the hole. */
  children?: ReactNode;
}) =>
  createPortal(
    <div data-battle-focus-layer className="pointer-events-none fixed inset-0 z-[60]">
      <SpotlightDim box={box} extra={marks.map((mark) => mark.box)} />
      {marks.map((mark) => (
        <SpotlightMarkRing key={mark.key} mark={mark} />
      ))}
      <div
        className={cn("absolute rounded-lg", holeClassName)}
        style={spotlightHoleStyle(box)}
      >
        {ping && (
          <span className="pointer-events-none absolute inset-0 animate-ping rounded-lg border-2 border-amber-300/70 motion-reduce:animate-none" />
        )}
        <div className="absolute inset-0 z-[1] rounded-lg border-[3px] border-amber-400 shadow-[0_0_18px_rgba(245,158,11,0.8)]">
          {children}
        </div>
      </div>
      {pointer && <SpotlightPointer box={box} />}
    </div>,
    document.body,
  );

/**
 * Dims the page around a highlight. A mask cut-out rather than a huge
 * box-shadow spread: Chrome stops painting shadows that large on a
 * transformed layer, which left the page undimmed.
 */
export const SpotlightDim = ({
  box,
  extra = [],
}: {
  box?: SpotlightBox;
  /** Further holes, for marked elements. */
  extra?: SpotlightBox[];
}) => {
  const maskId = useId();
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      <defs>
        <mask id={maskId}>
          <rect width="100%" height="100%" fill="white" />
          {box ? (
            <rect
              x={box.left - HOLE_PADDING_PX}
              y={box.top - HOLE_PADDING_PX}
              width={box.width + HOLE_PADDING_PX * 2}
              height={box.height + HOLE_PADDING_PX * 2}
              rx={8}
              fill="black"
            />
          ) : null}
          {extra.map((hole) => (
            <rect
              key={`${hole.left},${hole.top}`}
              x={hole.left - MARK_PADDING_PX}
              y={hole.top - MARK_PADDING_PX}
              width={hole.width + MARK_PADDING_PX * 2}
              height={hole.height + MARK_PADDING_PX * 2}
              rx={6}
              fill="black"
            />
          ))}
        </mask>
      </defs>
      <rect
        width="100%"
        height="100%"
        fill="black"
        fillOpacity={0.55}
        mask={`url(#${maskId})`}
      />
    </svg>
  );
};

/** Marked elements alone, uncovered in a dimmed page: for a step that rings no control. */
export const SpotlightMarks = ({ marks }: { marks: SpotlightMark[] }) => (
  <div className="pointer-events-none absolute inset-0">
    <SpotlightDim extra={marks.map((mark) => mark.box)} />
    {marks.map((mark) => (
      <SpotlightMarkRing key={mark.key} mark={mark} />
    ))}
  </div>
);

/**
 * A dashed sky ring around an element the step refers to, with its name on a tab hung
 * from the ring's top edge, so it covers only the marked card's art and never the
 * counters or rows packed around it. Sky sets it apart from the amber ring of the
 * control to press.
 */
const SpotlightMarkRing = ({ mark }: { mark: SpotlightMark }) => {
  const { box, label } = mark;
  return (
    <div
      className="absolute rounded-md border-2 border-dashed border-sky-300 shadow-[0_0_12px_rgba(125,211,252,0.6)]"
      style={{
        top: 0,
        left: 0,
        width: box.width + MARK_PADDING_PX * 2,
        height: box.height + MARK_PADDING_PX * 2,
        transform: `translate(${box.left - MARK_PADDING_PX}px, ${box.top - MARK_PADDING_PX}px)`,
      }}
    >
      <span className="absolute -top-2 left-1/2 max-w-[160px] -translate-x-1/2 truncate rounded-sm bg-sky-300 px-1.5 py-0.5 text-[11px] leading-tight font-semibold whitespace-nowrap text-sky-950 shadow">
        {label}
      </span>
    </div>
  );
};

/**
 * Bouncing hand under a highlight, kept inside the viewport. While the highlight is
 * scrolled out of view, the hand waits at that edge of the screen, above the Activity
 * dock, pointing the way; tapping it scrolls the highlight into view.
 */
export const SpotlightPointer = ({ box }: { box: SpotlightBox }) => {
  const direction = getHighlightScrollDirection(box, window.innerHeight);
  if (direction) {
    const x = Math.max(48, Math.min(window.innerWidth - 48, box.left + box.width / 2));
    const dock = document
      .querySelector("[data-activity-dock]")
      ?.getBoundingClientRect();
    const dockBelow =
      dock && dock.left <= x + 48 && dock.right >= x - 48 && dock.height > 0;
    const bottom =
      window.innerHeight - (dockBelow ? dock.top : window.innerHeight) + 12;
    return (
      <button
        type="button"
        aria-label={`Scroll ${direction} to the highlighted control`}
        className="bg-card pointer-events-auto fixed z-[62] flex -translate-x-1/2 items-center gap-1.5 rounded-xl border-2 border-amber-400 px-3 py-1.5 text-sm font-semibold shadow-[0_0_18px_rgba(245,158,11,0.8)]"
        style={direction === "up" ? { left: x, top: 12 } : { left: x, bottom }}
        onClick={() =>
          window.scrollBy({
            top: box.top - window.innerHeight * 0.35,
            behavior: "smooth",
          })
        }
      >
        <Image
          src={IMG_URL_HANDPOINTER}
          alt=""
          aria-hidden="true"
          className={cn(
            "h-9 w-9 animate-bounce motion-reduce:animate-none",
            direction === "down" && "rotate-180",
          )}
          width={80}
          height={80}
        />
        {direction === "up" ? "Scroll up" : "Scroll down"}
      </button>
    );
  }
  const below = box.top + box.height + 64 < window.innerHeight;
  return (
    <Image
      src={IMG_URL_HANDPOINTER}
      alt=""
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute h-14 w-14 animate-bounce drop-shadow-lg motion-reduce:animate-none",
        !below && "rotate-180",
      )}
      width={80}
      height={80}
      style={{
        top: below ? box.top + box.height + 8 : Math.max(0, box.top - 64),
        left: Math.max(
          4,
          Math.min(window.innerWidth - 60, box.left + box.width / 2 - 20),
        ),
      }}
    />
  );
};

/**
 * Whether two highlight boxes are equal. The highlight is re-measured four times a second
 * so it follows an element that moves; almost none of those measurements differ, and
 * storing an equal box would re-render the whole overlay for nothing, so the position
 * setters keep the previous object when it has not moved.
 */
export const isSameBox = (a: SpotlightBox, b: SpotlightBox) =>
  a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;

/**
 * Style for the hole cut around a highlighted element, padded by 8px. The hole follows its
 * element as the page scrolls; placed with top/left, every step of that is a layout shift of
 * a viewport-sized box, while a transform moves it without one.
 */
export const spotlightHoleStyle = (box: SpotlightBox): CSSProperties => ({
  top: 0,
  left: 0,
  width: box.width + HOLE_PADDING_PX * 2,
  height: box.height + HOLE_PADDING_PX * 2,
  transform: `translate(${box.left - HOLE_PADDING_PX}px, ${box.top - HOLE_PADDING_PX}px)`,
});

/**
 * Run `update` now and whenever layout may have moved, returning the cleanup. `update`
 * returns the element it measured. Changes to the DOM tree, scrolling, resizing and the
 * element's own size, and a `TUTORIAL_LAYOUT_EVENT` from a target that moves on its own
 * (a marker on a turning globe), schedule one measurement per frame; with `animations`, so does the
 * end of any CSS animation or transition, for targets inside animated scenes that move
 * without any of those. A 250 ms poll covers content that shifts without any of these,
 * such as images and canvases above the target; it stops once the element has held
 * still for a second and restarts on the next change. A missing element keeps the poll
 * running so a late-mounting target is still found.
 */
export const trackLayout = (
  update: () => Element | null,
  { animations = false }: { animations?: boolean } = {},
) => {
  let frame: number | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;
  let observed: Element | null = null;
  let lastBox = "";
  let stableRuns = 0;
  const resizeObserver =
    typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => schedule());
  /** Measure the target, follow its resize events and stop polling once its bounds settle. */
  const run = () => {
    const element = update();
    if (element !== observed) {
      if (observed) resizeObserver?.unobserve(observed);
      if (element) resizeObserver?.observe(element);
      observed = element;
    }
    const rect = element?.getBoundingClientRect();
    const box = rect ? `${rect.top},${rect.left},${rect.width},${rect.height}` : "";
    stableRuns = box && box === lastBox ? stableRuns + 1 : 0;
    lastBox = box;
    if (stableRuns >= TRACK_LAYOUT_SETTLED_RUNS && poll !== null) {
      clearInterval(poll);
      poll = null;
    }
  };
  /** Restart the settling window without creating overlapping poll timers. */
  const startPoll = () => {
    stableRuns = 0;
    poll ??= setInterval(run, 250);
  };
  /** Coalesce layout changes into one animation-frame measurement and resume fallback polling. */
  function schedule() {
    startPoll();
    frame ??= requestAnimationFrame(() => {
      frame = null;
      run();
    });
  }
  run();
  startPoll();
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule, { passive: true });
  window.addEventListener(TUTORIAL_LAYOUT_EVENT, schedule);
  if (animations) {
    document.addEventListener("animationend", schedule, true);
    document.addEventListener("transitionend", schedule, true);
  }
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  return () => {
    if (poll !== null) clearInterval(poll);
    if (frame !== null) cancelAnimationFrame(frame);
    window.removeEventListener("scroll", schedule);
    window.removeEventListener("resize", schedule);
    window.removeEventListener(TUTORIAL_LAYOUT_EVENT, schedule);
    document.removeEventListener("animationend", schedule, true);
    document.removeEventListener("transitionend", schedule, true);
    observer.disconnect();
    resizeObserver?.disconnect();
  };
};

/**
 * The first visible, usable element with this id. An element inside collapsed
 * content-box controls asks them to reveal themselves and is skipped this time.
 */
export const getUsableHighlightElement = (id: string | undefined) => {
  if (!id) return null;
  const nodes = document.querySelectorAll<HTMLElement>(`[id="${CSS.escape(id)}"]`);
  for (const element of Array.from(nodes)) {
    if (element.closest("[data-content-box-actions] [inert]")) {
      element.dispatchEvent(new Event(REVEAL_CONTENT_BOX_CONTROLS, { bubbles: true }));
      continue;
    }
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") continue;
    const rect = element.getBoundingClientRect();
    if (!isUsableHighlightRect(rect)) continue;
    return element;
  }
  return null;
};

/** Polls (250 ms each) a measured element must hold still before the poll stops. */
const TRACK_LAYOUT_SETTLED_RUNS = 4;

/** Space between a highlighted element and the edge of its hole. */
const HOLE_PADDING_PX = 8;
/** Space between a marked element and its dashed ring. */
const MARK_PADDING_PX = 3;

/** A highlighted element's viewport box. */
export type SpotlightBox = TutorialScreenBox;

/** A marked element's box and name; `key` tells marks apart across measurements. */
export interface SpotlightMark {
  key: string;
  box: SpotlightBox;
  label: string;
}
