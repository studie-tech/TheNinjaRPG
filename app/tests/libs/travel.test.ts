import { describe, expect, it } from "vitest";
import type { NormalizedSectorTile } from "@/libs/sector-map/types";
import {
  findGlobalTravelDestination,
  getBiomeAtSectorAnchor,
} from "@/libs/travel";

const makeTile = (
  x: number,
  y: number,
  blocked = false,
): NormalizedSectorTile => ({
  x,
  y,
  terrain: "ground",
  walkCost: blocked ? 0 : 1,
  blocked,
  zone: "wilderness",
  battleBiome: "ground",
});

const makeMap = (width: number, height: number, blocked: Set<string> = new Set()) => ({
  width,
  height,
  tiles: Array.from({ length: width * height }, (_, index) => {
    const x = index % width;
    const y = Math.floor(index / width);
    return makeTile(x, y, blocked.has(`${x},${y}`));
  }),
  anchors: [{ key: "spawn.default", x: 0, y: 0 }],
});

describe("findGlobalTravelDestination", () => {
  it("selects a walkable tile using the supplied random sample", () => {
    expect(findGlobalTravelDestination(makeMap(3, 2), () => 3)).toEqual({
      x: 0,
      y: 1,
    });
  });

  it("never selects blocked tiles", () => {
    const map = makeMap(3, 1, new Set(["1,0"]));

    expect(findGlobalTravelDestination(map, () => 0)).toEqual({ x: 0, y: 0 });
    expect(findGlobalTravelDestination(map, () => 1)).toEqual({ x: 2, y: 0 });
  });

  it("returns null when the sector has no walkable tiles", () => {
    expect(
      findGlobalTravelDestination(
        makeMap(2, 2, new Set(["0,0", "1,0", "0,1", "1,1"])),
        () => 0,
      ),
    ).toBeNull();
  });
});

describe("getBiomeAtSectorAnchor", () => {
  it("uses the authored anchor tile instead of a conflicting globe biome", () => {
    const map = makeMap(3, 3);
    map.anchors = [{ key: "shrine.default", x: 1, y: 1 }];
    map.tiles[4] = {
      ...map.tiles[4]!,
      terrain: "dessert",
      battleBiome: "dessert",
    };

    expect(getBiomeAtSectorAnchor(map, "shrine.default", 3)).toBe("dessert");
  });

  it("uses visible terrain instead of an independent combat override", () => {
    const map = makeMap(3, 3);
    map.anchors = [{ key: "shrine.default", x: 1, y: 1 }];
    map.tiles[4] = {
      ...map.tiles[4]!,
      terrain: "dessert",
      battleBiome: "ground",
    };

    expect(getBiomeAtSectorAnchor(map, "shrine.default", 1)).toBe("dessert");
  });

  it("falls back to the globe biome when the anchor is absent", () => {
    expect(getBiomeAtSectorAnchor(makeMap(3, 3), "shrine.default", 3)).toBe(
      "ice",
    );
  });
});
