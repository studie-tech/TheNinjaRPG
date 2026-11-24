"use client";

import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
} from "react";
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
 * receives the press. Around a control standing alone in the lit element, as an answer in
 * its box or a Claim in its row, the rest of the element presses it too. A control inside a
 * scene (`data-spotlight-scene`: a map) leaves the whole scene lit. The layer is portalled
 * into the body as a `data-battle-focus-layer`, so a focus view keeps it interactive. The
 * control under the hole is shown at full opacity: pages fade a hovered card or the actions
 * not selected, which would make the one control the player is told to press look disabled.
 * While the hole, its pointer or a mark sits where toasts appear, the spotlight publishes
 * `--tutorial-toast-top` so they arrive below.
 */
export const Spotlight = ({
  box,
  scene,
  marks = [],
  dim = true,
  ping = true,
  pointer = true,
  holeClassName,
  onPress,
  children,
}: {
  box: SpotlightBox;
  /** The scene the control is part of (see `getSpotlightScene`), lit around it. */
  scene?: SpotlightBox | null;
  /** Further elements the step refers to: uncovered, and named ones ringed with dashes. */
  marks?: SpotlightMark[];
  /** Dims the page around the hole; off for a scene the player must see whole. */
  dim?: boolean;
  /** The ring that pulses a few pixels outward to draw the eye to the hole. */
  ping?: boolean;
  /** The bouncing hand, for a control the player should press. */
  pointer?: boolean;
  /** Classes for the hole box (pointer events, background). */
  holeClassName?: string;
  /** Takes the presses in the hole, for something shown rather than used. */
  onPress?: () => void;
  /** Rendered inside the ring, such as a button covering the hole. */
  children?: ReactNode;
}) => {
  const layerRef = useRef<HTMLDivElement>(null);
  const litRef = useRef<Element | null>(null);
  const toastSource = useId();
  useLayoutEffect(() => {
    const lit = litRef.current;
    if (lit?.isConnected && isBoxOf(lit, box)) return;
    lit?.removeAttribute(SPOTLIT_ATTRIBUTE);
    litRef.current = findBoxElement(box, layerRef.current);
    litRef.current?.setAttribute(SPOTLIT_ATTRIBUTE, "");
  }, [box]);
  useEffect(() => {
    if (!pointer) return;
    const pressLone = (event: MouseEvent) => {
      const lit = litRef.current;
      if (!(event.target instanceof Element) || !lit?.contains(event.target)) return;
      if (event.target.closest(PRESSABLE_SELECTOR)) return;
      getLoneControl(lit)?.click();
    };
    document.addEventListener("click", pressLone);
    return () => document.removeEventListener("click", pressLone);
  }, [pointer]);
  // After every render: the pointer and marks move with the box.
  useLayoutEffect(() => {
    setToastClearance(
      toastSource,
      getToastClearance(getSpotlightKeepRects(layerRef.current ?? undefined)),
    );
  });
  useEffect(
    () => () => {
      litRef.current?.removeAttribute(SPOTLIT_ATTRIBUTE);
      litRef.current = null;
      setToastClearance(toastSource, null);
    },
    [toastSource],
  );
  return createPortal(
    <div
      ref={layerRef}
      data-battle-focus-layer
      className="pointer-events-none fixed inset-0 z-[60]"
    >
      <style>{SPOTLIT_STYLE}</style>
      {dim && (
        <SpotlightDim box={box} scene={scene} extra={marks.map((mark) => mark.box)} />
      )}
      {marks.map((mark) => (
        <SpotlightMarkRing key={mark.key} mark={mark} />
      ))}
      <div
        data-spotlight-keep
        className={cn("absolute rounded-lg", holeClassName)}
        style={spotlightHoleStyle(box)}
      >
        {ping && (
          <span className="animate-spotlight-ping pointer-events-none absolute inset-0 rounded-lg motion-reduce:animate-none" />
        )}
        <div className="absolute inset-0 z-[1] rounded-lg border-[3px] border-amber-400 shadow-[0_0_18px_rgba(245,158,11,0.8)]">
          {onPress && (
            // The lesson's Next button says the same to a keyboard or screen reader.
            <button
              type="button"
              aria-hidden="true"
              tabIndex={-1}
              data-spotlight-press=""
              className="pointer-events-auto absolute inset-0 cursor-pointer rounded-lg"
              onClick={(event) => {
                event.stopPropagation();
                onPress();
              }}
            />
          )}
          {children}
        </div>
      </div>
      {pointer && <SpotlightPointer box={box} />}
    </div>,
    document.body,
  );
};

/**
 * Dims the page around a highlight. A mask cut-out rather than a huge
 * box-shadow spread: Chrome stops painting shadows that large on a
 * transformed layer, which left the page undimmed.
 */
export const SpotlightDim = ({
  box,
  scene,
  extra = [],
}: {
  box?: SpotlightBox;
  /** A region lit as it is, without padding. */
  scene?: SpotlightBox | null;
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
          {scene ? (
            <rect
              data-spotlight-lit-scene=""
              x={scene.left}
              y={scene.top}
              width={scene.width}
              height={scene.height}
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
  if (!label) return null;
  return (
    <div
      data-spotlight-keep
      className="absolute rounded-md border-2 border-dashed border-sky-300 shadow-[0_0_12px_rgba(125,211,252,0.6)]"
      style={{
        top: 0,
        left: 0,
        width: box.width + MARK_PADDING_PX * 2,
        height: box.height + MARK_PADDING_PX * 2,
        transform: `translate(${box.left - MARK_PADDING_PX}px, ${box.top - MARK_PADDING_PX}px)`,
      }}
    >
      <span
        className={cn(
          "absolute max-w-[160px] truncate rounded-sm bg-sky-300 px-1.5 py-0.5 text-[11px] leading-tight font-semibold whitespace-nowrap text-sky-950 shadow",
          // Inside the edge of a bar or a row of buttons the name would cover all of it.
          box.height < MARK_TAB_MIN_HEIGHT_PX
            ? "-top-0.5 left-0 -translate-y-full"
            : "-top-2 left-1/2 -translate-x-1/2",
        )}
      >
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
  if (direction) return <SpotlightEdgePointer box={box} direction={direction} />;
  const below = box.top + box.height + 64 < window.innerHeight;
  return (
    <Image
      src={IMG_URL_HANDPOINTER}
      alt=""
      aria-hidden="true"
      data-spotlight-keep
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
 * The hand at the screen's edge for a highlight scrolled out of view, on a pill labelled
 * with the way to scroll. The pill is as wide as its one-line label and centred under the
 * highlight as far as the page's width (without its scrollbar) allows.
 */
const SpotlightEdgePointer = ({
  box,
  direction,
}: {
  box: SpotlightBox;
  direction: "up" | "down";
}) => {
  const pillRef = useRef<HTMLButtonElement>(null);
  const x = box.left + box.width / 2;
  // After every render: the label's width depends on the font scale.
  useLayoutEffect(() => {
    const pill = pillRef.current;
    if (!pill) return;
    const width = pill.offsetWidth;
    const pageWidth = document.documentElement.clientWidth || window.innerWidth;
    const left = Math.min(pageWidth - EDGE_GAP_PX - width, x - width / 2);
    pill.style.left = `${Math.max(EDGE_GAP_PX, left)}px`;
  });
  const dock = document.querySelector("[data-activity-dock]")?.getBoundingClientRect();
  const dockBelow =
    dock && dock.left <= x + 48 && dock.right >= x - 48 && dock.height > 0;
  const bottom = window.innerHeight - (dockBelow ? dock.top : window.innerHeight) + 12;
  return (
    <button
      ref={pillRef}
      type="button"
      data-spotlight-keep
      aria-label={`Scroll ${direction} to the highlighted control`}
      className="bg-card pointer-events-auto fixed z-[62] flex w-max items-center gap-1.5 rounded-xl border-2 border-amber-400 px-3 py-1.5 text-sm font-semibold whitespace-nowrap shadow-[0_0_18px_rgba(245,158,11,0.8)]"
      style={direction === "up" ? { top: 12 } : { bottom }}
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
          "h-9 w-9 shrink-0 animate-bounce motion-reduce:animate-none",
          direction === "down" && "rotate-180",
        )}
        width={80}
        height={80}
      />
      {direction === "up" ? "Scroll up" : "Scroll down"}
    </button>
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

/** Whether two boxes that may be missing are equal. */
export const isSameOptionalBox = (a: SpotlightBox | null, b: SpotlightBox | null) =>
  a && b ? isSameBox(a, b) : a === b;

/**
 * The box of the scene an element is part of, the nearest `data-spotlight-scene` around it,
 * or null outside one. A lesson about something on a map keeps the map in view, so the
 * spotlight dims only what surrounds it.
 */
export const getSpotlightScene = (element: Element): SpotlightBox | null => {
  const rect = element.closest("[data-spotlight-scene]")?.getBoundingClientRect();
  return rect
    ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
    : null;
};

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
 * Whether an open modal covers the element: Radix hides everything outside the modal,
 * under this attribute of its own. A control there cannot be pressed.
 */
export const isUnderModal = (element: Element) =>
  !!element.closest('[data-aria-hidden="true"]');

/**
 * The first visible, usable element with this id, outside anything a modal covers. An
 * element inside collapsed content-box controls asks them to reveal themselves and is
 * skipped this time.
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
    if (!isUsableHighlightRect(rect) || isUnderModal(element)) continue;
    return element;
  }
  return null;
};

/**
 * Where the lesson dock stands (its top, in viewport pixels) when it gives way to a
 * highlighted `target` it would otherwise cover, or null to use its usual place at the top
 * of the screen. A target outside a dialog gets null. Inside a dialog the top of the screen
 * holds the dialog's header (its title, art, balances and fields), so the dock takes the
 * band clear of the target and its pointer that covers the least of the dialog's headings,
 * images and controls: in a shop or a jutsu dialog, the list of stats between header and
 * buttons. Of equally clear bands it takes the one nearest the target. `minTop` is the
 * highest top the dock may take.
 */
export const getDodgedPanelTop = (
  target: Element,
  panel: { left: number; right: number; height: number },
  minTop: number,
): number | null => {
  const dialog = target.closest('[role="dialog"], [role="alertdialog"]');
  if (!dialog) return null;
  const viewportHeight = window.innerHeight;
  const rect = target.getBoundingClientRect();
  // The pointer hangs below the target when there is room for it, else above it.
  const isPointerBelow = rect.bottom + POINTER_REACH_PX < viewportHeight;
  const blockedTop = rect.top - DODGE_GAP_PX - (isPointerBelow ? 0 : POINTER_REACH_PX);
  const blockedBottom =
    rect.bottom + DODGE_GAP_PX + (isPointerBelow ? POINTER_REACH_PX : 0);
  const maxTop = viewportHeight - DODGE_GAP_PX - panel.height;
  const keep = Array.from(dialog.querySelectorAll(DIALOG_KEEP_SELECTOR))
    .filter((element) => element !== target && !target.contains(element))
    .map((element) => element.getBoundingClientRect())
    .filter((box) => box.width > 0 && box.height > 0);
  /** Area of the dialog's headings, images and controls a dock at `top` would cover. */
  const coverAt = (top: number) =>
    keep.reduce((sum, box) => {
      const width = Math.min(box.right, panel.right) - Math.max(box.left, panel.left);
      const height = Math.min(box.bottom, top + panel.height) - Math.max(box.top, top);
      return width > 0 && height > 0 ? sum + width * height : sum;
    }, 0);
  let best: { top: number; cover: number; distance: number } | null = null;
  for (let top = Math.round(minTop); top <= maxTop; top += DODGE_STEP_PX) {
    if (top < blockedBottom && top + panel.height > blockedTop) continue;
    const cover = coverAt(top);
    const distance = Math.min(
      Math.abs(blockedTop - (top + panel.height)),
      Math.abs(top - blockedBottom),
    );
    if (
      !best ||
      cover < best.cover ||
      (cover === best.cover && distance < best.distance)
    ) {
      best = { top, cover, distance };
    }
  }
  return best?.top ?? null;
};

/**
 * Where the dock stands when no band of a dialog is clear of its `target` (see
 * `getDodgedPanelTop`): over the dialog's blank space rather than its controls and words, on
 * either side of the screen, as low as that allows. Null for a target outside a dialog.
 */
export const getPanelPlaceOverDialog = (
  target: Element,
  panel: { left: number; right: number; height: number },
  minTop: number,
): { top: number; side: "left" | "right" } | null => {
  const dialog = target.closest('[role="dialog"], [role="alertdialog"]');
  if (!dialog) return null;
  const width = panel.right - panel.left;
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
  const edge = Math.min(panel.left, viewportWidth - panel.right);
  const boxes = Array.from(
    dialog.querySelectorAll(DIALOG_KEEP_SELECTOR),
    (element) => ({
      box: element.getBoundingClientRect(),
      weight: element.matches(DIALOG_CONTROL_SELECTOR) ? DIALOG_CONTROL_WEIGHT : 1,
    }),
  )
    .concat(getTextBoxes(dialog).map((box) => ({ box, weight: TEXT_WEIGHT })))
    // The target's own words and blank space give way last.
    .concat({ box: target.getBoundingClientRect(), weight: TARGET_WEIGHT })
    .filter(({ box }) => box.width > 0 && box.height > 0);
  const maxTop = window.innerHeight - DODGE_GAP_PX - panel.height;
  let best: { top: number; side: "left" | "right"; cost: number } | null = null;
  for (const side of ["right", "left"] as const) {
    const left = side === "left" ? edge : viewportWidth - edge - width;
    for (let top = Math.floor(maxTop); top >= minTop; top -= DODGE_STEP_PX) {
      const cost = boxes.reduce((sum, { box, weight }) => {
        const x = Math.min(box.right, left + width) - Math.max(box.left, left);
        const y = Math.min(box.bottom, top + panel.height) - Math.max(box.top, top);
        return x > 0 && y > 0 ? sum + x * y * weight : sum;
      }, 0);
      if (!best || cost < best.cost) best = { top, side, cost };
    }
  }
  return best && { top: best.top, side: best.side };
};

/** The boxes of the lines of text inside an element. */
const getTextBoxes = (element: Element) => {
  const texts = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  const boxes: DOMRect[] = [];
  // A document without layout (tests) has no text boxes.
  if (!range.getClientRects) return boxes;
  while (texts.nextNode()) {
    if (!texts.currentNode.textContent?.trim()) continue;
    range.selectNodeContents(texts.currentNode);
    boxes.push(...range.getClientRects());
  }
  return boxes;
};

/**
 * Viewport boxes of what a spotlight keeps in view: its hole, its pointer and its marks,
 * in `layer` or in every spotlight on the page.
 */
export const getSpotlightKeepRects = (layer: ParentNode = document) =>
  Array.from(layer.querySelectorAll("[data-spotlight-keep]"), (element) =>
    element.getBoundingClientRect(),
  ).filter((rect) => rect.width > 0 && rect.height > 0);

/**
 * How far down toasts must start to clear these boxes, or null when none sits in the
 * toasts' column near the top of the screen, or clearing it would push them past the
 * middle of the screen. The column is Sonner's: a 356 px stack 24 px in from the right,
 * and the whole width on a screen up to 600 px wide.
 */
export const getToastClearance = (rects: DOMRect[]): number | null => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const columnLeft = width <= 600 ? 0 : width - 24 - 356;
  const columnRight = width <= 600 ? width : width - 24;
  const bottom = rects
    .filter(
      (rect) =>
        rect.top < height * TOAST_BAND_SHARE &&
        rect.right > columnLeft &&
        rect.left < columnRight,
    )
    .reduce<number | null>((lowest, rect) => Math.max(lowest ?? 0, rect.bottom), null);
  if (bottom === null || bottom + TOAST_GAP_PX > height / 2) return null;
  return Math.ceil(bottom + TOAST_GAP_PX);
};

/**
 * Record where `source` needs toasts to start (null when it needs nothing) and publish the
 * lowest such start as `--tutorial-toast-top` on the root, which the toaster offsets by.
 */
export const setToastClearance = (source: string, top: number | null) => {
  if (top === null) toastClearances.delete(source);
  else toastClearances.set(source, top);
  const root = document.documentElement.style;
  if (toastClearances.size === 0) root.removeProperty(TOAST_TOP_PROPERTY);
  else
    root.setProperty(TOAST_TOP_PROPERTY, `${Math.max(...toastClearances.values())}px`);
};

/**
 * The outermost element whose box is `box`, found under the box's centre beneath the
 * spotlight's own `layer`: the highlighted element, or a wrapper drawn exactly around it.
 */
const findBoxElement = (box: SpotlightBox, layer: Element | null) => {
  if (typeof document.elementsFromPoint !== "function") return null;
  const hits = document.elementsFromPoint(
    box.left + box.width / 2,
    box.top + box.height / 2,
  );
  for (const hit of hits) {
    if (layer?.contains(hit)) continue;
    let found: Element | null = null;
    for (let node: Element | null = hit; node && node !== document.body; ) {
      if (isBoxOf(node, box)) found = node;
      else if (found) break;
      node = node.parentElement;
    }
    if (found) return found;
  }
  return null;
};

/** Whether an element is drawn at this box, to the pixel. */
const isBoxOf = (element: Element, box: SpotlightBox) => {
  const rect = element.getBoundingClientRect();
  return (
    Math.abs(rect.top - box.top) < 1 &&
    Math.abs(rect.left - box.left) < 1 &&
    Math.abs(rect.width - box.width) < 1 &&
    Math.abs(rect.height - box.height) < 1
  );
};

/** Whatever takes a press of its own. */
const PRESSABLE_SELECTOR =
  'button, a[href], input, select, textarea, label, summary, canvas, [role="button"], [role="tab"], [tabindex]:not([tabindex="-1"])';

/** The enabled button or link that is the only thing to press inside an element. */
const getLoneControl = (element: Element) => {
  const [control, ...others] = Array.from(
    element.querySelectorAll<HTMLElement>(PRESSABLE_SELECTOR),
  ).filter((each) => each.getClientRects().length > 0);
  if (!control || others.length > 0) return null;
  return control.matches("button:not(:disabled), a[href]") ? control : null;
};

/** Set on the element under the spotlight's hole while it is lit. */
const SPOTLIT_ATTRIBUTE = "data-tutorial-spotlit";

/**
 * Restores full opacity to the lit element and to whatever inside it a page fades with an
 * opacity utility (`hover:opacity-50`, `opacity-20`). Parts a page hides with `opacity-0`
 * in some state keep their own opacity.
 */
const SPOTLIT_STYLE = `:is([${SPOTLIT_ATTRIBUTE}], [${SPOTLIT_ATTRIBUTE}] *)[class*="opacity-"]:not([class*="opacity-0"]) { opacity: 1 !important; }`;

/** What a dodging dock keeps clear of inside a dialog. */
const DIALOG_KEEP_SELECTOR =
  'h1, h2, h3, img, label, input, select, textarea, button, a[href], [role="slider"]';
/** What of those the player presses or fills in, which must stay reachable. */
const DIALOG_CONTROL_SELECTOR =
  'input, select, textarea, button, a[href], [role="slider"]';
/** How much more covering a control costs than covering a heading or a picture. */
const DIALOG_CONTROL_WEIGHT = 20;
/** How much more covering words to read costs than covering a picture. */
const TEXT_WEIGHT = 4;
/** How much covering the target's own words and blank space costs, against a heading. */
const TARGET_WEIGHT = 0.05;
/** Lowest mark whose name still hangs over its top edge rather than above it. */
const MARK_TAB_MIN_HEIGHT_PX = 64;
/** Space a dodging dock keeps from the target and the screen's foot. */
const DODGE_GAP_PX = 12;
/** Room the bouncing hand takes beside a target (see `SpotlightPointer`). */
const POINTER_REACH_PX = 64;
/** Distance between the dock tops `getDodgedPanelTop` compares. */
const DODGE_STEP_PX = 4;

/** Where toasts start for each spotlight that keeps something clear of them. */
const toastClearances = new Map<string, number>();
/** The root property the toaster reads its top offset from. */
const TOAST_TOP_PROPERTY = "--tutorial-toast-top";
/** Share of the screen's height, from the top, where toasts stack. */
const TOAST_BAND_SHARE = 1 / 3;
/** Space between a cleared box and the first toast. */
const TOAST_GAP_PX = 12;
/** Space the edge pointer keeps from the sides of the page. */
const EDGE_GAP_PX = 8;

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
  /** Shown on the dashed ring; an unnamed ("") element is uncovered alone. */
  label: string;
}
