import { afterEach, beforeEach, describe, expect, it, mock, spyOn, vi } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import { createElement, useEffect } from "react";
import { LayoutParticles } from "@/components/layout/shared/LayoutParticles";
import * as mediaQuery from "@/hooks/useMediaQuery";
import { setGameSceneVisible } from "@/libs/gameSceneVisibility";

const container = {
  animationStatus: true,
  destroyed: false,
  particles: { count: 200 },
  pause: vi.fn(function pause() {
    container.animationStatus = false;
  }),
  play: vi.fn(function play() {
    container.animationStatus = true;
  }),
};
let frame: FrameRequestCallback = () => {};
const scene = {};

mock.module("@tsparticles/react", () => ({
  default: ({ particlesLoaded }: { particlesLoaded: (value: unknown) => void }) => {
    useEffect(() => {
      particlesLoaded(container);
    }, [particlesLoaded]);
    return createElement("div", { id: "particles" });
  },
  ParticlesProvider: ({ children }: { children: unknown }) => children,
}));

const mountParticles = async () => {
  render(<LayoutParticles />);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
};
const nextFrame = () => {
  act(() => frame(performance.now()));
};

beforeEach(() => {
  container.animationStatus = true;
  container.pause.mockClear();
  container.play.mockClear();
  spyOn(mediaQuery, "useMediaQuery").mockImplementation((query) =>
    query.includes("min-width"),
  );
  spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frame = callback;
    return 1;
  });
});

afterEach(() => {
  setGameSceneVisible(scene, false);
  cleanup();
  vi.restoreAllMocks();
});

describe("background particles behind game scenes", () => {
  it("pauses within a frame of a scene appearing and resumes when it leaves", async () => {
    await mountParticles();
    nextFrame();
    expect(container.pause).not.toHaveBeenCalled();
    setGameSceneVisible(scene, true);
    nextFrame();
    expect(container.pause).toHaveBeenCalledTimes(1);
    setGameSceneVisible(scene, false);
    expect(container.play).toHaveBeenCalledTimes(1);
  });

  it("pauses particles that start beneath an already visible scene", async () => {
    setGameSceneVisible(scene, true);
    await mountParticles();
    nextFrame();
    expect(container.pause).toHaveBeenCalledTimes(1);
  });

  it("holds the pause when an engine handler restarts playback", async () => {
    await mountParticles();
    setGameSceneVisible(scene, true);
    nextFrame();
    container.animationStatus = true;
    nextFrame();
    expect(container.pause).toHaveBeenCalledTimes(2);
    expect(container.play).not.toHaveBeenCalled();
  });
});
