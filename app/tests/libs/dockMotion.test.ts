import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { createDockMotion, getMotionDuration, planMotion } from "@/libs/dockMotion";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";

const atRest = (offset: number) => ({ offset, velocity: 0, acceleration: 0 });

describe("the dock's way to a new place", () => {
  it("speeds up, slows down and stops there without overshooting", () => {
    const motion = planMotion(atRest(600), 700);
    expect(motion(0).offset).toBe(600);
    expect(motion(0).velocity).toBeCloseTo(0);
    expect(motion(350).offset).toBeCloseTo(300);
    expect(motion(700)).toEqual({ offset: 0, velocity: 0, acceleration: 0 });
    const offsets = Array.from({ length: 71 }, (_, i) => motion(i * 10).offset);
    expect(offsets.every((offset) => offset >= -0.001)).toBe(true);
    const steps = offsets.slice(1).map((offset, i) => (offsets[i] ?? 0) - offset);
    expect(steps.indexOf(Math.max(...steps))).toBeGreaterThan(25);
    expect(steps.indexOf(Math.max(...steps))).toBeLessThan(45);
    expect(steps[0]).toBeLessThan(1);
  });

  it("keeps its speed when the place it goes to changes on the way", () => {
    const first = planMotion(atRest(600), 700);
    const then = first(300);
    // The new place is 200px further on.
    const second = planMotion({ ...then, offset: then.offset + 200 }, 600);
    expect(second(0)).toEqual({ ...then, offset: then.offset + 200 });
    const before = then.offset - first(299).offset;
    const after = second(1).offset - second(0).offset;
    expect(Math.abs(after - before)).toBeLessThan(0.05);
    expect(second(600).offset).toBe(0);
  });

  it("takes longer over longer ways, within bounds", () => {
    expect(getMotionDuration(100)).toBeLessThan(getMotionDuration(600));
    expect(getMotionDuration(100_000)).toBe(900);
  });
});

describe("the dock on its way", () => {
  let animate: ReturnType<typeof vi.fn>;
  let dock: HTMLElement;
  let left = 100;
  beforeEach(() => {
    installBrowserGlobals({ resizeObserver: true });
    animate = vi.fn(() => ({ currentTime: 0, cancel: vi.fn() }));
    dock = document.createElement("aside");
    dock.innerHTML = '<div data-dock-panel data-dock-width="420px"></div>';
    dock.animate = animate as never;
    dock.getBoundingClientRect = () => new DOMRect(left, 50, 420, 200);
    document.body.append(dock);
  });
  afterEach(() => {
    dock.remove();
    left = 100;
    restoreBrowserGlobals();
  });
  const move = (motion: ReturnType<typeof createDockMotion>, isOpen = true) => {
    motion.arrive({ isOpen, isPlaced: false });
    motion.leave(isOpen);
    left = 700;
    motion.arrive({ isOpen: true, isPlaced: false });
  };

  it("slides from where it is seen to where it belongs", () => {
    move(createDockMotion(dock));
    expect(animate).toHaveBeenCalledTimes(1);
    const [frames, options] = animate.mock.calls[0] as [
      Keyframe[],
      { duration: number },
    ];
    expect(frames[0]?.translate).toBe("-600px 0px");
    expect(frames.at(-1)?.translate).toBe("0px 0px");
    expect(options.duration).toBe(getMotionDuration(600));
  });

  it("is there at once when it opens, and for players who prefer reduced motion", () => {
    move(createDockMotion(dock), false);
    expect(animate).not.toHaveBeenCalled();
    const matchMedia = window.matchMedia;
    window.matchMedia = (() => ({ matches: true })) as never;
    left = 100;
    try {
      move(createDockMotion(dock));
      expect(animate).not.toHaveBeenCalled();
    } finally {
      window.matchMedia = matchMedia;
    }
  });
});
