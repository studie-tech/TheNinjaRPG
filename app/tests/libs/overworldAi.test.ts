import { describe, expect, it } from "vitest";
import { isPlaceableSector, resolveOverworldPosition } from "@/libs/overworldAi";
import {
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
    // rng=0 would map to sector 0; ensure a reserved sector is skipped to a placeable one
    const pos = resolveOverworldPosition(
      { ...cfg, sectorType: "random", locationType: "random" },
      () => 0,
    );
    expect(isPlaceableSector(pos.sector)).toBe(true);
  });
});
