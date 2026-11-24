import { atom } from "jotai";
import { ACTIVITY_DOCK_WIDTH_PX } from "@/hooks/useActivityDock";
import type { SpotlightBox } from "@/layout/tutorial/Spotlight";

/**
 * Where the open lesson stands beside what it points at, or null while the Activity dock
 * keeps its resting place. Written by the tutorial's highlight placement and read by the
 * dock.
 */
export const activityDockPlaceAtom = atom<DockPlace | null>(null);

/**
 * Where the dock stands for a highlighted control: beside the lit box around it, level with
 * the control, or above or below the box. Beside what is lit in the centre column it keeps to
 * `preferredSide`, so it stays put while a page's lessons point at one control after another;
 * beside a sidebar's box the place nearest the middle of the screen wins. One over the centre
 * column costs more, as does one above or below the box. `current`, the place it stands at, is kept while it is clear and not worse than
 * the best by more than `patience`, so the card moves only when that helps the player. Null
 * when no place leaves the lit box readable.
 */
export const getDockPlace = ({
  target,
  lit,
  column,
  marks = [],
  height,
  viewport,
  preferredSide,
  current = null,
  patience = 0,
}: {
  target: SpotlightBox;
  /** What stays lit around the control. */
  lit: SpotlightBox;
  /** The page's centre column. */
  column?: SpotlightBox | null;
  /** Further elements the lesson refers to. */
  marks?: SpotlightBox[];
  /** The dock's height with everything it may still show. */
  height: number;
  viewport: { width: number; height: number };
  preferredSide: "left" | "right";
  current?: DockPlace | null;
  patience?: number;
}): DockPlace | null => {
  const clipped = clipToViewport(lit, viewport);
  const aim = clipToViewport(target, viewport);
  const pointer = getPointerReach(aim, viewport);
  const keep = [pad(aim, RING_REACH_PX), pointer, ...marks];
  const isLitInColumn = !column || overlap(clipped, column).width >= clipped.width / 2;
  const maxTop = viewport.height - DOCK_MARGIN_PX - height;
  if (maxTop < DOCK_MARGIN_PX) return null;

  /** The side of the lit box a place is beside, or null above or below it. */
  const getSide = ({ left, top, width }: DockPlace) => {
    const isLevel = top < clipped.top + clipped.height && top + height > clipped.top;
    const reach = isLevel ? MAX_LIT_OVERLAP_PX : 0;
    if (left + width <= clipped.left + reach) return "left";
    return left >= clipped.left + clipped.width - reach ? "right" : null;
  };

  /** What a place costs the player, or null when it covers what the lesson shows. */
  const costOf = (place: DockPlace): number | null => {
    const box = { ...place, height };
    if (
      box.left < DOCK_MARGIN_PX - 1 ||
      box.left + box.width > viewport.width - DOCK_MARGIN_PX + 1 ||
      box.top < DOCK_MARGIN_PX - 1 ||
      box.top > maxTop + 1 ||
      keep.some((rect) => overlap(box, rect).area > 0)
    )
      return null;
    const over = overlap(box, clipped);
    if (over.area > 0 && over.width > MAX_LIT_OVERLAP_PX) return null;
    // Over the column whatever its height, so the column's top pulls no lesson off level.
    const columnShare = column
      ? Math.max(0, overlap(box, column).width) / box.width
      : 0;
    return (
      distance(box, aim) +
      LEVEL_WEIGHT * Math.abs(centreY(box) - centreY(aim)) +
      CENTRE_WEIGHT * Math.abs(centreX(box) - viewport.width / 2) +
      NARROW_WEIGHT * (ACTIVITY_DOCK_WIDTH_PX - box.width) +
      COLUMN_COST * columnShare +
      (over.area > 0 ? LIT_OVERLAP_WEIGHT * over.width : 0) +
      (getSide(place) === null ? STACKED_COST : 0)
    );
  };

  const litRight = clipped.left + clipped.width;
  const litBottom = clipped.top + clipped.height;
  const candidates: DockPlace[] = [];
  const level = clamp(centreY(aim) - height / 2, DOCK_MARGIN_PX, maxTop);
  const tops = [level, ...steps(DOCK_MARGIN_PX, maxTop)];
  const leftRoom = clipped.left - DOCK_GAP_PX - DOCK_MARGIN_PX;
  const rightRoom = viewport.width - DOCK_MARGIN_PX - (litRight + DOCK_GAP_PX);
  // A gutter a little too narrow for the lesson lets it stand over the box's own edge.
  if (leftRoom >= DOCK_MIN_WIDTH_PX - MAX_LIT_OVERLAP_PX) {
    const width = clamp(leftRoom, DOCK_MIN_WIDTH_PX, ACTIVITY_DOCK_WIDTH_PX);
    const left = Math.max(DOCK_MARGIN_PX, clipped.left - DOCK_GAP_PX - width);
    for (const top of tops) candidates.push({ left, top, width });
  }
  if (rightRoom >= DOCK_MIN_WIDTH_PX - MAX_LIT_OVERLAP_PX) {
    const width = clamp(rightRoom, DOCK_MIN_WIDTH_PX, ACTIVITY_DOCK_WIDTH_PX);
    const left = Math.min(
      viewport.width - DOCK_MARGIN_PX - width,
      litRight + DOCK_GAP_PX,
    );
    for (const top of tops) candidates.push({ left, top, width });
  }
  const width = Math.min(ACTIVITY_DOCK_WIDTH_PX, viewport.width - 2 * DOCK_MARGIN_PX);
  const maxLeft = viewport.width - DOCK_MARGIN_PX - width;
  const lefts = [
    clamp(centreX(aim) - width / 2, DOCK_MARGIN_PX, maxLeft),
    ...steps(DOCK_MARGIN_PX, maxLeft),
  ];
  // Clear of the hand too, where it reaches past the box.
  const pointerBottom = pointer.top + pointer.height;
  for (const top of [
    clipped.top - DOCK_GAP_PX - height,
    Math.min(clipped.top, pointer.top) - DOCK_GAP_PX - height,
    litBottom + DOCK_GAP_PX,
    Math.max(litBottom, pointerBottom) + DOCK_GAP_PX,
  ])
    for (const left of lefts) candidates.push({ left, top, width });

  const costs = candidates.map((place) => ({ place, cost: costOf(place) }));
  // Anywhere else around the column is for a side of its own without room.
  const keepsSide =
    isLitInColumn &&
    costs.some(({ place, cost }) => cost !== null && getSide(place) === preferredSide);
  let best: DockPlace | null = null;
  let bestCost = Number.POSITIVE_INFINITY;
  for (const { place, cost } of costs) {
    if (cost === null || (keepsSide && getSide(place) !== preferredSide)) continue;
    if (cost < bestCost) {
      best = place;
      bestCost = cost;
    }
  }
  if (current && !(keepsSide && getSide(current) !== preferredSide)) {
    const cost = costOf(current);
    if (cost !== null && cost <= bestCost + patience) return current;
  }
  return (
    best && {
      left: Math.round(best.left),
      top: Math.round(best.top),
      width: Math.floor(best.width),
    }
  );
};

/** Whether two places are the same. */
export const isSameDockPlace = (a: DockPlace | null, b: DockPlace | null) =>
  a && b ? a.left === b.left && a.top === b.top && a.width === b.width : a === b;

/** Whether two places are too close to tell apart on the way to them. */
export const isNearDockPlace = (a: DockPlace, b: DockPlace) =>
  Math.hypot(a.left - b.left, a.top - b.top) < NEAR_PLACE_PX && a.width === b.width;

/** The room the bouncing hand takes under a control, or over one at the screen's foot. */
const getPointerReach = (
  target: SpotlightBox,
  viewport: { height: number },
): SpotlightBox => {
  const bottom = target.top + target.height;
  const isBelow = bottom + POINTER_REACH_PX < viewport.height;
  return {
    left: centreX(target) - 24,
    width: 52,
    top: isBelow ? bottom : target.top - POINTER_REACH_PX,
    height: POINTER_REACH_PX,
  };
};

const clipToViewport = (
  box: SpotlightBox,
  viewport: { width: number; height: number },
): SpotlightBox => {
  const left = clamp(box.left, 0, viewport.width);
  const top = clamp(box.top, 0, viewport.height);
  return {
    left,
    top,
    width: clamp(box.left + box.width, 0, viewport.width) - left,
    height: clamp(box.top + box.height, 0, viewport.height) - top,
  };
};

const pad = (box: SpotlightBox, by: number): SpotlightBox => ({
  left: box.left - by,
  top: box.top - by,
  width: box.width + by * 2,
  height: box.height + by * 2,
});

const overlap = (a: SpotlightBox, b: SpotlightBox) => {
  const width = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const height = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return { width, area: width > 0 && height > 0 ? width * height : 0 };
};

/** The gap between two boxes. */
const distance = (a: SpotlightBox, b: SpotlightBox) =>
  Math.hypot(
    Math.max(0, b.left - (a.left + a.width), a.left - (b.left + b.width)),
    Math.max(0, b.top - (a.top + a.height), a.top - (b.top + b.height)),
  );

const centreX = (box: SpotlightBox) => box.left + box.width / 2;
const centreY = (box: SpotlightBox) => box.top + box.height / 2;
const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

const steps = (from: number, to: number) =>
  Array.from(
    { length: Math.max(0, Math.floor((to - from) / PLACE_STEP_PX) + 1) },
    (_, index) => from + index * PLACE_STEP_PX,
  );

/** Narrowest lesson that stands beside its subject. */
const DOCK_MIN_WIDTH_PX = 272;
/** Space kept from the edges of the screen. */
const DOCK_MARGIN_PX = 12;
/** Space kept from the lit box and the control's ring. */
const DOCK_GAP_PX = 14;
/** Room the ring takes around a control. */
const RING_REACH_PX = 10;
/** How far over the lit box's edge a lesson may reach where the gutter is too narrow. */
const MAX_LIT_OVERLAP_PX = 64;
/** Room the bouncing hand takes beside a control (see `SpotlightPointer`). */
const POINTER_REACH_PX = 76;
/** Distance below which two places count as one. */
const NEAR_PLACE_PX = 24;
/** Distance between compared places. */
const PLACE_STEP_PX = 12;

// What a place costs, in pixels of distance from the control.
const LEVEL_WEIGHT = 0.4;
const CENTRE_WEIGHT = 0.2;
const NARROW_WEIGHT = 0.3;
const LIT_OVERLAP_WEIGHT = 6;
const COLUMN_COST = 100;
const STACKED_COST = 220;

/** The dock's place on screen, in viewport pixels. */
export interface DockPlace {
  left: number;
  top: number;
  width: number;
}
