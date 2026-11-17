import { describe, expect, it } from "bun:test";
import { prepareTowerDefenseTerrain } from "@/libs/rendering/scenes/towerDefenseTerrain";

describe("tower defense terrain", () => {
  const size = 29;
  const seeds = ["a", "b", "c", "d", "e", "f"];

  it("keeps ground detail near the density of published sector maps", () => {
    let small = 0;
    for (const seed of seeds)
      small += prepareTowerDefenseTerrain(seed, size).scenery.filter(
        (entry) => entry.small,
      ).length;
    // Sector maps hold about one grass tuft or pebble per five tiles.
    const perTile = small / (seeds.length * size * size);
    expect(perTile).toBeGreaterThan(0.1);
    expect(perTile).toBeLessThan(0.3);
  });

  it("leaves the hero's zone free of anything tall", () => {
    const terrain = prepareTowerDefenseTerrain("zone", size);
    const tall = terrain.scenery.filter((entry) => !entry.small);
    expect(tall.length).toBeGreaterThan(0);
    // Hex rows sit three quarters of a hex apart, so the zone's nine rows reach past six units.
    for (const entry of tall)
      expect(
        Math.max(
          Math.abs(entry.x - terrain.center.x),
          Math.abs(entry.groundY - terrain.center.y),
        ),
      ).toBeGreaterThan(6 * terrain.unitPx);
  });
});
