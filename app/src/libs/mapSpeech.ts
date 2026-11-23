import type { ReactNode } from "react";
import type { MapAnchor, MapAnchorPoint } from "@/libs/mapAnchors";

/** How a line is spoken, which the bubble's outline shows. */
export type SpeechTone = "say" | "shout" | "thought";

/**
 * Something a character on the map says: an NPC's greeting, a quest's dialogue, a cry in a
 * scene. `footer` holds controls that answer it.
 */
export type MapSpeechLine = {
  /** Stable while the line stands; a new id is a new bubble. */
  id: string;
  anchor: MapAnchor;
  /** Name plate over the words; left out where it is plain who speaks. */
  speaker?: string;
  text: ReactNode;
  tone?: SpeechTone;
  footer?: ReactNode;
};

export type SpeechSide = "above" | "below" | "left" | "right";
export type SpeechRect = { left: number; top: number; width: number; height: number };

/**
 * What a bubble should not cover, by how much it matters: a `subject` is a character or a
 * target the player needs to see, `speech` another bubble or a panel over the map that
 * would hide the words, and a `panel` one of the map's own, which can be spared for a moment.
 */
export type SpeechObstacle = SpeechRect & { kind: "subject" | "speech" | "panel" };

/** Where a bubble goes, with its tail's distance along the edge that faces the speaker. */
export type SpeechPlacement = {
  side: SpeechSide;
  left: number;
  top: number;
  tail: number;
};

/** Space between the bubble and its speaker, which the tail crosses. */
export const SPEECH_TAIL_PX = 10;
/** Space kept to the map's edges, and from the tail to the bubble's corners. */
const EDGE_PX = 8;
const CORNER_PX = 16;
/** Order of preference when several sides are equally free. */
const SIDES: readonly SpeechSide[] = ["above", "right", "left", "below"];
/** What a covered pixel of each costs; covering the speaker defeats the bubble. */
const COVER_COST = { speaker: 8, subject: 8, speech: 3, panel: 0.5 } as const;
/** Cost a less preferred side has to save before it is taken. */
const SIDE_STEP_COST = 250;
/** Cost that keeps a bubble on the side it already has, so it does not jump. */
const KEEP_SIDE_COST = 1500;

/**
 * Place a bubble beside its speaker, whole on the map, on the side that covers least of
 * what matters among `obstacles`. A speaker off the map leaves the bubble at the edge
 * nearest to them.
 */
export const placeSpeech = ({
  point,
  size,
  obstacles,
  previous,
}: {
  point: MapAnchorPoint;
  size: { width: number; height: number };
  obstacles: readonly SpeechObstacle[];
  previous?: SpeechSide;
}): SpeechPlacement => {
  const speaker = speakerRect(point);
  const centerY = speaker.top + speaker.height / 2;
  const maxLeft = Math.max(EDGE_PX, point.width - size.width - EDGE_PX);
  const maxTop = Math.max(EDGE_PX, point.height - size.height - EDGE_PX);
  const candidates = SIDES.map((side, rank) => {
    const raw =
      side === "above" || side === "below"
        ? {
            left: point.x - size.width / 2,
            top:
              side === "above"
                ? speaker.top - SPEECH_TAIL_PX - size.height
                : speaker.top + speaker.height + SPEECH_TAIL_PX,
          }
        : {
            left:
              side === "left"
                ? speaker.left - SPEECH_TAIL_PX - size.width
                : speaker.left + speaker.width + SPEECH_TAIL_PX,
            top: centerY - size.height / 2,
          };
    const left = clamp(raw.left, EDGE_PX, maxLeft);
    const top = clamp(raw.top, EDGE_PX, maxTop);
    const rect = { left, top, ...size };
    const covered =
      obstacles.reduce(
        (sum, obstacle) => sum + overlap(rect, obstacle) * COVER_COST[obstacle.kind],
        0,
      ) +
      overlap(rect, speaker) * COVER_COST.speaker;
    const cost =
      covered + rank * SIDE_STEP_COST - (side === previous ? KEEP_SIDE_COST : 0);
    const tail =
      side === "above" || side === "below"
        ? clamp(point.x - left, CORNER_PX, size.width - CORNER_PX)
        : clamp(centerY - top, CORNER_PX, size.height - CORNER_PX);
    return { side, left, top, tail, cost };
  });
  const { side, left, top, tail } = candidates.reduce((best, candidate) =>
    candidate.cost < best.cost ? candidate : best,
  );
  return { side, left, top, tail };
};

/** The space a character or marker takes on the map. */
export const speakerRect = (point: MapAnchorPoint): SpeechRect => ({
  left: point.x - point.tile * 0.4,
  top: point.top,
  width: point.tile * 0.8,
  height: Math.max(1, point.foot - point.top),
});

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(Math.max(min, max), value));

const overlap = (a: SpeechRect, b: SpeechRect) =>
  Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
