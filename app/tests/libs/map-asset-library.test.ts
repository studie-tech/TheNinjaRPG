import { describe, expect, it } from "vitest";
import {
  DECORATION_ASSETS,
  DECORATION_ASSETS_BY_KEY,
  mergeDecorationAssets,
  resolveDecorationAsset,
} from "@/libs/sector-map/decorations";
import { mergeTerrainSpecs } from "@/libs/sector-map/terrains";
import { normalizeTiledSectorMap } from "@/libs/sector-map/tiled";
import { addDecorationTileset, type SpriteFile } from "@/libs/sector-map/tiled-download";

const sprite = (key: string, width = 64, height = 96): SpriteFile => ({
  key,
  fileName: `decorations/${key}.png`,
  bytes: new ArrayBuffer(1),
  width,
  height,
  renderScale: 1,
});

describe("decoration asset registry merge", () => {
  it("overlays DB rows over the built-ins, DB winning on key collisions", () => {
    const builtin = DECORATION_ASSETS[0]!;
    const merged = mergeDecorationAssets([
      {
        key: builtin.key,
        imageUrl: "https://cdn.example/reskinned.png",
        windAffected: false,
        small: false,
        randomRotation: true,
        renderScale: 1,
      },
      {
        key: "custom.statue",
        imageUrl: "https://cdn.example/statue.png",
        windAffected: false,
        small: false,
        randomRotation: false,
        renderScale: 1,
      },
    ]);
    expect(merged.get(builtin.key)?.filepath).toBe("https://cdn.example/reskinned.png");
    expect(merged.get(builtin.key)?.randomRotation).toBe(true);
    expect(merged.get("custom.statue")?.filepath).toBe("https://cdn.example/statue.png");
    // Untouched built-ins remain
    expect(merged.size).toBe(DECORATION_ASSETS_BY_KEY.size + 1);
    const other = DECORATION_ASSETS[1]!;
    expect(merged.get(other.key)).toEqual(other);
  });

  it("resolves decoration objects through the provided registry", () => {
    const registry = mergeDecorationAssets([
      {
        key: "custom.statue",
        imageUrl: "https://cdn.example/statue.png",
        windAffected: true,
        small: false,
        randomRotation: false,
        renderScale: 1,
      },
    ]);
    expect(resolveDecorationAsset({ assetKey: "custom.statue" }, registry)).toMatchObject(
      { filepath: "https://cdn.example/statue.png", windAffected: true },
    );
    expect(resolveDecorationAsset({ assetKey: "no.such.key" }, registry)).toBeUndefined();
  });
});

describe("WYSIWYG decoration tileset export", () => {
  const baseMap = () => ({
    version: "1.10",
    orientation: "hexagonal",
    infinite: false,
    width: 2,
    height: 2,
    tilewidth: 64,
    tileheight: 56,
    tilesets: [
      {
        firstgid: 1,
        name: "terrain",
        tilecount: 3,
        tiles: [
          { id: 0, type: "ground", properties: [{ name: "terrain", value: "ground" }] },
        ],
      },
    ],
    layers: [
      {
        id: 1,
        name: "terrain",
        type: "tilelayer",
        width: 2,
        height: 2,
        data: [1, 1, 1, 1],
      },
      {
        id: 2,
        name: "objects",
        type: "objectgroup",
        objects: [
          { id: 1, name: "spawn.default", type: "anchor", point: true, x: 32, y: 28 },
          {
            id: 2,
            name: "tree.green.round",
            type: "decoration",
            point: true,
            x: 96,
            y: 84,
            properties: [
              { name: "gridX", type: "int", value: 1 },
              { name: "gridY", type: "int", value: 1 },
              { name: "assetKey", type: "string", value: "tree.green.round" },
              { name: "scale", type: "float", value: 2 },
            ],
          },
        ],
      },
    ],
  });

  it("adds a collection tileset and turns decorations into sized gid tile-objects", () => {
    const map = baseMap() as unknown as Record<string, unknown>;
    const tilesets = map.tilesets as Record<string, unknown>[];
    addDecorationTileset(map, tilesets, [sprite("tree.green.round", 50, 100)], 56);

    const deco = tilesets.find((set) => set.name === "decorations");
    expect(deco).toBeDefined();
    // firstgid sits above the terrain tileset's id range (1 + 3)
    expect(deco?.firstgid).toBe(4);
    expect(deco?.objectalignment).toBe("bottom");
    expect((deco?.tiles as unknown[]).length).toBe(1);

    const layers = map.layers as Record<string, unknown>[];
    const objects = layers[1]?.objects as Record<string, unknown>[];
    const treeObject = objects.find((object) => object.type === "decoration");
    expect(treeObject?.gid).toBe(4);
    expect(treeObject?.point).toBeUndefined();
    // height = scale (2) x hex height (56); square like the game renders
    expect(treeObject?.height).toBe(112);
    expect(treeObject?.width).toBe(112);
    // grounded on the hex: y dropped by half a hex from the centre
    expect(treeObject?.y).toBeCloseTo(84 + 56 * (0.5 - 0.2), 1);
    // anchors untouched
    const anchor = objects.find((object) => object.type === "anchor");
    expect(anchor?.gid).toBeUndefined();
    expect(anchor?.point).toBe(true);
  });

  it("keeps the import lossless after the WYSIWYG rewrite", () => {
    const original = baseMap();
    const exported = baseMap() as unknown as Record<string, unknown>;
    addDecorationTileset(
      exported,
      exported.tilesets as Record<string, unknown>[],
      [sprite("tree.green.round")],
      56,
    );
    const before = normalizeTiledSectorMap({
      terrainRegistry: mergeTerrainSpecs([]),
      sector: 7,
      name: "S7",
      tiledJson: original,
    });
    const after = normalizeTiledSectorMap({
      terrainRegistry: mergeTerrainSpecs([]),
      sector: 7,
      name: "S7",
      tiledJson: exported,
    });
    expect(before.errors).toEqual([]);
    expect(after.errors).toEqual([]);
    expect(after.map?.tiles).toEqual(before.map?.tiles);
    expect(after.map?.objects).toEqual(before.map?.objects);
    expect(after.map?.anchors).toEqual(before.map?.anchors);
  });

  it("skips unknown decorations, leaving them as point objects", () => {
    const map = baseMap() as unknown as Record<string, unknown>;
    const tilesets = map.tilesets as Record<string, unknown>[];
    addDecorationTileset(map, tilesets, [sprite("some.other.sprite")], 56);
    const layers = map.layers as Record<string, unknown>[];
    const objects = layers[1]?.objects as Record<string, unknown>[];
    const treeObject = objects.find((object) => object.type === "decoration");
    expect(treeObject?.gid).toBeUndefined();
    expect(treeObject?.point).toBe(true);
  });
});
