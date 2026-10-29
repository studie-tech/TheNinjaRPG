import { describe, expect, it } from "bun:test";
import { createMapControls } from "@/libs/rendering/mapControls";
import type { GameRenderer } from "@/libs/rendering/runtime";
import { ensureDom } from "../../setup/dom.mjs";

ensureDom();
const setup = (zoom = true, pan = false, pointerType = "touch") => {
  const canvas = document.createElement("canvas");
  canvas.getBoundingClientRect = () => new DOMRect(0, 0, 390, 390);
  const listeners = new window.AbortController();
  const taps: number[][] = [], zooms: number[] = [], pans: number[][] = [];
  let enabled = true;
  const controls = createMapControls({ canvas, renderer: { width: 390, height: 390 }, listen: (type: string, callback: EventListener) => canvas.addEventListener(type, callback, { signal: listeners.signal }) } as GameRenderer, {
    enabled: () => enabled, tap: (x, y) => taps.push([x, y]), ...(zoom ? { zoom: (factor: number) => zooms.push(factor) } : {}),
    ...(pan ? { pan: (dx: number, dy: number) => pans.push([dx, dy]) } : {}),
  });
  const event = (type: string, id: number, x: number, y: number, button = 0) => {
    const pointer = new window.MouseEvent(type, { clientX: x, clientY: y, button });
    Object.defineProperties(pointer, { pointerId: { value: id }, pointerType: { value: pointerType } });
    canvas.dispatchEvent(pointer);
  };
  return { canvas, taps, zooms, pans, controls, event, disable: () => { enabled = false; }, dispose: () => listeners.abort() };
};

describe("map gesture ownership", () => {
  it.each(["mouse", "touch"])("pans %s drags after the tap threshold without submitting a tap", (pointerType) => {
    const scene = setup(true, true, pointerType);
    try {
      scene.event("pointerdown", 1, 100, 100);
      scene.event("pointermove", 1, 105, 104);
      expect(scene.pans).toEqual([]); expect(scene.controls.dragging()).toBe(false);
      scene.event("pointermove", 1, 130, 115);
      scene.event("pointermove", 1, 150, 140);
      expect(scene.pans).toEqual([[30, 15], [20, 25]]);
      expect(scene.controls.dragging()).toBe(true);
      scene.event("pointerup", 1, 150, 140);
      expect(scene.controls.dragging()).toBe(false); expect(scene.taps).toEqual([]);
    } finally { scene.dispose(); }
  });
  it("keeps pinch transitions and canceled or disabled gestures out of panning", () => {
    const scene = setup(true, true);
    try {
      scene.event("pointerdown", 1, 100, 100); scene.event("pointerdown", 2, 200, 100);
      scene.event("pointermove", 2, 250, 100); scene.event("pointerup", 2, 250, 100);
      scene.event("pointermove", 1, 50, 100); scene.event("pointerup", 1, 50, 100);
      expect(scene.pans).toEqual([]); expect(scene.zooms).toEqual([1.5]); expect(scene.taps).toEqual([]);
      scene.event("pointerdown", 3, 100, 100); scene.event("lostpointercapture", 3, 100, 100);
      scene.event("pointermove", 3, 150, 100); scene.event("pointerup", 3, 150, 100);
      expect(scene.controls.dragging()).toBe(false); expect(scene.pans).toEqual([]);
      scene.event("pointerdown", 4, 100, 100); scene.disable();
      scene.event("pointermove", 4, 150, 100); scene.event("pointerup", 4, 150, 100);
      expect(scene.pans).toEqual([]); expect(scene.taps).toEqual([]);
    } finally { scene.dispose(); }
  });
  it("converts pan distances to renderer pixels and ignores non-primary mouse buttons", () => {
    const scene = setup(true, true, "mouse");
    try {
      scene.canvas.getBoundingClientRect = () => new DOMRect(0, 0, 195, 195);
      scene.event("pointerdown", 1, 50, 50); scene.event("pointermove", 1, 70, 60); scene.event("pointerup", 1, 70, 60);
      expect(scene.pans).toEqual([[40, 20]]);
      scene.event("pointerdown", 2, 50, 50, 2); scene.event("pointermove", 2, 90, 90, 2); scene.event("pointerup", 2, 90, 90, 2);
      expect(scene.pans).toHaveLength(1); expect(scene.taps).toEqual([]);
    } finally { scene.dispose(); }
  });
  it("releases wheel scrolling without zoom while preserving taps and rejecting multi-touch taps", () => {
    const scene = setup(false);
    try {
      const wheel = new window.WheelEvent("wheel", { deltaY: 420, cancelable: true });
      scene.canvas.dispatchEvent(wheel);
      expect(wheel.defaultPrevented).toBe(false);
      scene.event("pointerdown", 1, 100, 100); scene.event("pointerup", 1, 102, 102);
      expect(scene.taps).toEqual([[102, 102]]);
      scene.event("pointerdown", 2, 100, 100); scene.event("pointerdown", 3, 200, 100);
      scene.event("pointermove", 3, 250, 100); scene.event("pointerup", 3, 250, 100); scene.event("pointerup", 2, 100, 100);
      expect(scene.zooms).toEqual([]);
      expect(scene.taps).toHaveLength(1);
    } finally { scene.dispose(); }
  });
  it("dispatches taps but never dispatches drags that return to their start", () => {
    const scene = setup();
    try {
      scene.event("pointerdown", 1, 100, 100); scene.event("pointerup", 1, 102, 102);
      expect(scene.taps).toEqual([[102, 102]]);
      scene.event("pointerdown", 2, 100, 100); scene.event("pointermove", 2, 150, 100);
      scene.event("pointermove", 2, 100, 100); scene.event("pointerup", 2, 100, 100);
      expect(scene.taps).toHaveLength(1);
    } finally { scene.dispose(); }
  });
  it("zooms pinches without a trailing tap and cancels interrupted touches", () => {
    const scene = setup();
    try {
      scene.event("pointerdown", 1, 100, 100); scene.event("pointerdown", 2, 200, 100);
      scene.event("pointermove", 2, 250, 100); scene.event("pointerup", 2, 250, 100); scene.event("pointerup", 1, 100, 100);
      expect(scene.zooms).toEqual([1.5]); expect(scene.taps).toEqual([]);
      scene.event("pointerdown", 3, 100, 100); scene.event("pointercancel", 3, 100, 100); scene.event("pointerup", 3, 100, 100);
      expect(scene.taps).toEqual([]);
    } finally { scene.dispose(); }
  });
  it("owns wheel zoom while enabled and ignores gestures behind the scouting panel", () => {
    const scene = setup();
    try {
      const wheel = new window.WheelEvent("wheel", { deltaY: -100, cancelable: true });
      scene.canvas.dispatchEvent(wheel);
      expect(wheel.defaultPrevented).toBe(true); expect(scene.zooms[0]).toBeGreaterThan(1);
      scene.disable();
      scene.event("pointerdown", 1, 100, 100); scene.event("pointerup", 1, 100, 100);
      expect(scene.taps).toEqual([]);
    } finally { scene.dispose(); }
  });
});
