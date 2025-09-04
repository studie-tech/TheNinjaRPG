import { describe, it, expect } from "vitest";
import { calcGlobalTravelTime } from "@/libs/travel/controls";
import { WAKE_ISLAND_SECTOR } from "@/libs/travel/constants";
import type { GlobalMapData } from "@/libs/travel/types";

const mockMap: GlobalMapData = {
  radius: 100,
  tiles: [
    {
      // Sector 0
      c: { x: 100, y: 0, z: 0 },
      b: [{ x: 0, y: 0, z: 0 }],
      t: 1,
    },
    {
      // Sector 1
      c: { x: 0, y: 100, z: 0 },
      b: [{ x: 0, y: 0, z: 0 }],
      t: 1,
    },
  ],
};

describe("calcGlobalTravelTime", () => {
  it("caps global travel time to a maximum of 10 seconds", () => {
    const secs = calcGlobalTravelTime(0, 1, mockMap);
    expect(secs).toBeLessThanOrEqual(10);
    expect(secs).toBe(10);
  });

  it("returns 0 seconds for instant travel to Wake Island", () => {
    const secs = calcGlobalTravelTime(0, WAKE_ISLAND_SECTOR, mockMap);
    expect(secs).toBe(0);
  });
});
