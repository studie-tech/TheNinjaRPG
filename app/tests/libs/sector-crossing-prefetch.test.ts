import { describe, expect, it } from "vitest";
import { SECTOR_HEIGHT, SECTOR_WIDTH } from "@/drizzle/constants";
import { sectorIdAt } from "@/libs/sector-map/world-grid";
import {
  getSectorNeighborIds,
  publishedMapsToPrefetchForMove,
} from "@/server/utils/sectorMap";

describe("publishedMapsToPrefetchForMove", () => {
  const sector = 1631; // Shirohana: ordinary grid neighbors
  const neighbors = getSectorNeighborIds(sector);

  it("fetches only the current sector for an in-bounds step", () => {
    expect(publishedMapsToPrefetchForMove(sector, { x: 5, y: 5 })).toEqual([sector]);
  });

  it("includes the west neighbour when dest is x=-1", () => {
    expect(publishedMapsToPrefetchForMove(sector, { x: -1, y: 5 })).toEqual([
      sector,
      neighbors.west,
    ]);
  });

  it("includes the south neighbour when dest is y=-1", () => {
    expect(publishedMapsToPrefetchForMove(sector, { x: 5, y: -1 })).toEqual([
      sector,
      neighbors.south,
    ]);
  });

  it("includes the east neighbour when dest is the default map width", () => {
    expect(
      publishedMapsToPrefetchForMove(sector, { x: SECTOR_WIDTH, y: 5 }),
    ).toEqual([sector, neighbors.east]);
  });

  it("includes the north neighbour when dest is the default map height", () => {
    expect(
      publishedMapsToPrefetchForMove(sector, { x: 5, y: SECTOR_HEIGHT }),
    ).toEqual([sector, neighbors.north]);
  });

  it("does not prefetch a diagonal step beyond two borders", () => {
    expect(publishedMapsToPrefetchForMove(sector, { x: -1, y: -1 })).toEqual([sector]);
  });

  it("does not treat the last in-bounds default tile as a crossing", () => {
    expect(
      publishedMapsToPrefetchForMove(sector, {
        x: SECTOR_WIDTH - 1,
        y: SECTOR_HEIGHT - 1,
      }),
    ).toEqual([sector]);
  });

  it("leaves a non-default authored width to the sequential fallback", () => {
    // A 20-wide map crosses at x=20, which is still in-bounds on the default size.
    expect(publishedMapsToPrefetchForMove(sector, { x: 20, y: 5 })).toEqual([sector]);
  });

  it("does not prefetch a polar gap", () => {
    const northPolar = sectorIdAt(10, 0);
    expect(northPolar).toBeGreaterThanOrEqual(0);
    expect(getSectorNeighborIds(northPolar).north).toBe(-1);
    expect(
      publishedMapsToPrefetchForMove(northPolar, { x: 5, y: SECTOR_HEIGHT }),
    ).toEqual([northPolar]);
  });
});
