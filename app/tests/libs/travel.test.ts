import { describe, expect, it } from "bun:test";
import type { NormalizedSectorTile } from "@/libs/sector-map/types";
import { COMBAT_SECONDS } from "@/libs/combat/constants";
import {
  filterLiveSectorBattleUsers,
  findGlobalTravelDestination,
  getBiomeAtSectorAnchor,
  optimisticGlobalTravelStart,
  SECTOR_BATTLE_STALE_SECONDS,
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
  it("lands in the center of a standard sector", () => {
    expect(findGlobalTravelDestination(makeMap(26, 26))).toEqual({ x: 13, y: 13 });
  });

  it("uses the authored dimensions for a rectangular sector", () => {
    expect(findGlobalTravelDestination(makeMap(9, 5))).toEqual({ x: 4, y: 2 });
  });

  it("includes shaded terrain among landing tiles", () => {
    const map = makeMap(3, 1, new Set(["1,0"]));

    expect(findGlobalTravelDestination(map)).toEqual({ x: 1, y: 0 });
  });

  it("uses the nearest tile to a missing center instead of an edge spawn anchor", () => {
    const map = makeMap(9, 9);
    map.tiles = [makeTile(0, 0), makeTile(4, 3), makeTile(8, 8)];

    expect(findGlobalTravelDestination(map)).toEqual({ x: 4, y: 3 });
  });

  it("returns null when the sector has no tiles", () => {
    expect(findGlobalTravelDestination(makeMap(0, 0))).toBeNull();
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

describe("optimisticGlobalTravelStart", () => {
  it("omits travelFinishAt for instant journeys so arrival cannot race start", () => {
    expect(optimisticGlobalTravelStart(0)).toEqual({ status: "TRAVEL" });
  });

  it("sets a future travelFinishAt when the journey takes time", () => {
    const before = Date.now();
    const patch = optimisticGlobalTravelStart(12);
    expect(patch.status).toBe("TRAVEL");
    expect(patch.travelFinishAt).toBeInstanceOf(Date);
    expect(patch.travelFinishAt?.getTime()).toBeGreaterThanOrEqual(before + 12_000);
    expect(patch.travelFinishAt?.getTime()).toBeLessThanOrEqual(Date.now() + 12_000);
  });
});



describe("filterLiveSectorBattleUsers", () => {
  const users = [
    { userId: "awake", status: "AWAKE", battleId: null },
    { userId: "fighting", status: "BATTLE", battleId: "live" },
    { userId: "knocked-out", status: "BATTLE", battleId: "abandoned" },
    { userId: "orphaned", status: "BATTLE", battleId: null },
  ];

  it("keeps awake players and fighters in live battles", () => {
    expect(
      filterLiveSectorBattleUsers(users, new Set(["live"])).map((u) => u.userId),
    ).toEqual(["awake", "fighting"]);
  });

  it("hides every battle marker when no battle is live", () => {
    expect(filterLiveSectorBattleUsers(users, new Set()).map((u) => u.userId)).toEqual([
      "awake",
    ]);
  });

  it("allows several idle turn timeouts before treating a battle as abandoned", () => {
    expect(SECTOR_BATTLE_STALE_SECONDS).toBeGreaterThanOrEqual(COMBAT_SECONDS * 3);
    expect(SECTOR_BATTLE_STALE_SECONDS).toBeLessThan(60 * 60);
  });
});
