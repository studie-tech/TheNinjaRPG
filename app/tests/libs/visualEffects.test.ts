import { afterEach, describe, expect, it, vi } from "bun:test";
import { sessionRenderQuality } from "@/libs/rendering/renderQuality";
import {
  readChosenVisualEffects,
  readRenderQuality,
  readVisualEffects,
  setRenderQuality,
  setVisualEffect,
  subscribeRenderQuality,
} from "@/libs/visualEffects";

afterEach(() => {
  localStorage.clear();
  sessionRenderQuality.clear();
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

describe("rejected quality steps", () => {
  it.each([
    ["an effect", () => setVisualEffect("shadows", true)],
    ["the quality", () => setRenderQuality("high")],
  ])("are forgotten when %s changes while no scene is mounted", (_, change) => {
    const level = { resolution: 2, disabled: [] };
    sessionRenderQuality.set("travel", {
      level,
      patience: 10,
      resolutionFloor: 2,
      ineffectiveEffects: ["shadows"],
    });
    change();
    expect(sessionRenderQuality.get("travel")).toEqual({
      level,
      patience: 10,
      resolutionFloor: 1,
      ineffectiveEffects: [],
    });
  });
});
