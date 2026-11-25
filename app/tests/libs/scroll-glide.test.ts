import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { glideScrollBy } from "@/libs/scrollGlide";

const originals = {
  matchMedia: window.matchMedia,
  request: globalThis.requestAnimationFrame,
  cancel: globalThis.cancelAnimationFrame,
};
let frames: FrameRequestCallback[] = [];
let now = 0;

/** Run the frames of a stretch of time. */
const play = (ms: number) => {
  for (const end = now + ms; now < end; ) {
    now += 16;
    for (const frame of frames.splice(0)) frame(now);
  }
};

/** A 600px window on a page of 2000px. */
const makeScroller = () => {
  const scroller = {
    scrollTop: 100,
    scrollHeight: 2000,
    clientHeight: 600,
    scrollBy: vi.fn(),
    scrollTo: ({ top }: { top: number }) => {
      scroller.scrollTop = Math.max(0, Math.min(1400, top));
    },
  };
  return scroller;
};
const setReducedMotion = (reduced: boolean) => {
  window.matchMedia = (() => ({ matches: reduced })) as never;
};

beforeEach(() => {
  frames = [];
  now = 0;
  globalThis.requestAnimationFrame = (frame) => frames.push(frame);
  globalThis.cancelAnimationFrame = () => {
    frames = [];
  };
  setReducedMotion(false);
});

afterEach(() => {
  window.matchMedia = originals.matchMedia;
  globalThis.requestAnimationFrame = originals.request;
  globalThis.cancelAnimationFrame = originals.cancel;
});

describe("a scroll glide", () => {
  it("gathers speed, settles on its offset and reports its end", () => {
    const scroller = makeScroller();
    const onEnd = vi.fn();
    const glide = glideScrollBy(scroller as never, 400, onEnd);
    play(80);
    const early = scroller.scrollTop - 100;
    expect(early).toBeGreaterThan(0);
    play(80);
    expect(scroller.scrollTop - 100 - early).toBeGreaterThan(early);
    expect(glide.isActive).toBe(true);
    play(900);
    expect(scroller.scrollTop).toBe(500);
    expect(glide.isActive).toBe(false);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("aims no further than the page goes", () => {
    const scroller = makeScroller();
    glideScrollBy(scroller as never, 5000);
    play(1000);
    expect(scroller.scrollTop).toBe(1400);
  });

  it("gives way to a scroll that is not its own", () => {
    const scroller = makeScroller();
    const glide = glideScrollBy(scroller as never, 400);
    play(100);
    scroller.scrollTop = 900;
    play(1000);
    expect(glide.isActive).toBe(false);
    expect(scroller.scrollTop).toBe(900);
  });

  it("goes there at once for a visitor who asks for less motion", () => {
    setReducedMotion(true);
    const scroller = makeScroller();
    const glide = glideScrollBy(scroller as never, 400);
    expect(scroller.scrollBy).toHaveBeenCalledWith({ top: 400, behavior: "auto" });
    expect(glide.isActive).toBe(false);
    expect(frames).toHaveLength(0);
  });
});
