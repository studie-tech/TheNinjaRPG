import { describe, expect, it } from "bun:test";
import { findTilesetTile } from "@/libs/sector-map/tiled";

const FLIPPED_HORIZONTALLY = 0x80000000;
const low = { id: 2, imageheight: 40 };
const high = { id: 1, imageheight: 90 };
const tilesets = [
  { firstgid: 1, tiles: [low] },
  { firstgid: 10, tiles: [high] },
];

describe("findTilesetTile", () => {
  it("resolves the tileset with the largest firstgid at or below the gid", () => {
    expect(findTilesetTile(tilesets, 3)).toBe(low);
    expect(findTilesetTile(tilesets, 11)).toBe(high);
  });

  it("ignores flip flags, as the map importer and exporter both must", () => {
    expect(findTilesetTile(tilesets, (11 + FLIPPED_HORIZONTALLY) >>> 0)).toBe(high);
  });

  it("has no tile for an empty cell or an undeclared id", () => {
    expect(findTilesetTile(tilesets, 0)).toBeUndefined();
    expect(findTilesetTile(tilesets, 5)).toBeUndefined();
  });
});
