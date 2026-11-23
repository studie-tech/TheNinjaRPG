import { describe, expect, it, vi } from "bun:test";
import { createMapAnchors, isOnCanvas, type MapAnchorPoint } from "@/libs/mapAnchors";

const point = (patch: Partial<MapAnchorPoint> = {}): MapAnchorPoint => ({
  x: 100,
  foot: 120,
  top: 80,
  tile: 40,
  width: 400,
  height: 300,
  ...patch,
});
const lemu = { kind: "actor", key: "npc:lemu:0:0" } as const;

describe("map anchors", () => {
  it("tells the scene what overlays hold on to, until they let go", () => {
    const anchors = createMapAnchors();
    const stop = anchors.follow("bubble", lemu, vi.fn());
    expect([...anchors.wanted()].map(([id, { anchor }]) => [id, anchor])).toEqual([
      ["bubble", lemu],
    ]);
    stop();
    expect(anchors.wanted().size).toBe(0);
  });

  it("reports a point when it moves by a pixel, and only then", () => {
    const anchors = createMapAnchors();
    const listener = vi.fn();
    anchors.follow("bubble", lemu, listener);
    anchors.report("bubble", point());
    anchors.report("bubble", point({ x: 100.2 }));
    expect(listener).toHaveBeenCalledTimes(1);
    anchors.report("bubble", point({ x: 104 }));
    anchors.report("bubble", null);
    anchors.report("bubble", null);
    expect(listener.mock.calls.map(([at]) => at?.x ?? null)).toEqual([100, 104, null]);
    expect(anchors.pointOf("bubble")).toBeNull();
  });

  it("gives an overlay that changes its anchor the new point at once", () => {
    const anchors = createMapAnchors();
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = anchors.follow("bubble", lemu, first);
    anchors.report("bubble", point());
    anchors.follow("bubble", { kind: "objective" }, second);
    // The replaced overlay's cleanup leaves the new one following.
    stopFirst();
    anchors.report("bubble", point());
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("asks a scene at rest for a frame when an overlay starts following", () => {
    const anchors = createMapAnchors();
    const invalidate = vi.fn();
    const stop = anchors.onWanted(invalidate);
    anchors.follow("bubble", lemu, vi.fn());
    stop();
    anchors.follow("glow", lemu, vi.fn());
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("knows when a point is off its canvas", () => {
    expect(isOnCanvas(point())).toBe(true);
    expect(isOnCanvas(point({ x: -1 }))).toBe(false);
    expect(isOnCanvas(point({ foot: 301 }))).toBe(false);
  });
});
