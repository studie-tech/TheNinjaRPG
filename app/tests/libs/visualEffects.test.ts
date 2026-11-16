import { afterEach, describe, expect, it, vi } from "bun:test";
import {
  readChosenVisualEffects,
  readRenderQuality,
  readVisualEffects,
  setRenderQuality,
  setVisualEffect,
  subscribeRenderQuality,
} from "@/libs/visualEffects";

afterEach(() => localStorage.clear());

describe("visual effect choices", () => {
  it("records only effects the player sets, not defaults materialized from groups", () => {
    readVisualEffects();
    expect(readChosenVisualEffects()).toEqual(new Set());
    setVisualEffect("shadows", true);
    setVisualEffect("weather", false);
    setVisualEffect("shadows", false);
    expect(readChosenVisualEffects()).toEqual(new Set(["shadows", "weather"]));
  });
  it("ignores malformed stored choices", () => {
    localStorage.setItem("worldEffectChoices", '["shadows","bogus"]');
    expect(readChosenVisualEffects()).toEqual(new Set(["shadows"]));
    localStorage.setItem("worldEffectChoices", "{");
    expect(readChosenVisualEffects()).toEqual(new Set());
  });
});

describe("render quality preference", () => {
  it("defaults to auto and publishes changes to subscribers", () => {
    expect(readRenderQuality()).toBe("auto");
    const onChange = vi.fn();
    const unsubscribe = subscribeRenderQuality(onChange);
    setRenderQuality("high");
    unsubscribe();
    setRenderQuality("low");
    expect(onChange.mock.calls).toEqual([["high"]]);
    expect(readRenderQuality()).toBe("low");
    localStorage.setItem("worldRenderQuality", '"ultra"');
    expect(readRenderQuality()).toBe("auto");
  });
});
