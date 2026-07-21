import { describe, expect, it } from "vitest";
import type { NormalizedSectorTile } from "@/libs/sector-map/types";
import { findGlobalTravelDestination } from "@/libs/travel";

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
  it("lands on the center tile", () => {
    expect(findGlobalTravelDestination(makeMap(26, 26))).toEqual({ x: 13, y: 13 });
  });

  it("uses a nearby walkable tile when the center is blocked", () => {
    const destination = findGlobalTravelDestination(
      makeMap(5, 5, new Set(["2,2"])),
    );

    expect(destination).not.toEqual({ x: 0, y: 0 });
    expect(destination).not.toBeNull();
    expect(
      Math.max(
        Math.abs((destination?.x ?? 0) - 2),
        Math.abs((destination?.y ?? 0) - 2),
      ),
    ).toBe(1);
  });
});
