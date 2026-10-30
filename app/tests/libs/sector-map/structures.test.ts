import { describe, expect, it } from "bun:test";
import { WAR_SHRINE_IMAGE_BY_BIOME } from "@/drizzle/constants";
import { worldAssetSource } from "@/libs/rendering/worldAssetSources";
import { WORLD_STRUCTURE_ART, resolveWorldStructure } from "@/libs/rendering/worldStructures";
import { createShrineStructure } from "@/libs/sector-map/structures";
import type { NormalizedSectorMap } from "@/libs/sector-map/types";

const makeMap = (sector = 90_000): NormalizedSectorMap => ({
  formatVersion: 1,
  sector,
  name: "Shrine sector",
  width: 3,
  height: 3,
  tiles: [{ x: 1, y: 2, terrain: "ground", battleBiome: "ground", walkCost: 1, blocked: false, zone: "shrine" }],
  objects: [],
  anchors: [{ key: "shrine.default", x: 1, y: 2 }],
  exits: [],
  metadata: { importedAt: "2026-01-01T00:00:00Z", source: "tiled" },
});

describe("sector shrine structures", () => {
  it.each(Object.values(WORLD_STRUCTURE_ART).filter((art) => art.route === "/shrine"))(
    "uses matching architecture and materials in $village",
    (art) => {
      const shrine = createShrineStructure(makeMap(art.sector), 0);
      expect(shrine.image).toBe(art.sourceImage);
      expect(resolveWorldStructure(shrine.image, shrine.route)).toBe(art);
    },
  );

  it.each(["ground", "dessert", "ice", "snow", "ocean"] as const)(
    "matches wilderness %s terrain with independently loadable shrine art",
    (terrain) => {
      const map = makeMap();
      map.tiles[0]!.terrain = terrain;
      const shrine = createShrineStructure(map, 3);
      expect(shrine.image).toBe(WAR_SHRINE_IMAGE_BY_BIOME[terrain]);
      const art = resolveWorldStructure(shrine.image, shrine.route)!;
      expect(art).toBeDefined();
      expect(art.frame.width).toBe(256);
      expect(worldAssetSource(art.filepath)?.frames).toEqual([[0, 0, art.frame.width, art.frame.height]]);
      expect(art.material).toBeTruthy();
      expect(art.surfaces).toBeTruthy();
    },
  );

  it("shares a stable picking identity and authored position without changing the map", () => {
    const map = makeMap(), before = structuredClone(map);
    for (let i = 0; i < 2; i++) {
      expect(createShrineStructure(map, 1)).toMatchObject({ id: "sector-shrine", longitude: 1, latitude: 2, hasPage: 1, route: "/shrine" });
    }
    expect(map).toEqual(before);
  });

  it.each([[0, "ocean"], [1, "ground"], [2, "dessert"], [3, "ice"]] as const)(
    "uses the globe biome and default placement without an anchor (tile type %i)",
    (type, biome) => {
      const map = makeMap();
      map.anchors = [];
      expect(createShrineStructure(map, type)).toMatchObject({ image: WAR_SHRINE_IMAGE_BY_BIOME[biome], longitude: 10, latitude: 5 });
    },
  );
});
