"use client";

import { useEffect, useId, useLayoutEffect, useRef } from "react";
import { isOnCanvas, type MapAnchor, type MapAnchors } from "@/libs/mapAnchors";
import { cn } from "@/libs/shadui";

/**
 * A box kept over something on the map, `box` tiles in size and standing on its ground: a
 * glow on a tile, a lesson's target over a marker. Off the map it is not shown at all, so
 * whatever measures it finds nothing. Follows its anchor without rendering; put it inside
 * the map's positioned container.
 */
export const MapAnchored = ({
  anchors,
  anchor,
  box,
  id,
  className,
  onPlaced,
  children,
}: {
  anchors: MapAnchors;
  anchor: MapAnchor | null;
  box: { width: number; height: number };
  id?: string;
  className?: string;
  /** Runs after each move, for anything outside that measures the box. */
  onPlaced?: () => void;
  children?: React.ReactNode;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const followId = useId();
  const onPlacedRef = useRef(onPlaced);
  useLayoutEffect(() => {
    onPlacedRef.current = onPlaced;
  });
  const anchorKey = anchor ? JSON.stringify(anchor) : "";
  useEffect(() => {
    const element = ref.current;
    const place = (point: Parameters<Parameters<MapAnchors["follow"]>[2]>[0]) => {
      if (!element) return;
      const shown = !!point && isOnCanvas(point);
      element.style.display = shown ? "" : "none";
      if (shown) {
        element.style.left = `${point.x}px`;
        // What stands on a tile rises from just below its centre.
        element.style.top = `${point.foot + point.tile * 0.25}px`;
        element.style.width = `${point.tile * box.width}px`;
        element.style.height = `${point.tile * box.height}px`;
      }
      onPlacedRef.current?.();
    };
    place(null);
    if (!anchorKey) return;
    return anchors.follow(followId, JSON.parse(anchorKey) as MapAnchor, place);
  }, [anchors, anchorKey, followId, box.width, box.height]);
  return (
    <div
      ref={ref}
      id={id}
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute -translate-x-1/2 -translate-y-full",
        className,
      )}
      style={{ display: "none" }}
    >
      {children}
    </div>
  );
};
