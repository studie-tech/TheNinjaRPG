import { describe, expect, it } from "bun:test";
import { Graphics, type Mesh, Sprite, Texture } from "pixi.js";
import { createTravelPath } from "@/libs/rendering/scenes/travelPath";

const frame = (now: number, reducedMotion = false) => ({
  now,
  delta: 0.016,
  reducedMotion,
});
const fixture = () => {
  const path = createTravelPath();
  const ribbon = path.container.getChildByLabel("travel-path-ribbon") as Mesh;
  const destination = path.container.getChildByLabel(
    "travel-path-destination",
  ) as Graphics;
  const motes = path.container.children.filter(
    (child) => child instanceof Sprite,
  ) as Sprite[];
  return { ...path, ribbon, destination, motes };
};
const paintedOrigin = (path: ReturnType<typeof fixture>) => {
  const data = path.ribbon.geometry.getBuffer("aPosition").data as Float32Array;
  const offset = path.ribbon.shader!.resources.route.uniforms.uOrigin as Float32Array;
  return [data[0]! + data[7]! * offset[0]!, data[1]! + data[7]! * offset[1]!];
};

describe("travel route ribbon", () => {
  it("keeps an active route visible when its intended path changes", () => {
    const path = fixture();
    try {
      path.set([{ x: 40, y: 0 }], 40);
      path.animate(frame(100), { x: 0, y: 0 });
      expect(path.container.visible).toBe(true);
      path.set([{ x: 80, y: 20 }], 40);
      expect(path.container.visible).toBe(true);
      path.animate(frame(200), { x: 1, y: 0 });
      expect(path.destination.position).toMatchObject({ x: 80, y: 20 });
      path.set([], 40);
      expect(path.container.visible).toBe(false);
    } finally {
      path.dispose();
    }
  });

  it("follows fractional feet around retained bends without rebuilding vertex data", () => {
    const path = fixture();
    try {
      path.set(
        [
          { x: 0, y: 0 },
          { x: 40, y: 0 },
          { x: 40, y: 20 },
        ],
        40,
      );
      path.animate(frame(100), { x: 0, y: 0 });
      const buffer = path.ribbon.geometry.getBuffer("aPosition");
      const data = buffer.data;
      const vertices = Array.from(data);
      expect(paintedOrigin(path)).toEqual([0, 0]);
      expect(vertices.length).toBeGreaterThan(12 * 12);
      expect(vertices.every(Number.isFinite)).toBe(true);
      expect(path.destination.position).toMatchObject({ x: 40, y: 20 });
      path.animate(frame(200), { x: 12.375, y: 0.625 });
      expect(paintedOrigin(path)).toEqual([12.375, 0.625]);
      expect(buffer.data).toBe(data);
      expect(Array.from(buffer.data)).toEqual(vertices);
      expect(path.container.visible).toBe(true);
    } finally {
      path.dispose();
    }
  });

  it("moves a fixed pool of motes toward the target while retaining a stationary ribbon", () => {
    const path = fixture();
    try {
      path.set(
        [
          { x: 0, y: 0 },
          { x: 10000, y: 0 },
        ],
        40,
      );
      path.animate(frame(100), { x: 0, y: 0 });
      const first = path.motes[0]!.x,
        last = path.motes.at(-1)!.x;
      const data = path.ribbon.geometry.getBuffer("aPosition").data;
      path.animate(frame(200), { x: 0, y: 0 });
      expect(path.motes[0]!.x).toBeGreaterThan(first);
      expect(last).toBeGreaterThan(9000);
      expect(path.motes).toHaveLength(12);
      expect(path.ribbon.geometry.getBuffer("aPosition").data).toBe(data);
    } finally {
      path.dispose();
    }
  });

  it("freezes decorative motion while following the live origin for reduced motion", () => {
    const path = fixture();
    try {
      path.set(
        [
          { x: 0, y: 0 },
          { x: 100, y: 20 },
        ],
        40,
      );
      path.animate(frame(100, true), { x: 0, y: 0 });
      const positions = path.motes.map((mote) => [mote.x, mote.y]);
      path.animate(frame(1000, true), { x: 0, y: 0 });
      expect(path.motes.map((mote) => [mote.x, mote.y])).toEqual(positions);
      expect(path.destination.alpha).toBe(1);
      path.animate(frame(1100, true), { x: 2.25, y: 0.75 });
      expect(path.motes[0]!.position).toMatchObject({ x: 2.25, y: 0.75 });
    } finally {
      path.dispose();
    }
  });

  it("hides cancelled, unavailable and completed routes", () => {
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
    } finally {
      path.dispose();
    }
  });

  it("retains readable screen widths at overview zoom through uniforms", () => {
    const path = fixture();
    try {
      path.set(
        [
          { x: 0, y: 0 },
          { x: 100, y: 20 },
        ],
        40,
      );
      path.animate(frame(100), { x: 0, y: 0 }, 2);
      const data = path.ribbon.geometry.getBuffer("aPosition").data;
      path.animate(frame(200), { x: 0, y: 0 }, 0.25);
      const widths = path.ribbon.shader!.resources.route.uniforms
        .uWidths as Float32Array;
      expect(widths[1]! * 2 * 0.25).toBeCloseTo(1.1);
      expect(path.motes[0]!.width * 0.25).toBeCloseTo(1.5);
      expect(path.motes[0]!.height * 0.25).toBeCloseTo(1);
      expect(path.destination.scale.x * 0.25).toBeCloseTo(3);
      path.animate(frame(300), { x: 0, y: 0 }, 0.25);
      expect(path.ribbon.geometry.getBuffer("aPosition").data).toBe(data);
    } finally {
      path.dispose();
    }
  });

  it("keeps a collapsing first segment finite and releases owned geometry once", () => {
    const path = fixture();
    path.set(
      [
        { x: 20, y: 0 },
        { x: 40, y: 0 },
      ],
      40,
    );
    path.animate(frame(0, true), { x: 0, y: 0 });
    path.animate(frame(100, true), { x: 20, y: 0 });
    expect(paintedOrigin(path)).toEqual([20, 0]);
    expect(
      path.motes.every((mote) => Number.isFinite(mote.x) && Number.isFinite(mote.y)),
    ).toBe(true);
    const buffer = path.ribbon.geometry.getBuffer("aPosition");
    path.dispose();
    path.dispose();
    expect(buffer.destroyed).toBe(true);
    expect(Texture.WHITE.destroyed).toBe(false);
  });
});
