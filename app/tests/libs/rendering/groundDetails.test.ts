import alea from "alea";
import { describe, expect, it } from "bun:test";
import { SECTOR_MAP_VERSION } from "@/drizzle/constants";
import type { VillageStructure } from "@/drizzle/schema";
import { MAX_SECTOR_GROUND_DETAILS, sectorSpriteDescriptions } from "@/libs/rendering/sectorSprites";
import { WORLD_STRUCTURE_ART } from "@/libs/rendering/worldStructures";
import { WORLD_UNDERSTORY } from "@/libs/rendering/worldArt";
import { getWorldStructureEntrance, resolveWorldStructure } from "@/libs/rendering/worldStructures";
import { prepareSectorGrid } from "@/libs/sector-map/sector-grid";
import { DECORATION_ASSETS_BY_KEY } from "@/libs/sector-map/decorations";
import { mergeTerrainSpecs } from "@/libs/sector-map/terrains";
import type { NormalizedSectorMap } from "@/libs/sector-map/types";
import { getVillageWallDecorationClearanceKeys, getVillageWallFoundationKeys } from "@/libs/sector-map/village-walls";

const fixture = (biome: "ground" | "snow" | "dessert" = "ground", size = 32) => {
  const map: NormalizedSectorMap = {
    formatVersion: SECTOR_MAP_VERSION, sector: 887, name: "Ground cover", width: size, height: size,
    tiles: Array.from({ length: size * size }, (_, index) => {
      const x = index % size, y = Math.floor(index / size), water = x === 16;
      return { x, y, terrain: water ? "ocean" : biome, walkCost: 1, blocked: false, zone: "wilderness", battleBiome: water ? "ocean" : biome, decoration: x < 4 && y < 4 ? false : undefined };
    }),
    objects: Array.from({ length: Math.floor(size / 3) ** 2 }, (_, index) => ({
      id: `tree:${index}`, type: "decoration", x: (index % Math.floor(size / 3)) * 3 + 1, y: Math.floor(index / Math.floor(size / 3)) * 3 + 1,
      assetKey: biome === "snow" ? "tree.snow.pine" : biome === "dessert" ? "cactus.saguaro" : "tree.green.round",
    })),
    anchors: [], exits: [], metadata: { importedAt: "2026-01-01T00:00:00Z", source: "tiled" },
  };
  const structures = [{ id: "hospital", route: "/hospital", hasPage: 1, longitude: 10, latitude: 12,
    image: WORLD_STRUCTURE_ART["akikaze/hospital"]!.sourceImage }] as VillageStructure[];
  const { grid, villageWallPlan: wall } = prepareSectorGrid(1024, alea(1), 1, structures, map, mergeTerrainSpecs([]), "VILLAGE");
  const roads = new Set(Array.from({ length: size }, (_, col) => `${col},8`));
  const render = (lightLayout = false, decorations = DECORATION_ASSETS_BY_KEY) => sectorSpriteDescriptions({ grid, map, structures, wall, roads, decorations, lightLayout });
  return { grid, map, structures, wall, roads, render };
};

describe("small world ground details", () => {
  it.each(["ground", "snow", "dessert"] as const)("keeps %s clusters deterministic and climate appropriate", (biome) => {
    const { grid, render } = fixture(biome);
    const before = grid.toArray().map((tile) => [tile.cost, tile.blocked, tile.spec?.key, structuredClone(tile.authored)]);
    const first = render(), second = render();
    expect(second).toEqual(first);
    const details = first.filter((sprite) => sprite.id.startsWith("ground:"));
    expect(details.length).toBeGreaterThan(300);
    expect(details.length).toBeLessThanOrEqual(MAX_SECTOR_GROUND_DETAILS);
    const frames = WORLD_UNDERSTORY[biome].map((asset) => asset.frame);
    for (const detail of details) {
      expect(frames).toContainEqual(detail.frame);
      expect(detail).toMatchObject({ image: "/world-art/ground-details.webp", nearest: true, small: true, anchorY: 1 });
      const asset = WORLD_UNDERSTORY[biome].find((asset) => JSON.stringify(asset.frame) === JSON.stringify(detail.frame))!;
      if (asset.windAffected) {
        expect(detail.wind).toBeGreaterThanOrEqual(0);
        expect(detail.wind).toBeLessThan(2 * Math.PI);
        expect(detail.shadowCaster).toBe("canopy");
      } else {
        expect(detail.wind).toBeNull();
        expect(detail.shadowCaster).toBeUndefined();
      }
      expect(detail.size).toBeLessThanOrEqual(grid.toArray()[0]!.height * 0.4);
    }
    expect(grid.toArray().map((tile) => [tile.cost, tile.blocked, tile.spec?.key, structuredClone(tile.authored)])).toEqual(before);
    expect(render(true).some((sprite) => sprite.id.startsWith("ground:"))).toBe(false);
  });

  it("clears roads, water, map opt-outs, wall foundations, gate approaches and service stairs", () => {
    const { grid, wall, structures, roads, render } = fixture();
    const reserved = new Set([
      ...getVillageWallFoundationKeys(wall!),
      ...getVillageWallDecorationClearanceKeys({ edges: wall!.edges.filter((edge) => edge.kind === "gate") }),
    ]);
    const structure = structures[0]!, site = grid.getHex({ col: structure.longitude, row: structure.latitude })!;
    const art = resolveWorldStructure(structure.image, structure.route)!;
    const entrance = getWorldStructureEntrance(site, site.height * art.height, art);
    const details = render().filter((sprite) => sprite.id.startsWith("ground:"));
    for (const detail of details) {
      const tile = grid.pointToHex({ x: detail.x, y: detail.groundY })!;
      const key = `${tile.col},${tile.row}`;
      expect(tile.spec).toBeDefined();
      expect(tile.spec?.isWater).toBe(false);
      expect(tile.hasStructure).not.toBe(true);
      expect(tile.authored?.decoration).not.toBe(false);
      expect(roads.has(key)).toBe(false);
      expect(reserved.has(key)).toBe(false);
      expect(Math.abs(detail.x - entrance.x) < entrance.width / 2 && detail.groundY < entrance.y && detail.groundY > entrance.y - site.height * 0.9).toBe(false);
    }
  });

  it("keeps creator tree artwork authoritative without adding a stock root cluster", () => {
    const { render } = fixture();
    const custom = new Map(DECORATION_ASSETS_BY_KEY);
    custom.set("tree.green.round", { ...custom.get("tree.green.round")!, filepath: "custom-tree.png" });
    expect(render().some((sprite) => sprite.id.startsWith("ground:understory:"))).toBe(true);
    const scenery = render(false, custom);
    expect(scenery.some((sprite) => sprite.image === "custom-tree.png")).toBe(true);
    expect(scenery.some((sprite) => sprite.id.startsWith("ground:understory:"))).toBe(false);
  });

  it("caps the static detail budget on large sectors", () => {
    const { render } = fixture("ground", 64);
    const details = render().filter((sprite) => sprite.id.startsWith("ground:"));
    expect(details.length).toBeGreaterThan(300);
    expect(details.length).toBeLessThanOrEqual(MAX_SECTOR_GROUND_DETAILS);
  });

  it("carries unequal microclusters into the far sector margins before applying the budget", () => {
    const { grid, map, render } = fixture("ground", 64);
    map.objects = [];
    const details = render().filter((sprite) => sprite.id.startsWith("ground:"));
    const rows = details.map((sprite) => grid.pointToHex({ x: sprite.x, y: sprite.groundY })!.row);
    expect(Math.min(...rows)).toBeLessThan(16);
    expect(Math.max(...rows)).toBeGreaterThan(48);
    const groups = new Map<string, typeof details>();
    for (const detail of details) {
      const key = detail.id.slice(0, detail.id.lastIndexOf(":"));
      const members = groups.get(key) ?? [];
      members.push(detail);
      groups.set(key, members);
    }
    const microclusters = [...groups.values()].filter((members) => members.length >= 3);
    expect(microclusters.length).toBeGreaterThan(5);
    expect(microclusters.filter((members) => Math.max(...members.map((sprite) => sprite.size)) / Math.min(...members.map((sprite) => sprite.size)) > 1.3).length).toBeGreaterThan(5);
    expect(details.length).toBeLessThanOrEqual(MAX_SECTOR_GROUND_DETAILS);
  });
});
