import { describe, expect, it } from "vitest";
import {
  isPlaceableSector,
  resolveOverworldPosition,
  snapOverworldPositionToWalkable,
} from "@/libs/overworldAi";
import type { NormalizedSectorMap } from "@/libs/sector-map/types";
import {
  MAP_TOTAL_SECTORS,
  MAP_WAKE_ISLAND_SECTOR,
  SECTOR_HEIGHT,
  SECTOR_WIDTH,
} from "@/drizzle/constants";

describe("isPlaceableSector", () => {
  it("rejects reserved sectors", () => {
    expect(isPlaceableSector(MAP_WAKE_ISLAND_SECTOR)).toBe(false);
  });
  it("accepts a normal sector", () => {
    expect(isPlaceableSector(10)).toBe(true);
  });
});

describe("resolveOverworldPosition", () => {
  const cfg = {
    sectorType: "specific" as const,
    locationType: "specific" as const,
    sector: 10,
    longitude: 3,
    latitude: 4,
    sectorList: [] as number[],
  };

  it("returns fixed coordinates unchanged for specific/specific", () => {
    expect(resolveOverworldPosition(cfg)).toEqual({ sector: 10, longitude: 3, latitude: 4 });
  });

  it("re-randomizes the tile within bounds for locationType random", () => {
    const pos = resolveOverworldPosition({ ...cfg, locationType: "random" }, () => 0.99);
    expect(pos.sector).toBe(10);
    expect(pos.longitude).toBeLessThan(SECTOR_WIDTH);
    expect(pos.latitude).toBeLessThan(SECTOR_HEIGHT);
  });

  it("picks a sector from the list for from_list", () => {
    const pos = resolveOverworldPosition(
      { ...cfg, sectorType: "from_list", locationType: "random", sectorList: [11, 12, 13] },
      () => 0,
    );
    expect(pos.sector).toBe(11);
  });

  it("never resolves to a reserved sector in random mode", () => {
    // Land on the reserved sector first, then verify the bounded scan advances past it.
    const reservedRoll = () => (MAP_WAKE_ISLAND_SECTOR + 0.25) / MAP_TOTAL_SECTORS;
    const pos = resolveOverworldPosition(
      { ...cfg, sectorType: "random", locationType: "random" },
      reservedRoll,
    );
    expect(isPlaceableSector(pos.sector)).toBe(true);
    expect(pos.sector).toBe((MAP_WAKE_ISLAND_SECTOR + 1) % MAP_TOTAL_SECTORS);
  });

  it("falls back to a placeable sector when from_list holds only reserved sectors", () => {
    // List and the fixed fallback are both reserved → resolver must still pick a placeable one
    const pos = resolveOverworldPosition(
      {
        ...cfg,
        sectorType: "from_list",
        sector: MAP_WAKE_ISLAND_SECTOR,
        sectorList: [MAP_WAKE_ISLAND_SECTOR],
      },
      () => 0,
    );
    expect(isPlaceableSector(pos.sector)).toBe(true);
  });

  it("never pins a specific NPC to a reserved sector", () => {
    // An admin-chosen reserved sector must be rerouted to a placeable one, matching the
    // exclusion the random/from_list branches already enforce.
    const pos = resolveOverworldPosition(
      { ...cfg, sectorType: "specific", sector: MAP_WAKE_ISLAND_SECTOR },
      () => 0,
    );
    expect(isPlaceableSector(pos.sector)).toBe(true);
  });
});

describe("snapOverworldPositionToWalkable", () => {
  const map = {
    width: 2,
    height: 1,
    anchors: [],
    tiles: [
      { x: 0, y: 0, blocked: true, walkCost: 0 },
      { x: 1, y: 0, blocked: false, walkCost: 1 },
    ],
  } as unknown as NormalizedSectorMap;

  it("moves a blocked roll to the nearest walkable tile", () => {
    expect(
      snapOverworldPositionToWalkable(
        { sector: 10, longitude: 0, latitude: 0 },
        map,
      ),
    ).toEqual({ sector: 10, longitude: 1, latitude: 0 });
  });

  it("returns null when a sector map has no walkable tile", () => {
    const blocked = {
      ...map,
      tiles: [{ x: 0, y: 0, blocked: true, walkCost: 0 }],
      width: 1,
    } as unknown as NormalizedSectorMap;
    expect(
      snapOverworldPositionToWalkable(
        { sector: 10, longitude: 0, latitude: 0 },
        blocked,
      ),
    ).toBeNull();
  });
});
