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
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

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
    localStorage.setItem("worldEffectChoice:shadows", "true");
    localStorage.setItem("worldEffectChoice:weather", "false");
    localStorage.setItem("worldEffectChoice:wind", "{");
    localStorage.setItem("worldEffectChoice:bogus", "true");
    expect(readChosenVisualEffects()).toEqual(new Set(["shadows"]));
  });
  it("preserves different effect choices when tabs interleave their writes", () => {
    readVisualEffects();
    const setItem = window.Storage.prototype.setItem;
    let interleaved = false;
    vi.spyOn(window.Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      // A second tab chooses weather after the first tab prepares its shadows write.
      if (!interleaved) {
        interleaved = true;
        setVisualEffect("weather", false);
      }
      setItem.call(this, key, value);
    });
    setVisualEffect("shadows", true);
    expect(readChosenVisualEffects()).toEqual(new Set(["shadows", "weather"]));
    expect(readVisualEffects()).toMatchObject({ shadows: true, weather: false });
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
