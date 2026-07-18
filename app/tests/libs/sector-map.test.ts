import { describe, expect, it } from "vitest";
import { SECTOR_MAP_VERSION } from "@/drizzle/constants";
import { mergeTerrainSpecs } from "@/libs/sector-map/terrains";
import { hexTileToPixel, normalizeTiledSectorMap } from "@/libs/sector-map/tiled";
import { toWysiwygTiledJson } from "@/libs/sector-map/tiled-download";
import type {
  NormalizedSectorMap,
  NormalizedSectorTile,
} from "@/libs/sector-map/types";
import {
  isReachableCoordinate,
  validateNormalizedSectorMap,
} from "@/libs/sector-map/validation";

const makeTestTile = (
  x: number,
  y: number,
  overrides: Partial<NormalizedSectorTile> = {},
): NormalizedSectorTile => ({
  x,
  y,
  terrain: "ground",
  walkCost: 1,
  blocked: false,
  zone: "wilderness",
  battleBiome: "ground",
  ...overrides,
});

const makeTestMap = (
  width: number,
  height: number,
  tiles: NormalizedSectorTile[],
): NormalizedSectorMap => ({
  formatVersion: SECTOR_MAP_VERSION,
  sector: 1,
  name: "Test Sector",
  width,
  height,
  tiles,
  objects: [],
  anchors: [{ key: "spawn.default", x: 0, y: 0 }],
  exits: [],
  metadata: { importedAt: "2026-01-01T00:00:00.000Z", source: "tiled" },
});

describe("sector map normalization", () => {
  it("normalizes a finite hexagonal Tiled map into the stored format", () => {
    const result = normalizeTiledSectorMap({
      terrainRegistry: mergeTerrainSpecs([]),
      sector: 12,
      name:"Authored Test Sector",
      sourceHash: "test-hash",
      tiledJson: {
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
            tiles: [
              {
                id: 0,
                type: "ground",
                properties: [
                  { name: "terrain", value: "ground" },
                  { name: "zone", value: "road" },
                ],
              },
              {
                id: 1,
                type: "ice",
                properties: [
                  { name: "terrain", value: "ice" },
                  { name: "battleBiome", value: "snow" },
                ],
              },
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
            data: [1, 1, 2, 1],
          },
          {
            id: 2,
            name: "objects",
            type: "objectgroup",
            objects: [
              {
                id: 1,
                name: "spawn.default",
                type: "anchor",
                x: 0,
                y: 0,
              },
              {
                id: 2,
                name: "east exit",
                type: "exit",
                // Centre of hex (1,1) in the odd-q stagger layout:
                // x = 1*48 + 32, y = 1*56 + 28 (odd col) + 28
                x: 80,
                y: 112,
                properties: [
                  { name: "anchorKey", value: "exit.east" },
                  { name: "targetSector", value: 13 },
                  { name: "targetAnchor", value: "spawn.default" },
                  { name: "travelCost", value: 3 },
                ],
              },
            ],
          },
        ],
      },
    });

    expect(result.errors).toEqual([]);
    expect(result.map).toBeDefined();
    expect(result.map?.tiles).toHaveLength(4);
    expect(result.map?.tiles[0]).toMatchObject({
      x: 0,
      y: 0,
      terrain: "ground",
      zone: "road",
      battleBiome: "ground",
    });
    expect(result.map?.tiles[2]).toMatchObject({
      x: 0,
      y: 1,
      terrain: "ice",
      battleBiome: "snow",
    });
    expect(result.map?.anchors).toEqual(
      expect.arrayContaining([
        { key: "spawn.default", x: 0, y: 0 },
        { key: "exit.east", x: 1, y: 1 },
      ]),
    );
    expect(result.map?.exits).toEqual([
      {
        fromAnchor: "exit.east",
        targetSector: 13,
        targetAnchor: "spawn.default",
        travelCost: 3,
      },
    ]);
  });

  it("rejects maps containing an exit with an invalid target sector", () => {
    // The object-level error must reject the whole import - previously it was
    // collected but dropped, silently importing the map without the exit
    const result = normalizeTiledSectorMap({
      terrainRegistry: mergeTerrainSpecs([]),
      sector: 12,
      name: "Bad Exit",
      tiledJson: {
        orientation: "hexagonal",
        width: 1,
        height: 1,
        tilewidth: 64,
        tileheight: 56,
        tilesets: [
          {
            firstgid: 1,
            tiles: [
              { id: 0, type: "ground", properties: [{ name: "terrain", value: "ground" }] },
            ],
          },
        ],
        layers: [
          { name: "terrain", type: "tilelayer", width: 1, height: 1, data: [1] },
          {
            name: "objects",
            type: "objectgroup",
            objects: [
              { id: 1, name: "spawn.default", type: "anchor", x: 0, y: 0 },
              {
                id: 2,
                name: "bad exit",
                type: "exit",
                x: 0,
                y: 0,
                properties: [
                  { name: "anchorKey", value: "exit.east" },
                  { name: "targetSector", value: 999999 },
                ],
              },
            ],
          },
        ],
      },
    });
    expect(result.map).toBeUndefined();
    expect(
      result.errors.some((error) => error.includes("invalid anchorKey or targetSector")),
    ).toBe(true);
  });

  it("rejects authored maps without a default spawn anchor", () => {
    const result = normalizeTiledSectorMap({
      terrainRegistry: mergeTerrainSpecs([]),
      sector: 12,
      name:"Missing Spawn",
      tiledJson: {
        orientation: "hexagonal",
        width: 1,
        height: 1,
        tilewidth: 64,
        tileheight: 56,
        tilesets: [
          {
            firstgid: 1,
            tiles: [
              {
                id: 0,
                type: "ground",
                properties: [{ name: "terrain", value: "ground" }],
              },
            ],
          },
        ],
        layers: [
          {
            name: "terrain",
            type: "tilelayer",
            width: 1,
            height: 1,
            data: [1],
          },
        ],
      },
    });

    expect(result.map).toBeUndefined();
    expect(result.errors).toContain("Missing required anchor spawn.default");
  });

  it("treats blocked authored tiles as path barriers", () => {
    const narrowMap = makeTestMap(3, 1, [
      makeTestTile(0, 0),
      makeTestTile(1, 0, { blocked: true, walkCost: 0 }),
      makeTestTile(2, 0),
    ]);

    expect(isReachableCoordinate(narrowMap, { x: 0, y: 0 }, { x: 2, y: 0 })).toBe(
      false,
    );
    expect(isReachableCoordinate(narrowMap, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(
      true,
    );
  });

  it("normalizes decoration objects with their authored size and offset", () => {
    const result = normalizeTiledSectorMap({
      terrainRegistry: mergeTerrainSpecs([]),
      sector: 12,
      name:"Decorated Sector",
      tiledJson: {
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
            tiles: [{ id: 0, type: "ground", properties: [] }],
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
              { id: 1, name: "spawn.default", type: "anchor", x: 0, y: 0 },
              {
                id: 2,
                name: "tree.green.round",
                type: "decoration",
                x: 96,
                y: 84,
                properties: [
                  { name: "gridX", type: "int", value: 1 },
                  { name: "gridY", type: "int", value: 1 },
                  { name: "assetKey", type: "string", value: "tree.green.round" },
                  { name: "scale", type: "float", value: 2.35 },
                  { name: "offsetX", type: "float", value: -0.08 },
                ],
              },
            ],
          },
        ],
      },
    });

    expect(result.errors).toEqual([]);
    const decoration = result.map?.objects.find((o) => o.type === "decoration");
    expect(decoration).toMatchObject({
      type: "decoration",
      x: 1,
      y: 1,
      assetKey: "tree.green.round",
      scale: 2.35,
      offsetX: -0.08,
    });
  });

  it("re-imports identically after the Tiled export adds a tileset image (lossless download)", () => {
    const baseTiledJson = {
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
          tiles: [
            {
              id: 0,
              type: "ground",
              properties: [{ name: "terrain", value: "ground" }],
            },
            {
              id: 1,
              type: "ocean",
              properties: [
                { name: "terrain", value: "ocean" },
                { name: "zone", value: "water" },
                { name: "blocked", value: true },
                { name: "walkCost", value: 0 },
              ],
            },
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
          data: [1, 2, 1, 1],
        },
        {
          id: 2,
          name: "objects",
          type: "objectgroup",
          objects: [
            { id: 1, name: "spawn.default", type: "anchor", x: 0, y: 0 },
            {
              id: 2,
              name: "tree.green.round",
              type: "decoration",
              x: 0,
              y: 56,
              properties: [
                { name: "gridX", type: "int", value: 0 },
                { name: "gridY", type: "int", value: 1 },
                { name: "assetKey", type: "string", value: "tree.green.round" },
              ],
            },
          ],
        },
      ],
    };
    const before = normalizeTiledSectorMap({
      terrainRegistry: mergeTerrainSpecs([]),
      sector: 5,
      name: "S5",
      tiledJson: baseTiledJson,
    });

    // Mimic downloadSectorForTiled: point the terrain tileset at a generated
    // image. The importer must ignore these image fields entirely.
    const exported = JSON.parse(JSON.stringify(baseTiledJson));
    Object.assign(exported.tilesets[0], {
      image: "terrain.png",
      imagewidth: 128,
      imageheight: 56,
      columns: 2,
      tilecount: 2,
    });
    const after = normalizeTiledSectorMap({
      terrainRegistry: mergeTerrainSpecs([]),
      sector: 5,
      name: "S5",
      tiledJson: exported,
    });

    expect(before.errors).toEqual([]);
    expect(after.errors).toEqual([]);
    expect(after.map?.tiles).toEqual(before.map?.tiles);
    expect(after.map?.objects).toEqual(before.map?.objects);
    expect(after.map?.anchors).toEqual(before.map?.anchors);
  });

  it("accepts Tiled 1.9+ 'class' field in place of object 'type'", () => {
    const result = normalizeTiledSectorMap({
      terrainRegistry: mergeTerrainSpecs([]),
      sector: 3,
      name: "S3",
      tiledJson: {
        orientation: "hexagonal",
        width: 1,
        height: 1,
        tilewidth: 64,
        tileheight: 56,
        tilesets: [
          {
            firstgid: 1,
            tiles: [
              { id: 0, type: "ground", properties: [{ name: "terrain", value: "ground" }] },
            ],
          },
        ],
        layers: [
          { name: "terrain", type: "tilelayer", width: 1, height: 1, data: [1] },
          {
            name: "objects",
            type: "objectgroup",
            objects: [
              { id: 1, name: "spawn.default", class: "anchor", x: 0, y: 0 },
              {
                id: 2,
                name: "tree.green.round",
                class: "decoration",
                x: 0,
                y: 0,
                properties: [
                  { name: "assetKey", type: "string", value: "tree.green.round" },
                ],
              },
            ],
          },
        ],
      },
    });
    expect(result.errors).toEqual([]);
    expect(result.map?.anchors).toEqual([{ key: "spawn.default", x: 0, y: 0 }]);
    const deco = result.map?.objects.find((o) => o.type === "decoration");
    expect(deco?.assetKey).toBe("tree.green.round");
  });
});

describe("creator-added terrain and decorations", () => {
  const TILE_W = 64;
  const TILE_H = 56;
  const toPixelX = (x: number) => hexTileToPixel(x, 0).x;
  const toPixelY = (x: number, y: number) => hexTileToPixel(x, y).y;

  const baseMap = (extraTilesetTiles: unknown[], objects: unknown[], data: number[]) => ({
    version: "1.10",
    orientation: "hexagonal",
    infinite: false,
    width: 4,
    height: 4,
    tilewidth: TILE_W,
    tileheight: TILE_H,
    tilesets: [
      {
        firstgid: 1,
        name: "terrain",
        tiles: [
          {
            id: 0,
            type: "ground",
            properties: [{ name: "terrain", value: "ground" }],
          },
          ...extraTilesetTiles,
        ],
      },
      {
        firstgid: 100,
        name: "decorations",
        tiles: [
          {
            id: 0,
            type: "decoration",
            image: "decorations/tree.green.round.png",
            properties: [
              { name: "assetKey", type: "string", value: "tree.green.round" },
            ],
          },
        ],
      },
    ],
    layers: [
      {
        id: 1,
        name: "terrain",
        type: "tilelayer",
        width: 4,
        height: 4,
        data,
      },
      {
        id: 2,
        name: "objects",
        type: "objectgroup",
        objects: [
          { id: 1, name: "spawn.default", type: "anchor", x: 0, y: 0 },
          ...objects,
        ],
      },
    ],
  });

  it("imports an Insert Tile object with Tiled's empty type via the tileset tile class", () => {
    // Tiled writes `"type": ""` for objects placed with Insert Tile; the empty
    // string must fall through to the tileset tile's "decoration" class, not
    // short-circuit the fallback chain and import as a landmark (whose render
    // path would treat the bare assetKey as a texture URL and show nothing).
    const towerObject = {
      id: 77,
      name: "",
      type: "",
      gid: 100,
      x: TILE_W * 0.75 * 2 + TILE_W / 2,
      y: TILE_H * 2 + TILE_H / 2,
      width: 75,
      height: 75,
    };
    const result = normalizeTiledSectorMap({
      terrainRegistry: mergeTerrainSpecs([]),
      sector: 7,
      name: "Insert Tile",
      tiledJson: baseMap([], [towerObject], Array(16).fill(1)),
    });
    expect(result.errors).toEqual([]);
    const deco = result.map?.objects.find((o) => o.id === "77");
    expect(deco?.type).toBe("decoration");
    expect(deco?.assetKey).toBe("tree.green.round");
  });

  it("normalizes a mirrored WYSIWYG kit map identically to the game-convention raw", () => {
    // Distinctive content: a second terrain painted at game cell (1, 0), plus a
    // gid decoration at cell (2, 1) with a sub-tile nudge (+16px, +10px) and a
    // Tiled resize (140px). Mirroring for the kit (rows reversed + staggerindex
    // "even") and re-importing must produce the exact same normalized map.
    const gameMap = baseMap(
      [{ id: 1, type: "ocean", properties: [{ name: "terrain", value: "ocean" }] }],
      [
        {
          id: 50,
          name: "",
          type: "",
          gid: 100,
          x: TILE_W * 0.75 * 2 + TILE_W / 2 + 16,
          y: TILE_H * 1 + TILE_H / 2 + TILE_H / 2 + 10,
          width: 75,
          height: 140,
        },
        // Native-size placement: must stay default-sized through the mirror
        {
          id: 51,
          name: "",
          type: "",
          gid: 100,
          x: TILE_W * 0.75 * 1 + TILE_W / 2,
          y: TILE_H * 2 + TILE_H / 2 + TILE_H / 2,
          width: 75,
          height: 75,
        },
      ],
      [1, 2, ...Array(14).fill(1)],
    ) as unknown as { tilesets: { firstgid: number; tiles: { id: number; imageheight?: number }[] }[] };
    const decoSet = gameMap.tilesets.find((t) => t.firstgid === 100);
    if (decoSet?.tiles[0]) decoSet.tiles[0].imageheight = 75;
    const registry = mergeTerrainSpecs([]);
    const direct = normalizeTiledSectorMap({
      terrainRegistry: registry,
      sector: 7,
      name: "Direct",
      tiledJson: gameMap,
    });
    const mirrored = toWysiwygTiledJson(gameMap);
    expect(mirrored.staggerindex).toBe("even");
    // The kit ships the game's squashed-hex cell aspect (64x~28), with sprite
    // pixel sizes rescaled so size-in-tiles is preserved
    expect(mirrored.tileheight).toBe(28);
    const mirroredObj = (
      (mirrored.layers as { type: string; objects?: { id: number; height?: number }[] }[])
        .find((l) => l.type === "objectgroup")
        ?.objects ?? []
    ).find((o) => o.id === 50);
    expect(mirroredObj?.height).toBeCloseTo(140 * (28 / 56), 1);
    const viaKit = normalizeTiledSectorMap({
      terrainRegistry: registry,
      sector: 7,
      name: "Mirrored",
      tiledJson: mirrored,
    });
    expect(direct.errors).toEqual([]);
    expect(viaKit.errors).toEqual([]);
    // Terrain must land on the same game cells
    const terrainOf = (r?: { map?: { tiles: { x: number; y: number; terrain: string }[] } }) =>
      r?.map?.tiles.map((t) => `${t.x},${t.y}:${t.terrain}`).sort();
    expect(terrainOf(viaKit)).toEqual(terrainOf(direct));
    // The decoration keeps its cell, offsets and size across the mirror
    const a = direct.map?.objects.find((o) => o.id === "50");
    const b = viaKit.map?.objects.find((o) => o.id === "50");
    expect(b?.x).toBe(a?.x);
    expect(b?.y).toBe(a?.y);
    expect(b?.offsetX ?? 0).toBeCloseTo(a?.offsetX ?? 0, 2);
    expect(b?.offsetY ?? 0).toBeCloseTo(a?.offsetY ?? 0, 2);
    expect(b?.scale).toBe(a?.scale);
    // The native-size object keeps default sizing (scale undefined) and its
    // cell/offsets across the mirror
    const na = direct.map?.objects.find((o) => o.id === "51");
    const nb = viaKit.map?.objects.find((o) => o.id === "51");
    expect(na?.scale).toBeUndefined();
    expect(nb?.scale).toBeUndefined();
    expect(nb?.x).toBe(na?.x);
    expect(nb?.y).toBe(na?.y);
    expect(nb?.offsetX ?? 0).toBeCloseTo(na?.offsetX ?? 0, 2);
    expect(nb?.offsetY ?? 0).toBeCloseTo(na?.offsetY ?? 0, 2);
  });

  it("derives sprite size from a Tiled-resized tile-object; native size keeps the default", () => {
    // baseMap's decoration tile has no imageheight, so give it one via a second
    // tileset: native 75px sprites; one object untouched (75px -> default size),
    // one resized to 200px (-> total scale = 200 / 56 tileheight)
    const map = baseMap([], [], Array(16).fill(1)) as unknown as {
      tilesets: { firstgid: number; tiles: { imageheight?: number }[] }[];
      layers: { type: string; objects?: unknown[] }[];
    };
    const decoSet = map.tilesets.find((t) => t.firstgid === 100);
    if (decoSet?.tiles[0]) decoSet.tiles[0].imageheight = 75;
    const objLayer = map.layers.find((l) => l.type === "objectgroup");
    objLayer?.objects?.push(
      { id: 90, name: "", type: "", gid: 100, x: 100, y: 100, width: 75, height: 75 },
      { id: 91, name: "", type: "", gid: 100, x: 60, y: 100, width: 200, height: 200 },
    );
    const result = normalizeTiledSectorMap({
      terrainRegistry: mergeTerrainSpecs([]),
      sector: 7,
      name: "Resized",
      tiledJson: map,
    });
    expect(result.errors).toEqual([]);
    const untouched = result.map?.objects.find((o) => o.id === "90");
    const resized = result.map?.objects.find((o) => o.id === "91");
    expect(untouched?.scale).toBeUndefined();
    expect(resized?.scale).toBeCloseTo(200 / TILE_H, 2);
  });

  it("preserves Tiled sub-tile positions as WYSIWYG offsets", () => {
    // Two copies placed ~20px apart within one hex keep distinct derived
    // offsets so the game renders them exactly where they sit in Tiled,
    // instead of snapping both to the hex centre and stacking them.
    const towerAt = (id: number, x: number) => ({
      id,
      name: "",
      type: "",
      gid: 100,
      x,
      y: TILE_H * 2 + TILE_H / 2,
      width: 75,
      height: 75,
    });
    const result = normalizeTiledSectorMap({
      terrainRegistry: mergeTerrainSpecs([]),
      sector: 7,
      name: "Spread",
      tiledJson: baseMap(
        [],
        [towerAt(77, TILE_W * 0.75 * 2 + 20), towerAt(78, TILE_W * 0.75 * 2 + 40)],
        Array(16).fill(1),
      ),
    });
    expect(result.errors).toEqual([]);
    const [a, b] = (result.map?.objects ?? []).filter((o) => o.type === "decoration");
    expect(a?.offsetX).not.toBe(b?.offsetX);
    // Distinct positions -> no stacking warning
    expect(result.warnings).toEqual([]);
  });

  it("warns when identical decorations sit at the exact same position", () => {
    const towerAt = (id: number) => ({
      id,
      name: "",
      type: "",
      gid: 100,
      x: TILE_W * 0.75 * 2 + 20,
      y: TILE_H * 2 + TILE_H / 2,
      width: 75,
      height: 75,
    });
    const result = normalizeTiledSectorMap({
      terrainRegistry: mergeTerrainSpecs([]),
      sector: 7,
      name: "Stacked",
      tiledJson: baseMap([], [towerAt(77), towerAt(78)], Array(16).fill(1)),
    });
    expect(result.errors).toEqual([]);
    expect(
      result.warnings.some((w) => w.includes("sit at the same position")),
    ).toBe(true);
  });

  it("rescues a decoration stamped onto the terrain layer as an object + warning", () => {
    // Easy Tiled mistake: the stamp tool paints into the active layer, so a
    // decoration picked from the palette can land in the terrain tile-layer.
    // The importer must convert it to a decoration object (not silently drop
    // it) and warn the creator to use the objects layer.
    const data = Array.from({ length: 16 }, (_, i) => (i === 5 ? 100 : 1));
    const result = normalizeTiledSectorMap({
      terrainRegistry: mergeTerrainSpecs([]),
      sector: 7,
      name: "Stamped Decoration",
      tiledJson: baseMap([], [], data),
    });
    expect(result.errors).toEqual([]);
    const rescued = result.map?.objects.find(
      (o) => o.type === "decoration" && o.assetKey === "tree.green.round",
    );
    expect(rescued).toMatchObject({ x: 1, y: 1 });
    expect(result.warnings.some((w) => w.includes("TERRAIN layer"))).toBe(true);
    // The stamped cell keeps no terrain of its own and falls back to ground
    const tile = result.map?.tiles.find((t) => t.x === 1 && t.y === 1);
    expect(tile?.terrain).toBe("ground");
  });

  it("rejects an object whose assetKey is a foreign URL (SSRF/tracking)", () => {
    // A non-decoration object's assetKey becomes a texture URL for every player;
    // a foreign host must be rejected at import so it never persists.
    const evilObject = {
      id: 9,
      name: "landmark.evil",
      type: "landmark",
      x: 0,
      y: 0,
      properties: [{ name: "assetKey", type: "string", value: "https://evil.example/track.png" }],
    };
    const result = normalizeTiledSectorMap({
      terrainRegistry: mergeTerrainSpecs([]),
      sector: 7,
      name: "S7",
      tiledJson: baseMap([], [evilObject], new Array(16).fill(1)),
    });
    expect(result.map).toBeUndefined();
    expect(result.errors.some((e) => e.includes("disallowed asset url"))).toBe(true);
  });

  it("accepts an assetKey on the allowlisted UploadThing CDN", () => {
    const okObject = {
      id: 9,
      name: "landmark.ok",
      type: "landmark",
      x: 0,
      y: 0,
      properties: [
        {
          name: "assetKey",
          type: "string",
          value: "https://uploadthing.b-cdn.net/f/abc123",
        },
      ],
    };
    const result = normalizeTiledSectorMap({
      terrainRegistry: mergeTerrainSpecs([]),
      sector: 7,
      name: "S7",
      tiledJson: baseMap([], [okObject], new Array(16).fill(1)),
    });
    expect(result.errors).toEqual([]);
    expect(result.map).toBeDefined();
  });

  it("rejects a Tiled upload with an abusively large tiles[] array (DoS cap)", () => {
    const map = baseMap([], [], new Array(16).fill(1)) as {
      tilesets: { tiles: unknown[] }[];
    };
    // Blow past the tileset-tiles cap so the schema rejects it before the
    // per-cell property scan can be amplified
    map.tilesets[0]!.tiles = new Array(5000)
      .fill(0)
      .map((_, i) => ({ id: i, properties: [] }));
    const result = normalizeTiledSectorMap({
      terrainRegistry: mergeTerrainSpecs([]),
      sector: 7,
      name: "S7",
      tiledJson: map,
    });
    expect(result.map).toBeUndefined();
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("imports terrain painted from an appended palette tile (water in a dry sector)", () => {
    // Palette tile id 5 = impassable lake water, appended by the download
    const waterTile = {
      id: 5,
      type: "ocean",
      properties: [
        { name: "terrain", value: "ocean" },
        { name: "zone", value: "water" },
        { name: "blocked", value: true },
        { name: "walkCost", value: 0 },
      ],
    };
    // Paint cell (2,1) with the palette tile (gid = firstgid 1 + id 5 = 6)
    const data = new Array(16).fill(1);
    data[1 * 4 + 2] = 6;
    const result = normalizeTiledSectorMap({
      terrainRegistry: mergeTerrainSpecs([]),
      sector: 7,
      name: "S7",
      tiledJson: baseMap([waterTile], [], data),
    });
    expect(result.errors).toEqual([]);
    const painted = result.map?.tiles.find((tile) => tile.x === 2 && tile.y === 1);
    expect(painted).toMatchObject({
      terrain: "ocean",
      zone: "water",
      blocked: true,
      walkCost: 0,
    });
  });

  it("imports a decoration dragged from the palette (gid only, no properties)", () => {
    // Tiled writes dragged tile-objects with just a gid + pixel position
    // (bottom-center anchored); class/assetKey live on the tileset tile
    const evenCol = { id: 2, gid: 100, x: toPixelX(2), y: toPixelY(2, 3) + TILE_H / 2 };
    const oddCol = { id: 3, gid: 100, x: toPixelX(1), y: toPixelY(1, 2) + TILE_H / 2 };
    const result = normalizeTiledSectorMap({
      terrainRegistry: mergeTerrainSpecs([]),
      sector: 7,
      name: "S7",
      tiledJson: baseMap([], [evenCol, oddCol], new Array(16).fill(1)),
    });
    expect(result.errors).toEqual([]);
    const decorations = result.map?.objects.filter((o) => o.type === "decoration");
    expect(decorations).toHaveLength(2);
    expect(decorations?.[0]).toMatchObject({
      assetKey: "tree.green.round",
      x: 2,
      y: 3,
    });
    expect(decorations?.[1]).toMatchObject({
      assetKey: "tree.green.round",
      x: 1,
      y: 2,
    });
  });

  it("snaps hand-moved point objects (no gridX/gridY) to the hex under them", () => {
    const moved = { id: 4, name: "spawn.village", type: "anchor", x: toPixelX(3), y: toPixelY(3, 1) };
    const result = normalizeTiledSectorMap({
      terrainRegistry: mergeTerrainSpecs([]),
      sector: 7,
      name: "S7",
      tiledJson: baseMap([], [moved], new Array(16).fill(1)),
    });
    expect(result.errors).toEqual([]);
    const anchor = result.map?.anchors.find((a) => a.key === "spawn.village");
    expect(anchor).toMatchObject({ x: 3, y: 1 });
  });
});

describe("standard terrain palette", () => {
  // Full-property signature of a terrain tile, matching the fields the dedup
  // compares. Two tiles with the same signature are duplicate palette entries.
  const terrainSignature = (tile: { properties?: { name: string; value: unknown }[] }) => {
    const p = Object.fromEntries((tile.properties ?? []).map((x) => [x.name, x.value]));
    return [
      p.terrain ?? "",
      p.zone ?? "",
      p.blocked === true,
      Number(p.walkCost ?? 1),
      p.battleBiome ?? "",
      p.decoration === false ? "false" : "",
    ].join("|");
  };

  it("appends every missing terrain kind exactly once (idempotent)", async () => {
    const { ensureFullTerrainPalette } = await import(
      "@/libs/sector-map/tiled-download"
    );
    // A realistic generated tile carries battleBiome (the generator always
    // writes it); the ground palette entry must dedup against it.
    const tiles = [
      {
        id: 0,
        type: "ground",
        properties: [
          { name: "terrain", value: "ground" },
          { name: "zone", value: "wilderness" },
          { name: "blocked", value: false },
          { name: "walkCost", value: 1 },
          { name: "battleBiome", value: "ground" },
        ],
      },
    ];
    ensureFullTerrainPalette(tiles, mergeTerrainSpecs([]));
    const count = tiles.length;
    // Plain ground already existed (1), and the rest of the palette is appended:
    // 11 more (built-in terrain variants + road + shore) -> 12 total.
    expect(count).toBe(12);
    // Ocean water is now paintable in this dry sector
    const water = tiles.find((tile) =>
      tile.properties?.some((p) => p.name === "zone" && p.value === "water"),
    );
    expect(water).toBeDefined();
    // Ids are unique and sequential from the existing max
    expect(new Set(tiles.map((t) => t.id)).size).toBe(count);
    // No two tiles describe the same terrain kind (no duplicate palette)
    expect(new Set(tiles.map(terrainSignature)).size).toBe(count);
    // Running again adds nothing
    ensureFullTerrainPalette(tiles, mergeTerrainSpecs([]));
    expect(tiles.length).toBe(count);
  });

  it("does not re-append palette kinds a real map already contains (battleBiome match)", async () => {
    const { ensureFullTerrainPalette } = await import(
      "@/libs/sector-map/tiled-download"
    );
    // A slice of a real generated map: each tile carries battleBiome exactly as
    // the generator emits it. None of these must be duplicated by the palette.
    const tile = (
      id: number,
      terrain: string,
      zone: string,
      blocked: boolean,
      walkCost: number,
      battleBiome: string,
    ) => ({
      id,
      type: terrain,
      properties: [
        { name: "terrain", value: terrain },
        { name: "zone", value: zone },
        { name: "blocked", value: blocked },
        { name: "walkCost", value: walkCost },
        { name: "battleBiome", value: battleBiome },
      ],
    });
    const tiles = [
      tile(0, "ground", "wilderness", false, 1, "ground"),
      tile(1, "ground", "road", false, 1, "ground"),
      tile(2, "ocean", "water", true, 0, "ocean"),
      tile(3, "ocean", "wilderness", false, 3, "ocean"),
    ];
    ensureFullTerrainPalette(tiles, mergeTerrainSpecs([]));
    // The four seed tiles match palette entries and are deduped, so the total is
    // the full palette (12), not 4 + a re-appended full palette (16). This is the
    // guard against the battleBiome-mismatch that duplicated the whole palette.
    expect(tiles.length).toBe(12);
    // and every resulting tile is a distinct terrain kind (no duplicates)
    expect(new Set(tiles.map(terrainSignature)).size).toBe(tiles.length);
  });
});

describe("validateNormalizedSectorMap rejections", () => {
  const registry = mergeTerrainSpecs([]);
  const fullTiles = (w: number, h: number) => {
    const tiles: NormalizedSectorTile[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) tiles.push(makeTestTile(x, y));
    }
    return tiles;
  };
  const validMap = () => makeTestMap(2, 2, fullTiles(2, 2));
  const rejectsWith = (map: NormalizedSectorMap, needle: string) => {
    const result = validateNormalizedSectorMap(map, registry);
    expect(result.success).toBe(false);
    expect(result.errors.some((error) => error.includes(needle))).toBe(true);
  };

  it("accepts a well-formed map", () => {
    expect(validateNormalizedSectorMap(validMap(), registry).success).toBe(true);
  });
  it("rejects an unsupported format version", () => {
    rejectsWith({ ...validMap(), formatVersion: 999 }, "Unsupported sector map format");
  });
  it("rejects a tile-count mismatch", () => {
    rejectsWith(makeTestMap(2, 2, fullTiles(2, 2).slice(0, 3)), "Expected 4 tiles");
  });
  it("rejects a tile outside sector bounds", () => {
    const tiles = fullTiles(2, 2);
    tiles[3] = makeTestTile(5, 5);
    rejectsWith(makeTestMap(2, 2, tiles), "outside sector bounds");
  });
  it("rejects an unsupported terrain", () => {
    const tiles = fullTiles(2, 2);
    tiles[0] = makeTestTile(0, 0, { terrain: "lava" });
    rejectsWith(makeTestMap(2, 2, tiles), "unsupported terrain");
  });
  it("rejects an invalid walk cost", () => {
    const tiles = fullTiles(2, 2);
    tiles[0] = makeTestTile(0, 0, { walkCost: -1 });
    rejectsWith(makeTestMap(2, 2, tiles), "invalid walk cost");
  });
  it("rejects a map with no walkable tiles", () => {
    const tiles = fullTiles(2, 2).map((tile) => ({ ...tile, blocked: true }));
    rejectsWith(makeTestMap(2, 2, tiles), "no walkable tiles");
  });
  it("rejects a missing spawn.default anchor", () => {
    rejectsWith({ ...validMap(), anchors: [{ key: "spawn.other", x: 0, y: 0 }] }, "spawn.default");
  });
  it("rejects an exit referencing a missing anchor", () => {
    rejectsWith(
      {
        ...validMap(),
        exits: [{ fromAnchor: "spawn.ghost", targetSector: 2, targetAnchor: "spawn.default" }],
      },
      "missing anchor",
    );
  });
});

describe("importer layer composition", () => {
  const HFLIP = 0x80000000;
  const spawnObject = { id: 1, name: "spawn.default", type: "anchor", x: 32, y: 28 };

  it("strips gid flip flags before resolving tile properties", () => {
    // Cell (0,0) is ice (terrain tile id 1 -> gid 2) with a horizontal-flip flag
    // set. Without stripping, the huge gid finds no tile and terrain falls back
    // to ground, so a flipped tile silently loses its terrain.
    const result = normalizeTiledSectorMap({
      sector: 1,
      name: "Flip",
      terrainRegistry: mergeTerrainSpecs([]),
      tiledJson: {
        version: "1.10",
        orientation: "hexagonal",
        infinite: false,
        width: 2,
        height: 1,
        tilewidth: 64,
        tileheight: 56,
        tilesets: [
          {
            firstgid: 1,
            name: "terrain",
            tiles: [
              { id: 0, type: "ground", properties: [{ name: "terrain", value: "ground" }] },
              { id: 1, type: "ice", properties: [{ name: "terrain", value: "ice" }] },
            ],
          },
        ],
        layers: [
          { id: 1, name: "terrain", type: "tilelayer", width: 2, height: 1, data: [HFLIP + 2, 1] },
          { id: 2, name: "objects", type: "objectgroup", objects: [spawnObject] },
        ],
      },
    });
    expect(result.errors).toEqual([]);
    const flipped = result.map?.tiles.find((tile) => tile.x === 0 && tile.y === 0);
    expect(flipped?.terrain).toBe("ice");
  });

  it("overlays zone/walkCost from a separate zones layer", () => {
    const result = normalizeTiledSectorMap({
      sector: 1,
      name: "Zones",
      terrainRegistry: mergeTerrainSpecs([]),
      tiledJson: {
        version: "1.10",
        orientation: "hexagonal",
        infinite: false,
        width: 2,
        height: 1,
        tilewidth: 64,
        tileheight: 56,
        tilesets: [
          {
            firstgid: 1,
            name: "terrain",
            tiles: [{ id: 0, type: "ground", properties: [{ name: "terrain", value: "ground" }] }],
          },
          {
            firstgid: 50,
            name: "zones",
            tiles: [
              {
                id: 0,
                properties: [
                  { name: "zone", value: "road" },
                  { name: "walkCost", value: 2 },
                ],
              },
            ],
          },
        ],
        layers: [
          { id: 1, name: "terrain", type: "tilelayer", width: 2, height: 1, data: [1, 1] },
          { id: 2, name: "zones", type: "tilelayer", width: 2, height: 1, data: [50, 0] },
          { id: 3, name: "objects", type: "objectgroup", objects: [spawnObject] },
        ],
      },
    });
    expect(result.errors).toEqual([]);
    const roaded = result.map?.tiles.find((tile) => tile.x === 0 && tile.y === 0);
    const plain = result.map?.tiles.find((tile) => tile.x === 1 && tile.y === 0);
    // The zones layer overrides zone + walkCost where it has a tile...
    expect(roaded?.zone).toBe("road");
    expect(roaded?.walkCost).toBe(2);
    // ...and leaves the terrain-layer defaults where it is empty.
    expect(plain?.zone).toBe("wilderness");
    expect(plain?.terrain).toBe("ground");
  });
});
