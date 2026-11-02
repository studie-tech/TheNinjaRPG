import { describe, expect, it } from "bun:test";
import type { TravelWindowEntry } from "@/libs/rendering/scenes/travel";
import { travelSectorKey } from "@/libs/rendering/scenes/travelData";

const structure = { id: "tower", image: "tower.webp", longitude: 4, latitude: 5, hasPage: 1, lastUpgradedAt: new Date(0) };
const entry = { sector: 724, dx: 0, dy: 0, map: { width: 26, height: 26, metadata: { sourceHash: "v1" } }, structures: [structure], villageType: "VILLAGE", globalTileType: 1 } as unknown as TravelWindowEntry;
const key = (value = entry, version = "v1", light = false) => travelSectorKey(value, version, light, []);

describe("travel sector identity", () => {
  it("retains static content across border crossings and regenerated structure timestamps", () => {
    expect(key({ ...entry, dx: -1, dy: 1, structures: [{ ...entry.structures[0]!, lastUpgradedAt: new Date() }] })).toBe(key());
  });
  it("replaces changed terrain, scenery, layout and library data", () => {
    expect(key({ ...entry, map: { ...entry.map, name: "Revised" } })).not.toBe(key());
    expect(key({ ...entry, structures: [{ ...entry.structures[0]!, image: "new.webp" }] })).not.toBe(key());
    expect(key(entry, "v2")).not.toBe(key());
    expect(key(entry, "v1", true)).not.toBe(key());
  });
  it("invalidates neighboring wall footings while retaining identical cells in any insertion order", () => {
    const a=travelSectorKey(entry,"v1",false,[],new Set(["4,0","5,0"]));
    expect(travelSectorKey(entry,"v1",false,[],new Set(["5,0","4,0"]))).toBe(a);
    expect(travelSectorKey(entry,"v1",false,[],new Set(["6,0"]))).not.toBe(a);
  });
});
