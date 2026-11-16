import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import {
  readChosenVisualEffects,
  readRenderQuality,
  readVisualEffects,
  readVisualSettingsKey,
  setRenderQuality,
  setVisualEffect,
  subscribeRenderQuality,
} from "@/libs/visualEffects";

beforeEach(() => localStorage.clear());
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

describe("visual settings key", () => {
  it.each([
    ["an effect in this tab", () => setVisualEffect("shadows", true)],
    ["the quality in this tab", () => setRenderQuality("high")],
    [
      "the quality in another tab",
      () => localStorage.setItem("worldRenderQuality", '"low"'),
    ],
    [
      "an effect in another tab",
      () => localStorage.setItem("showWorldWeather", "false"),
    ],
  ])("changes when %s changes", (_, change) => {
    const before = readVisualSettingsKey();
    expect(readVisualSettingsKey()).toBe(before);
    change();
    expect(readVisualSettingsKey()).not.toBe(before);
  });
});
