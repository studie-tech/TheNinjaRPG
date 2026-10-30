import { describe, expect, it, vi } from "bun:test";
import { Graphics, Sprite } from "pixi.js";
import { createTravelPath } from "@/libs/rendering/scenes/travelPath";

const frame = (now: number, reducedMotion = false) => ({ now, delta: 0.016, reducedMotion });
const fixture = () => {
  const path = createTravelPath();
  const ribbon = path.container.getChildByLabel("travel-path-ribbon") as Graphics;
  const destination = path.container.getChildByLabel("travel-path-destination") as Graphics;
  const motes = path.container.children.filter((child) => child instanceof Sprite) as Sprite[];
  return { ...path, ribbon, destination, motes };
};

describe("travel route ribbon", () => {
  it("follows fractional feet, rounds bends and retains the actual destination", () => {
    const path = fixture(), draw = vi.spyOn(path.ribbon, "poly");
    try {
      path.set([{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 }], 40);
      path.animate(frame(100), { x: 0, y: 0 });
      const points = draw.mock.calls.at(-1)?.[0] as number[];
      expect(points.slice(0, 2)).toEqual([0, 0]);
      expect(points.slice(-2)).toEqual([40, 20]);
      expect(points.length).toBeGreaterThan(6);
      expect(points.every(Number.isFinite)).toBe(true);
      expect(draw.mock.calls[0]?.[0]).toEqual(draw.mock.calls[1]?.[0]);
      expect(path.destination.position).toMatchObject({ x: 40, y: 20 });
      path.animate(frame(200), { x: 12.375, y: 0.625 });
      expect((draw.mock.calls.at(-1)?.[0] as number[]).slice(0, 2)).toEqual([12.375, 0.625]);
      expect(path.container.visible).toBe(true);
    } finally { draw.mockRestore(); path.container.destroy({ children: true }); }
  });

  it("moves a fixed pool of motes toward the target without rebuilding a stationary ribbon", () => {
    const path = fixture(), draw = vi.spyOn(path.ribbon, "poly");
    try {
      path.set([{ x: 0, y: 0 }, { x: 10000, y: 0 }], 40);
      path.animate(frame(100), { x: 0, y: 0 });
      const first = path.motes[0]!.x, last = path.motes.at(-1)!.x;
      path.animate(frame(200), { x: 0, y: 0 });
      expect(path.motes[0]!.x).toBeGreaterThan(first);
      expect(last).toBeGreaterThan(9000);
      expect(path.motes).toHaveLength(24);
      expect(draw).toHaveBeenCalledTimes(2);
    } finally { draw.mockRestore(); path.container.destroy({ children: true }); }
  });

  it("freezes decorative motion while still following the live origin for reduced motion", () => {
    const path = fixture();
    try {
      path.set([{ x: 0, y: 0 }, { x: 100, y: 20 }], 40);
      path.animate(frame(100, true), { x: 0, y: 0 });
      const positions = path.motes.map((mote) => [mote.x, mote.y]);
      path.animate(frame(1000, true), { x: 0, y: 0 });
      expect(path.motes.map((mote) => [mote.x, mote.y])).toEqual(positions);
      expect(path.destination.alpha).toBe(1);
      path.animate(frame(1100, true), { x: 2.25, y: 0.75 });
      expect(path.motes[0]!.position).toMatchObject({ x: 2.25, y: 0.75 });
    } finally { path.container.destroy({ children: true }); }
  });

  it("hides cancelled, unavailable and completed routes without retaining old geometry", () => {
    const path = fixture();
    try {
      path.set([{ x: 50, y: 20 }], 40);
      path.animate(frame(100), { x: 0, y: 0 });
      expect(path.container.visible).toBe(true);
      path.set([], 40);
      path.animate(frame(200), { x: 0, y: 0 });
      expect(path.container.visible).toBe(false);
      path.set([{ x: 50, y: 20 }], 40);
      path.animate(frame(300), undefined);
      expect(path.container.visible).toBe(false);
      path.animate(frame(400), { x: 50, y: 20 });
      expect(path.container.visible).toBe(false);
    } finally { path.container.destroy({ children: true }); }
  });

  it("retains readable screen widths when zooming out, without rebuilding on unchanged frames", () => {
    const path = fixture(), stroke = vi.spyOn(path.ribbon, "stroke");
    try {
      path.set([{ x: 0, y: 0 }, { x: 100, y: 20 }], 40);
      path.animate(frame(100), { x: 0, y: 0 }, 2);
      path.animate(frame(200), { x: 0, y: 0 }, 0.25);
      const core = stroke.mock.calls.at(-1)?.[0] as { width: number };
      expect(core.width * 0.25).toBeCloseTo(1.1);
      expect(path.motes[0]!.width * 0.25).toBeCloseTo(1.5);
      expect(path.motes[0]!.height * 0.25).toBeCloseTo(1);
      expect(path.destination.scale.x * 40 * 0.09 * 0.25).toBeCloseTo(3);
      path.animate(frame(300), { x: 0, y: 0 }, 0.25);
      expect(stroke).toHaveBeenCalledTimes(4);
    } finally { stroke.mockRestore(); path.container.destroy({ children: true }); }
  });
});
