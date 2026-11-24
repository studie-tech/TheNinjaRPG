import { expect, it } from "bun:test";
import { MAP_SECTOR_ID_MAX, MAP_WORLD_COLUMNS } from "@/drizzle/constants";
import { getSectorCompassBearing, parseCompassDestination } from "@/libs/travelCompass";

it.each([
  [73, 1, "north", 0],
  [73, 74, "east", 90],
  [73, 145, "south", 180],
  [73, 72, "west", 270],
  [73, 2, "northeast", 45],
  [73, 144, "southwest", 225],
  [MAP_WORLD_COLUMNS - 1, 0, "east", 90],
  [0, MAP_WORLD_COLUMNS - 1, "west", 270],
] as const)("points from %s to %s toward %s", (from, to, direction, angle) => {
  expect(getSectorCompassBearing(from, to)).toEqual({
    direction,
    angle,
    arrived: false,
  });
});

it("recognizes arrival, never wraps latitude, and rejects non-world sectors", () => {
  expect(getSectorCompassBearing(0, 0)?.arrived).toBe(true);
  expect(getSectorCompassBearing(0, MAP_SECTOR_ID_MAX)?.direction).toBe("south");
  expect(getSectorCompassBearing(-1, 0)).toBeNull();
  expect(getSectorCompassBearing(0, MAP_SECTOR_ID_MAX + 1)).toBeNull();
});

it("restores home, villages and sector zero while discarding malformed storage", () => {
  expect(parseCompassDestination({ type: "sector", sector: 0 })).toEqual({
    type: "sector",
    sector: 0,
  });
  expect(parseCompassDestination({ type: "village", villageId: "home" })).toEqual({
    type: "village",
    villageId: "home",
  });
  for (const stored of [
    null,
    "home",
    {},
    { type: "village", villageId: "" },
    { type: "sector", sector: -1 },
    { type: "sector", sector: "5" },
  ]) {
    expect(parseCompassDestination(stored)).toEqual({ type: "home" });
  }
});
