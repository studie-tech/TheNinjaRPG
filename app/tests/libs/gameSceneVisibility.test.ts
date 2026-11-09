import { afterEach, describe, expect, it, vi } from "bun:test";
import {
  isGameSceneVisible,
  setGameSceneVisible,
  subscribeGameSceneVisibility,
} from "@/libs/gameSceneVisibility";

const scenes = [{}, {}];

afterEach(() => {
  for (const scene of scenes) setGameSceneVisible(scene, false);
});

describe("game scene visibility", () => {
  it("stays visible until the last scene leaves and notifies only on transitions", () => {
    const listener = vi.fn();
    const leave = subscribeGameSceneVisibility(listener);
    const [first = {}, second = {}] = scenes;
    setGameSceneVisible(first, true);
    setGameSceneVisible(second, true);
    setGameSceneVisible(first, true);
    expect(isGameSceneVisible()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    setGameSceneVisible(first, false);
    expect(isGameSceneVisible()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    setGameSceneVisible(second, false);
    expect(isGameSceneVisible()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    leave();
    setGameSceneVisible(first, true);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("ignores a scene that was never visible", () => {
    const listener = vi.fn();
    const leave = subscribeGameSceneVisibility(listener);
    setGameSceneVisible({}, false);
    expect(listener).not.toHaveBeenCalled();
    leave();
  });
});
