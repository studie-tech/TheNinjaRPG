/**
 * Moves the Activity dock to a new place with momentum, so the eye can follow it there, and
 * lets it grow and shrink with its lesson once placed. The dock is laid out where it belongs
 * at once; an offset from there carries it over: an animated `translate`, which the browser
 * keeps smooth while a page loads, and the panel's own width and height. Players who prefer
 * reduced motion see it there at once.
 */
export const createDockMotion = (dock: HTMLElement) => {
  let seen: { box: Box; speed: MovingState; isOpen: boolean } | null = null;
  // Where it goes and how tall it gets are ways of their own, so words that wrap anew on
  // the way never hold up the move.
  let move: Way | null = null;
  let growth: Way | null = null;
  let frame: number | null = null;
  let observer: ResizeObserver | null = null;
  let target: Box = { left: 0, top: 0, width: 0, height: 0 };
  let isPlaced = false;

  const getPanel = () => dock.querySelector<HTMLElement>(PANEL_SELECTOR);
  const readState = (): MovingState => ({
    left: readPart(move, "left"),
    top: readPart(move, "top"),
    width: readPart(move, "width"),
    height: readPart(growth, "height"),
  });
  const drawSize = () => {
    const panel = getPanel();
    if (!panel) return;
    const { width, height } = readState();
    const isGrowing = isPlaced && height !== RESTING;
    panel.style.width =
      width === RESTING
        ? (panel.dataset.dockWidth ?? "")
        : `${target.width + width.offset}px`;
    panel.style.height = isGrowing ? `${target.height + height.offset}px` : "";
    // Clipped below only, as the portrait reaches past the side.
    panel.style.overflowY = isGrowing ? "clip" : "";
  };
  const step = () => {
    frame = null;
    if (isOver(move)) move = null;
    if (isOver(growth)) growth = null;
    drawSize();
    if (move || growth) frame = requestAnimationFrame(step);
  };
  const stopMoving = () => {
    move?.slide?.cancel();
    move = null;
  };
  /** Moves from where the dock is seen, keeping the speed it has. */
  const setOut = (from: Box, speed: MovingState) => {
    const begin = eachPart((part) => ({
      ...speed[part],
      offset: from[part] - target[part],
    }));
    const distance = Math.hypot(
      begin.left.offset,
      begin.top.offset,
      begin.width.offset / 2,
    );
    if (distance >= 1 || speed.left !== RESTING || speed.top !== RESTING) {
      const duration = getMotionDuration(distance);
      const motions = eachPart((part) => planMotion(begin[part], duration));
      const slide = dock.animate?.(getSlideFrames(motions, duration), { duration });
      move = { motions, start: performance.now(), duration, slide: slide ?? null };
    }
    grow(begin.height);
    step();
  };
  /** Grows or shrinks the placed dock to its new height. */
  const grow = (begin: MotionState) => {
    growth = null;
    if (!isPlaced || (Math.abs(begin.offset) < 1 && begin.velocity === 0)) return;
    const duration = getMotionDuration(Math.abs(begin.offset));
    const motion = planMotion(begin, duration);
    const motions = eachPart(() => motion);
    growth = { motions, start: performance.now(), duration, slide: null };
  };

  return {
    /** The dock is laid out in a new place, or open or closed there. */
    arrive: (next: { isOpen: boolean; isPlaced: boolean }) => {
      const panel = getPanel();
      isPlaced = next.isPlaced;
      if (panel) {
        panel.style.width = panel.dataset.dockWidth ?? "";
        panel.style.height = "";
      }
      const { left, top, width } = getRestedRect(dock);
      target = { left, top, width, height: getContentHeight(dock) };
      const canMove = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (canMove && seen?.isOpen && next.isOpen) setOut(seen.box, seen.speed);
      else drawSize();
      // A lesson that grows or shrinks takes its height along.
      if (!canMove || !isPlaced || !panel || typeof ResizeObserver === "undefined")
        return;
      observer = new ResizeObserver(() => {
        const height = getContentHeight(dock);
        if (Math.abs(height - target.height) < 1) return;
        const speed = readPart(growth, "height");
        const offset = target.height + speed.offset - height;
        target = { ...target, height };
        grow({ ...speed, offset });
        if (frame === null) step();
        else drawSize();
      });
      for (const child of Array.from(panel.children)) observer.observe(child);
    },
    /** The dock is about to be laid out elsewhere: where it is seen until then. */
    leave: (isOpen: boolean) => {
      observer?.disconnect();
      observer = null;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      const { left, top, width, height } = dock.getBoundingClientRect();
      seen = { box: { left, top, width, height }, speed: readState(), isOpen };
      stopMoving();
      growth = null;
    },
  };
};

/**
 * The way from where a moving part is to where it belongs: it speeds up, slows down and
 * stops there without overshooting. A part already on the move keeps its speed and its
 * acceleration, so a change of destination bends its way instead of breaking it. The
 * minimum-jerk curve (a quintic) is the smoothest that meets both ends.
 */
export const planMotion = (start: MotionState, durationMs: number): Motion => {
  const { offset, velocity, acceleration } = start;
  const T = durationMs;
  const c3 =
    -(20 * offset + 12 * velocity * T + 3 * acceleration * T ** 2) / (2 * T ** 3);
  const c4 =
    (30 * offset + 16 * velocity * T + 3 * acceleration * T ** 2) / (2 * T ** 4);
  const c5 = -(12 * offset + 6 * velocity * T + acceleration * T ** 2) / (2 * T ** 5);
  return (elapsedMs) => {
    const t = Math.max(0, elapsedMs);
    if (t >= T) return RESTING;
    return {
      offset:
        offset +
        velocity * t +
        (acceleration / 2) * t ** 2 +
        c3 * t ** 3 +
        c4 * t ** 4 +
        c5 * t ** 5,
      velocity:
        velocity +
        acceleration * t +
        3 * c3 * t ** 2 +
        4 * c4 * t ** 3 +
        5 * c5 * t ** 4,
      acceleration: acceleration + 6 * c3 * t + 12 * c4 * t ** 2 + 20 * c5 * t ** 3,
    };
  };
};

/** How long a part takes over a distance: longer ways take longer, but never drag. */
export const getMotionDuration = (distancePx: number) =>
  Math.min(MAX_MOTION_MS, BASE_MOTION_MS + MS_PER_ROOT_PX * Math.sqrt(distancePx));

/** Where the dock belongs, whatever way it is still on. */
export const getRestedRect = (dock: HTMLElement): DOMRect => {
  const rect = dock.getBoundingClientRect();
  const [x = 0, y = 0] = (getComputedStyle(dock).translate ?? "")
    .split(" ")
    .map((part) => Number.parseFloat(part) || 0);
  return x === 0 && y === 0
    ? rect
    : new DOMRect(rect.left - x, rect.top - y, rect.width, rect.height);
};

/** The height the open dock's content takes, whatever height it is still growing to. */
export const getContentHeight = (dock: HTMLElement): number => {
  const panel = dock.querySelector<HTMLElement>(PANEL_SELECTOR);
  if (!panel) return dock.offsetHeight;
  const borders = panel.offsetHeight - panel.clientHeight;
  return (
    borders +
    Array.from(panel.children).reduce(
      (sum, child) => sum + (child instanceof HTMLElement ? child.offsetHeight : 0),
      0,
    )
  );
};

/** A part that is where it belongs. */
const RESTING: MotionState = { offset: 0, velocity: 0, acceleration: 0 };

/** The way as keyframes close enough together to be seen as one curve. */
const getSlideFrames = (
  motions: Record<Part, Motion>,
  duration: number,
): Keyframe[] => {
  const count = Math.ceil(duration / SLIDE_FRAME_MS);
  return Array.from({ length: count + 1 }, (_, index) => {
    const elapsed = (duration * index) / count;
    return {
      translate: `${motions.left(elapsed).offset}px ${motions.top(elapsed).offset}px`,
    };
  });
};

/** Where a part is on its way, as the animation on screen has it. */
const readPart = (way: Way | null, part: Part): MotionState =>
  way ? way.motions[part](getElapsed(way)) : RESTING;

const isOver = (way: Way | null) => !!way && getElapsed(way) >= way.duration;

const getElapsed = ({ start, slide }: Way) =>
  Number(slide?.currentTime ?? performance.now() - start);

const eachPart = <T>(get: (part: Part) => T) => ({
  left: get("left"),
  top: get("top"),
  width: get("width"),
  height: get("height"),
});

const PANEL_SELECTOR = ":scope > [data-dock-panel]";

const BASE_MOTION_MS = 340;
const MS_PER_ROOT_PX = 15;
const MAX_MOTION_MS = 900;
const SLIDE_FRAME_MS = 16;

/** How far a part is from where it belongs, in pixels, and how that changes per ms. */
export interface MotionState {
  offset: number;
  velocity: number;
  acceleration: number;
}

/** The state of a motion at a time after its start. */
export type Motion = (elapsedMs: number) => MotionState;

type Part = "left" | "top" | "width" | "height";
type Box = Record<Part, number>;
type MovingState = Record<Part, MotionState>;

/** A way under way. */
interface Way {
  motions: Record<Part, Motion>;
  start: number;
  duration: number;
  /** Carries the position; a document without animations shows the dock there at once. */
  slide: Animation | null;
}
