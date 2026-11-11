import { describe, expect, it } from "bun:test";
import { createGlobeControls } from "@/libs/rendering/scenes/globeControls";
import type { GlobeCamera } from "@/libs/rendering/scenes/globeProjection";

const setup = () => {
  const canvas = document.createElement("canvas");
  canvas.getBoundingClientRect = () => new DOMRect(0, 0, 390, 390);
  const listeners = new window.AbortController();
  const cleanups: (() => void)[] = [];
  const taps: [number, number][] = [];
  const camera: GlobeCamera = {
    width: 390,
    height: 390,
    longitude: 0,
    latitude: 0,
    distance: 100,
  };
  const controls = createGlobeControls(
    {
      canvas,
      listen: (type, callback) =>
        canvas.addEventListener(type, callback, { signal: listeners.signal }),
      own: (callback) => {
        cleanups.push(callback);
      },
    },
    camera,
    { min: 50, max: 200, latitude: 1.1 },
    (x, y) => taps.push([x, y]),
  );
  const event = (type: string, id: number, x: number, y: number, button = 0) => {
    const pointer = new window.MouseEvent(type, { clientX: x, clientY: y, button });
    Object.defineProperties(pointer, {
      pointerId: { value: id },
      pointerType: { value: "touch" },
    });
    canvas.dispatchEvent(pointer);
  };
  return {
    canvas,
    event,
    taps,
    camera,
    controls,
    dispose: () => {
      listeners.abort();
      for (const cleanup of cleanups) cleanup();
    },
  };
};

describe("globe gesture ownership", () => {
  it("lets journey follow distinguish manual orbiting from taps and zoom", () => {
    const scene = setup();
    try {
      expect(scene.controls.rotationRevision()).toBe(0);
      scene.controls.zoom(1.1);
      scene.event("pointerdown", 1, 100, 100);
      scene.event("pointerup", 1, 100, 100);
      expect(scene.controls.rotationRevision()).toBe(0);
      scene.event("pointerdown", 2, 100, 100);
      scene.event("pointermove", 2, 140, 120);
      scene.event("pointerup", 2, 140, 120);
      expect(scene.controls.rotationRevision()).toBeGreaterThan(0);
    } finally {
      scene.dispose();
    }
  });
  it.each([-100, 100])("owns wheel zoom for delta %s", (deltaY) => {
    const scene = setup();
    try {
      const wheel = new window.WheelEvent("wheel", { deltaY, cancelable: true });
      scene.canvas.dispatchEvent(wheel);
      expect(wheel.defaultPrevented).toBe(true);
      if (deltaY > 0) expect(scene.camera.distance).toBeGreaterThan(100);
      else expect(scene.camera.distance).toBeLessThan(100);
    } finally {
      scene.dispose();
    }
  });
  it("selects a tap and preserves orbit gestures that return to their starting point", () => {
    const scene = setup();
    try {
      scene.event("pointerdown", 1, 100, 100);
      scene.event("pointerup", 1, 102, 102);
      expect(scene.taps).toEqual([[102, 102]]);
      scene.event("pointerdown", 2, 100, 100);
      scene.event("pointermove", 2, 140, 100);
      scene.event("pointermove", 2, 100, 100);
      scene.event("pointerup", 2, 100, 100);
      expect(scene.taps).toHaveLength(1);
    } finally {
      scene.dispose();
    }
  });
  it("keeps a stationary primary finger in a pinch from selecting a sector", () => {
    const scene = setup();
    try {
      scene.event("pointerdown", 1, 100, 100);
      scene.event("pointerdown", 2, 200, 100);
      scene.event("pointermove", 2, 250, 100);
      expect(scene.camera.distance).toBeLessThan(100);
      scene.event("pointerup", 2, 250, 100);
      scene.event("pointerup", 1, 100, 100);
      expect(scene.taps).toEqual([]);
    } finally {
      scene.dispose();
    }
  });
  it("cancels navigation on pointer cancellation and bounds camera tilt and zoom", () => {
    const scene = setup();
    try {
      scene.event("pointerdown", 1, 100, 100);
      scene.event("pointercancel", 1, 100, 100);
      scene.event("pointerup", 1, 100, 100);
      expect(scene.taps).toEqual([]);
      scene.event("pointerdown", 2, 100, 100);
      scene.event("pointermove", 2, 100, 10000);
      expect(scene.camera.latitude).toBe(1.1);
      scene.controls.zoom(1000);
      expect(scene.camera.distance).toBe(200);
      scene.controls.zoom(0.001);
      expect(scene.camera.distance).toBe(50);
    } finally {
      scene.dispose();
    }
  });
});
