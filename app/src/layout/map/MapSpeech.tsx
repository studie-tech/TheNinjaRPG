"use client";

import { useEffect, useId, useRef, useState } from "react";
import { SpeechBubble } from "@/layout/map/SpeechBubble";
import {
  type AnchoredBox,
  anchoredRect,
  type MapAnchor,
  type MapAnchorPoint,
  type MapAnchors,
} from "@/libs/mapAnchors";
import {
  type MapSpeechLine,
  placeSpeech,
  type SpeechObstacle,
  type SpeechPlacement,
  type SpeechRect,
  type SpeechSide,
  speakerRect,
} from "@/libs/mapSpeech";

/** Marks one of the map's own panels, which speech bubbles keep clear of. */
export const MAP_HUD_ATTRIBUTE = "data-map-hud";

/**
 * Everything characters on a map are saying, as bubbles that follow them. Bubbles stay whole
 * on the map and clear of its panels (elements with `data-map-hud` in the same
 * `data-map-root`), of the things in `avoid`, and of each other. Put it inside the map's
 * positioned container.
 */
export const MapSpeech = ({
  anchors,
  lines,
  avoid = NOTHING,
  onPlaced,
}: {
  anchors: MapAnchors;
  lines: readonly MapSpeechLine[];
  /** Characters and tiles a bubble should leave in view, with any box marked over them. */
  avoid?: readonly SpeechAvoid[];
  /** Runs after a bubble moves, for anything outside that measures the controls in it. */
  onPlaced?: () => void;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const avoided = useRef(new Map<string, SpeechRect>());
  const placed = useRef(new Map<string, SpeechRect>());
  const [replacers] = useState(() => new Map<string, () => void>());
  const layerId = useId();
  const avoidKey = JSON.stringify(avoid);
  useEffect(() => {
    const rects = avoided.current;
    const cleanups = (JSON.parse(avoidKey) as SpeechAvoid[]).map((subject, index) => {
      const id = `${layerId}avoid${index}`;
      const stop = anchors.follow(id, subject.anchor, (point) => {
        if (point)
          rects.set(
            id,
            subject.box ? anchoredRect(point, subject.box) : speakerRect(point),
          );
        else rects.delete(id);
        // A bubble at rest makes way for what comes to stand under it.
        for (const placeAgain of replacers.values()) placeAgain();
      });
      return () => {
        stop();
        rects.delete(id);
      };
    });
    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, [anchors, avoidKey, layerId, replacers]);

  /** What a line's bubble should not cover, in the layer's own pixels. */
  const obstaclesFor = (lineId: string): SpeechObstacle[] => {
    const layer = ref.current;
    const origin = layer?.getBoundingClientRect();
    const onLayer = (element: Element): SpeechRect => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left - (origin?.left ?? 0),
        top: rect.top - (origin?.top ?? 0),
        width: rect.width,
        height: rect.height,
      };
    };
    const panels =
      (
        layer?.closest("[data-map-root]") ?? layer?.parentElement
      )?.querySelectorAll<HTMLElement>(`[${MAP_HUD_ATTRIBUTE}]`) ?? [];
    // The Activity dock floats over the map on a short screen and would hide the words.
    const dock = document.querySelector("[data-activity-dock]");
    return [
      ...Array.from(panels, (panel) => ({ ...onLayer(panel), kind: "panel" as const })),
      ...(dock ? [{ ...onLayer(dock), kind: "speech" as const }] : []),
      ...[...avoided.current.values()].map((rect) => ({
        ...rect,
        kind: "subject" as const,
      })),
      ...[...placed.current].flatMap(([id, rect]) =>
        id === lineId ? [] : [{ ...rect, kind: "speech" as const }],
      ),
    ];
  };

  return (
    <div
      ref={ref}
      data-map-speech=""
      // Over the map's panels, which a bubble without room elsewhere covers.
      className="pointer-events-none absolute inset-0 z-[25] overflow-hidden"
    >
      {lines.map((line) => (
        <SpokenLine
          key={line.id}
          line={line}
          anchors={anchors}
          followId={`${layerId}${line.id}`}
          obstaclesFor={obstaclesFor}
          replacers={replacers}
          onPlaced={(rect) => {
            if (rect) placed.current.set(line.id, rect);
            else placed.current.delete(line.id);
            onPlaced?.();
          }}
        />
      ))}
    </div>
  );
};

/** One line's bubble, which takes the side of its speaker with the most room. */
const SpokenLine = ({
  line,
  anchors,
  followId,
  obstaclesFor,
  replacers,
  onPlaced,
}: {
  line: MapSpeechLine;
  anchors: MapAnchors;
  followId: string;
  obstaclesFor: (lineId: string) => SpeechObstacle[];
  /** Where the bubble leaves its way to be placed again when its obstacles move. */
  replacers: Map<string, () => void>;
  onPlaced: (rect: SpeechRect | null) => void;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  // Where the bubble and its tail go is written to the element in the frame that moves it.
  const [isPlaced, setPlaced] = useState(false);
  const sideRef = useRef<SpeechSide>(undefined);
  const callbacks = useRef({ obstaclesFor, onPlaced });
  useEffect(() => {
    callbacks.current = { obstaclesFor, onPlaced };
  });
  const anchorKey = JSON.stringify(line.anchor);
  const lineId = line.id;
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let last: MapAnchorPoint | null = null;
    const write = ({ side, left, top, tail }: SpeechPlacement) => {
      element.dataset.speechSide = side;
      element.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
      element.style.setProperty("--speech-tail", `${Math.round(tail)}px`);
    };
    const place = (point: MapAnchorPoint | null) => {
      last = point;
      element.style.visibility = point ? "" : "hidden";
      if (!point) {
        callbacks.current.onPlaced(null);
        return;
      }
      const size = { width: element.offsetWidth, height: element.offsetHeight };
      const placement = placeSpeech({
        point,
        size,
        obstacles: callbacks.current.obstaclesFor(lineId),
        previous: sideRef.current,
      });
      write(placement);
      sideRef.current = placement.side;
      setPlaced(true);
      callbacks.current.onPlaced({ left: placement.left, top: placement.top, ...size });
    };
    place(null);
    const stop = anchors.follow(followId, JSON.parse(anchorKey) as MapAnchor, place);
    // A line whose words change, or a wider map, gives the bubble another size.
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(() => place(last));
    observer?.observe(element);
    replacers.set(lineId, () => place(last));
    return () => {
      stop();
      replacers.delete(lineId);
      observer?.disconnect();
      callbacks.current.onPlaced(null);
    };
  }, [anchors, anchorKey, followId, lineId, replacers]);
  return (
    <div
      ref={ref}
      role="status"
      data-map-speech-line={line.id}
      className="group/speech absolute top-0 left-0 max-w-[min(22rem,75%)]"
      style={{ visibility: "hidden" }}
    >
      {/* The pop plays on the inner box, since the outer one is moved with its speaker. */}
      <div
        className={
          isPlaced ? "animate-speech-pop motion-reduce:animate-none" : undefined
        }
      >
        <SpeechBubble speaker={line.speaker} tone={line.tone} footer={line.footer}>
          {line.text}
        </SpeechBubble>
      </div>
    </div>
  );
};

/** Something a bubble leaves in view: an anchor, and the box a lesson marks over it. */
export type SpeechAvoid = { anchor: MapAnchor; box?: AnchoredBox };

const NOTHING: readonly SpeechAvoid[] = [];
