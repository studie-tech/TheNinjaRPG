/** Something on a map that an overlay holds on to. */
export type MapAnchor =
  /** A character, by its actor key (see `travelActorKey`); it may walk. */
  | { kind: "actor"; key: string }
  /** A tile of the sector map. */
  | { kind: "tile"; sector: number; x: number; y: number }
  /** The viewer's first objective marker. */
  | { kind: "objective" };

/** Where an anchor stands on the map canvas, in its CSS pixels. */
export type MapAnchorPoint = {
  x: number;
  /** The ground it stands on, and the top of what stands there. */
  foot: number;
  top: number;
  /** Height of one tile at the current zoom. */
  tile: number;
  /** The canvas it was measured on. A point outside it is off screen. */
  width: number;
  height: number;
};

/** Takes an anchor's point whenever it moves, or null once it is nowhere on the map. */
export type MapAnchorListener = (point: MapAnchorPoint | null) => void;

/**
 * Connects overlays to a map scene. Overlays subscribe with what they hold on to; the scene
 * reads `wanted` each frame and reports the points that moved. Positions reach the overlays
 * without a React render, so a bubble can follow a running character.
 */
export const createMapAnchors = () => {
  const subscriptions = new Map<
    string,
    { anchor: MapAnchor; listener: MapAnchorListener }
  >();
  const reported = new Map<string, { key: string; point: MapAnchorPoint | null }>();
  const wantedListeners = new Set<() => void>();
  return {
    /** Runs when an overlay starts following, so a scene at rest draws the frame it needs. */
    onWanted: (listener: () => void) => {
      wantedListeners.add(listener);
      return () => wantedListeners.delete(listener);
    },
    /** Every anchor overlays currently hold on to, by the overlay's id. */
    wanted: () => subscriptions as ReadonlyMap<string, { anchor: MapAnchor }>,
    /** Follow an anchor until the returned cleanup runs; an id follows one anchor at a time. */
    follow: (id: string, anchor: MapAnchor, listener: MapAnchorListener) => {
      const entry = { anchor, listener };
      subscriptions.set(id, entry);
      reported.delete(id);
      for (const notify of wantedListeners) notify();
      return () => {
        if (subscriptions.get(id) !== entry) return;
        subscriptions.delete(id);
        reported.delete(id);
      };
    },
    /** Tell an overlay where its anchor is; whole pixels that did not change are skipped. */
    report: (id: string, point: MapAnchorPoint | null) => {
      const key = point
        ? [point.x, point.foot, point.top, point.tile, point.width, point.height]
            .map(Math.round)
            .join(":")
        : "";
      if (reported.get(id)?.key === key) return;
      reported.set(id, { key, point });
      subscriptions.get(id)?.listener(point);
    },
    /** The last point reported for an overlay. */
    pointOf: (id: string) => reported.get(id)?.point ?? null,
  };
};
export type MapAnchors = ReturnType<typeof createMapAnchors>;

/** Whether a point lies on its canvas. */
export const isOnCanvas = (point: MapAnchorPoint) =>
  point.x >= 0 &&
  point.x <= point.width &&
  point.foot >= 0 &&
  point.foot <= point.height;
