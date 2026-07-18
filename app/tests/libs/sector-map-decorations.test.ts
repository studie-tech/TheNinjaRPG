import alea from "alea";
import { describe, expect, it } from "vitest";
import {
  DECORATION_ASSETS_BY_KEY,
  generateDecorationPlacements,
  TERRAIN_DECORATION_SPECIES,
} from "@/libs/sector-map/decorations";

const makeTile = (
  x: number,
  y: number,
  overrides: Partial<{
    terrain: string;
    zone: string;
    blocked: boolean;
    walkCost: number;
    decoration: boolean;
  }> = {},
) => ({
  x,
  y,
  terrain: "ground",
  zone: "wilderness",
  blocked: false,
  walkCost: 1,
  ...overrides,
});

const makeField = (width: number, height: number) => {
  const tiles = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      tiles.push(makeTile(x, y));
    }
  }
  return tiles;
};

describe("decoration placement generation", () => {
  it("is deterministic for the same seed and differs across seeds", () => {
    const tiles = makeField(10, 10);
    const first = generateDecorationPlacements(alea("seed-a"), tiles);
    const second = generateDecorationPlacements(alea("seed-a"), tiles);
    const other = generateDecorationPlacements(alea("seed-b"), tiles);
    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(0);
    expect(other).not.toEqual(first);
  });

  it("only places assets registered for the tile terrain", () => {
    const tiles = makeField(12, 12);
    const placements = generateDecorationPlacements(alea("terrain-check"), tiles);
    const groundKeys = new Set(
      TERRAIN_DECORATION_SPECIES.ground!.map((species) => species.key),
    );
    placements.forEach((placement) => {
      expect(groundKeys.has(placement.assetKey)).toBe(true);
      expect(DECORATION_ASSETS_BY_KEY.has(placement.assetKey)).toBe(true);
    });
  });

  it("keeps blocked, road, water and decoration-free tiles clear", () => {
    const tiles = [
      makeTile(0, 0, { blocked: true, walkCost: 0 }),
      makeTile(1, 0, { zone: "road" }),
      makeTile(2, 0, { terrain: "ocean", zone: "water" }),
      makeTile(3, 0, { decoration: false }),
      makeTile(4, 0, { terrain: "ocean" }),
    ];
    // Many seeds so a lucky empty roll cannot mask a violation
    for (let attempt = 0; attempt < 25; attempt++) {
      const placements = generateDecorationPlacements(alea(`clear-${attempt}`), tiles);
      expect(placements).toEqual([]);
    }
  });

  it("stores explicit per-object size and horizontal offset", () => {
    const tiles = makeField(14, 14);
    const placements = generateDecorationPlacements(alea("props"), tiles);
    expect(placements.length).toBeGreaterThan(0);
    placements.forEach((placement) => {
      const species = TERRAIN_DECORATION_SPECIES.ground!.find(
        (candidate) => candidate.key === placement.assetKey,
      );
      expect(species).toBeDefined();
      if (!species) return;
      expect(placement.scale).toBeGreaterThanOrEqual(
        species.scale - species.scaleVariation,
      );
      expect(placement.scale).toBeLessThanOrEqual(
        species.scale + species.scaleVariation,
      );
      expect(Math.abs(placement.offsetX)).toBeLessThanOrEqual(
        species.posVariation / 2 + 0.005,
      );
    });
  });

  it("every species references a registered decoration asset", () => {
    Object.values(TERRAIN_DECORATION_SPECIES).forEach((speciesList) => {
      speciesList.forEach((species) => {
        expect(DECORATION_ASSETS_BY_KEY.has(species.key)).toBe(true);
      });
    });
  });
});
