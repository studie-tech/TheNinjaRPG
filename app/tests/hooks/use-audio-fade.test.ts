import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { renderHook } from "@testing-library/react";
import { useAudio } from "@/hooks/useAudio";

type FakeAudio = {
  src: string;
  paused: boolean;
  volume: number;
  removed: boolean;
  [key: string]: unknown;
};
const created: FakeAudio[] = [];
const realAudio = globalThis.Audio;

beforeEach(() => {
  created.length = 0;
  vi.useFakeTimers();
  globalThis.Audio = class {
    src = "";
    paused = true;
    volume = 1;
    removed = false;
    loop = false;
    preload = "";
    constructor() {
      created.push(this as unknown as FakeAudio);
    }
    addEventListener() {}
    removeEventListener() {}
    async play() {
      this.paused = false;
    }
    pause() {
      this.paused = true;
    }
    load() {}
    removeAttribute() {
      this.removed = true;
    }
  } as unknown as typeof Audio;
});
afterEach(() => {
  vi.useRealTimers();
  globalThis.Audio = realAudio;
});

const options = { autoPlay: false, enabled: false };

it("fades a playing track out instead of cutting it when the track changes", () => {
  const hook = renderHook(({ src }) => useAudio({ ...options, src }), {
    initialProps: { src: "battle.mp3" },
  });
  const first = created[0]!;
  first.paused = false;
  first.volume = 0.5;
  hook.rerender({ src: "village.mp3" });
  expect(first.paused).toBe(false);
  vi.advanceTimersByTime(300);
  expect(first.volume).toBeLessThan(0.5);
  expect(first.volume).toBeGreaterThan(0);
  expect(first.removed).toBe(false);
  vi.advanceTimersByTime(600);
  expect(first.paused).toBe(true);
  expect(first.removed).toBe(true);
});

it("still ends on time where the platform ignores volume changes", () => {
  const hook = renderHook(({ src }) => useAudio({ ...options, src }), {
    initialProps: { src: "battle.mp3" },
  });
  const first = created[0]!;
  first.paused = false;
  first.volume = 0.5;
  Object.defineProperty(first, "volume", { get: () => 0.5, set() {} });
  hook.rerender({ src: "village.mp3" });
  vi.advanceTimersByTime(900);
  expect(first.removed).toBe(true);
});

it("unloads a silent track at once", () => {
  const hook = renderHook(({ src }) => useAudio({ ...options, src }), {
    initialProps: { src: "battle.mp3" },
  });
  hook.rerender({ src: "village.mp3" });
  expect(created[0]?.removed).toBe(true);
});
