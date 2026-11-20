import { describe, expect, it, spyOn } from "bun:test";
import globalMapData from "@/data/hexasphere.json";
import { MAP_RESERVED_SECTORS } from "@/drizzle/constants";
import { isSectorAvailableForHideout } from "@/server/utils/sectorMap";

const tileCount = (globalMapData as unknown as { tiles: unknown[] }).tiles.length;

describe("isSectorAvailableForHideout", () => {
  it("reads the bundled topology without an HTTP self-fetch", () => {
    // Node cannot fetch the relative /api/map/topology URL the browser uses.
    const fetchSpy = spyOn(globalThis, "fetch");
    try {
      expect(isSectorAvailableForHideout(100)).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("rejects reserved sectors", () => {
    for (const sector of MAP_RESERVED_SECTORS) {
      expect(isSectorAvailableForHideout(sector)).toBe(false);
    }
  });

  it("rejects sectors that are not on the globe", () => {
    expect(isSectorAvailableForHideout(-1)).toBe(false);
    expect(isSectorAvailableForHideout(tileCount)).toBe(false);
  });
});
