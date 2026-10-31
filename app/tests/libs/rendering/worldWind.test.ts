import { describe, expect, it } from "bun:test";
import { MAX_SMALL_WORLD_WIND, MAX_WORLD_WIND, sampleWorldWind, STILL_WORLD_WIND, worldWindGroup } from "@/libs/rendering/worldWind";

describe("shared world wind", () => {
  it("keeps every phase inside the occlusion broadphase sweep", () => {
    for (const scale of [0.2, 0.8, 1, 1.6, 3.2]) {
      for (let now = 0; now < 30000; now += 137) {
        const gust = sampleWorldWind({ now, delta: 0, reducedMotion: false }, scale);
        for (const [offsets, maximum] of [[gust.large, MAX_WORLD_WIND], [gust.small, MAX_SMALL_WORLD_WIND]] as const) {
          for (const offset of offsets) {
            expect(Math.abs(offset)).toBeLessThanOrEqual(maximum + 1e-6);
          }
        }
      }
    }
  });
  it("keeps small foliage visibly moving at the default phone scale", () => {
    const scale = 390 / 1024 * 1.6;
    const offsets = Array.from({ length: 100 }, (_, index) => sampleWorldWind({ now: index * 100, delta: 0, reducedMotion: false }, scale).small);
    expect(offsets.some((values) => values.some((offset) => offset !== 0))).toBe(true);
  });
  it("advances the shared wind at animation-frame cadence", () => {
    const offsets = Array.from({ length: 60 }, (_, index) => sampleWorldWind({ now: index * 1000 / 60, delta: 1 / 60, reducedMotion: false }, 1));
    expect(new Set(offsets.map((wind) => wind.key)).size).toBeGreaterThanOrEqual(55);
    for (let index = 1; index < offsets.length; index++) {
      const previous = offsets[index - 1]!, current = offsets[index]!;
      for (let phase = 0; phase < 4; phase++)
        expect(Math.abs(current.large[phase]! - previous.large[phase]!)).toBeLessThan(0.06);
    }
  });
  it("uses the same phase buckets for source sprites and shader instance codes", () => {
    for (let index = 0; index < 4; index++) {
      const phase = index * Math.PI / 2;
      expect(worldWindGroup(phase)).toBe(index);
      expect(worldWindGroup(phase, true)).toBe(index + 4);
      expect(worldWindGroup(phase - Math.PI * 2)).toBe(index);
    }
  });
  it("restores the shared stationary pose for reduced motion", () => {
    expect(sampleWorldWind({ now: 8713, delta: 0.016, reducedMotion: true }, 1.6)).toBe(STILL_WORLD_WIND);
    expect([...STILL_WORLD_WIND.large, ...STILL_WORLD_WIND.small]).toEqual(Array(8).fill(0));
  });
});
