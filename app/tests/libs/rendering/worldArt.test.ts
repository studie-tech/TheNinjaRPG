import { describe, expect, it } from "bun:test";
import { GROUND_DETAIL_ART, resolveWorldDecoration, resolveWorldTerrain } from "@/libs/rendering/worldArt";
import { CIVIC_STRUCTURES, WOODLAND_STRUCTURES, resolveWorldStructure } from "@/libs/rendering/worldStructures";
import stockImages from "@/libs/rendering/villageBuildingImages.json";
import { DECORATION_ASSETS_BY_KEY } from "@/libs/sector-map/decorations";
import { BUILTIN_TERRAINS_BY_KEY } from "@/libs/sector-map/terrains";

describe("world art skinning", () => {
  it("calibrates stock ground cover without rewriting authored art or its registry", () => {
    const grass = DECORATION_ASSETS_BY_KEY.get("grass.tuft")!;
    const before = structuredClone(grass);
    const art = resolveWorldDecoration(grass);
    expect(art.frame).toBeDefined();
    expect(art.windAffected).toBe(true);
    expect(art.heightScale).toBeLessThan(0.3);
    expect(grass).toEqual(before);
    const ice = resolveWorldDecoration(DECORATION_ASSETS_BY_KEY.get("ice.floe")!);
    expect(ice.randomRotation).toBe(false);
    expect(ice.windAffected).toBe(false);
    expect(resolveWorldDecoration(DECORATION_ASSETS_BY_KEY.get("tree.green.round")!).windAffected).toBe(true);
    expect(resolveWorldDecoration(DECORATION_ASSETS_BY_KEY.get("cactus.saguaro")!).windAffected).toBe(false);
    expect(ice.heightScale).toBeLessThan(0.5);
    const custom = { ...grass, filepath: "custom-grass.png", renderScale: 1.4 };
    expect(resolveWorldDecoration(custom)).toBe(custom);
  });

  it("uses dry stock rock views in the desert while preserving wet and custom artwork", () => {
    for (const key of ["rock.sand", "rock.grey", "rock.slate"]) {
      const asset = DECORATION_ASSETS_BY_KEY.get(key)!;
      const dry = resolveWorldDecoration(asset, "dessert");
      const wet = resolveWorldDecoration(asset, "ground");
      expect(dry.filepath).toBe("/world-art/desert-rocks.webp");
      expect(wet.filepath).toBe("/world-art/biome-scenery.webp");
      expect(dry.heightScale).toBe(wet.heightScale);
      const custom = { ...asset, filepath: "custom-rock.png" };
      expect(resolveWorldDecoration(custom, "dessert")).toBe(custom);
    }
  });

  it("shares sixteen small cutouts across biome-specific stock ground cover", () => {
    expect(GROUND_DETAIL_ART).toHaveLength(16);
    for (const [index, asset] of GROUND_DETAIL_ART.entries()) {
      const { x, y, width, height } = asset.frame!;
      expect(x + width).toBeLessThanOrEqual(192);
      expect(y + height).toBeLessThanOrEqual(192);
      expect(asset.renderScale).toBeLessThanOrEqual(0.36);
      for (const other of GROUND_DETAIL_ART.slice(index + 1)) {
        const frame = other.frame!;
        expect(x + width <= frame.x || frame.x + frame.width <= x || y + height <= frame.y || frame.y + frame.height <= y).toBe(true);
      }
    }
    for (const key of ["grass.tuft", "grass.sprout", "grass.flower", "grass.pebble"]) {
      const stock = DECORATION_ASSETS_BY_KEY.get(key)!;
      const [ground, snow, desert] = ["ground", "snow", "dessert"].map((biome) => resolveWorldDecoration(stock, biome as "ground" | "snow" | "dessert"));
      expect(ground?.filepath).toBe("/world-art/ground-details.webp");
      expect(snow?.frame).not.toEqual(ground?.frame);
      expect(desert?.frame).not.toEqual(ground?.frame);
      expect(desert?.frame).not.toEqual(snow?.frame);
      const custom = { ...stock, filepath: "custom-ground.webp" };
      expect(resolveWorldDecoration(custom, "snow")).toBe(custom);
    }
  });

  it("preserves custom terrain material and movement contracts", () => {
    const grass = BUILTIN_TERRAINS_BY_KEY.get("ground")!;
    const art = resolveWorldTerrain(grass);
    expect(art.colors).not.toEqual(grass.colors);
    expect(art.defaultWalkCost).toBe(grass.defaultWalkCost);
    expect(art.battleBiome).toBe(grass.battleBiome);
    const custom = { ...grass, colors: ["#123456", "#345678", "#567890"] as [string,string,string] };
    expect(resolveWorldTerrain(custom)).toBe(custom);
    const ice = BUILTIN_TERRAINS_BY_KEY.get("ice")!;
    expect(resolveWorldTerrain(ice).depression).toBe(0);
    expect(resolveWorldTerrain({ ...ice, colors: custom.colors }).depression).toBe(ice.depression);
  });

  it("recognizes stock structures across CDN aliases while retaining custom replacements", () => {
    const file = "Hzww9EQvYURJ8PljuOkkp45TvAnoIBa0rtCf1lbyXYjVKQ2q.webp";
    const stock = resolveWorldStructure(`https://ui0arpl8sm.ufs.sh/f/${file}`, "/academy");
    expect(stock?.frame).toBeDefined();
    expect(resolveWorldStructure(`https://uploadthing.b-cdn.net/f/${file}?width=200`, "/academy")).toEqual(stock);
    expect(resolveWorldStructure("https://uploadthing.b-cdn.net/f/custom.webp", "/academy")).toBeUndefined();
    expect(resolveWorldStructure(`https://uploadthing.b-cdn.net/f/${file}`, "/hospital")).toBeUndefined();
  });
  it("maps every civic service to a separate in-bounds atlas view", () => {
    for (const [index, [route, x, y, width, height]] of CIVIC_STRUCTURES.entries()) {
      const source = stockImages[route][0];
      expect(resolveWorldStructure(`https://uploadthing.b-cdn.net/f/${source}.webp`, route)?.filepath).toBe("/world-art/civic-buildings.webp");
      expect(x + width).toBeLessThanOrEqual(1536);
      expect(y + height).toBeLessThanOrEqual(1024);
      for (const [, nx, ny, nw, nh] of CIVIC_STRUCTURES.slice(index + 1))
        expect(x + width <= nx || nx + nw <= x || y + height <= ny || ny + nh <= y).toBe(true);
    }
  });
  it("keeps bundled stair contacts inside each resolved woodland, climate and civic frame", () => {
    for (const [route] of [...WOODLAND_STRUCTURES, ...CIVIC_STRUCTURES])
      for (const biome of ["ground", "snow", "dessert"] as const) {
        const art = resolveWorldStructure(`https://uploadthing.b-cdn.net/f/${stockImages[route][0]}.webp`, route, biome)!;
        expect(art.stair.x).toBeGreaterThan(0);
        expect(art.stair.x).toBeLessThan(art.frame.width);
        expect(art.stair.y).toBeGreaterThan(art.frame.height * .8);
        expect(art.stair.y).toBeLessThanOrEqual(art.frame.height);
      }
  });
  it("limits Horizon's civic lookout to its bundled hall while retaining entrance dimensions", () => {
    const image = `https://uploadthing.b-cdn.net/f/${stockImages["/townhall"][0]}.webp`;
    const shared = resolveWorldStructure(image, "/townhall", "ground", 724)!;
    const horizon = resolveWorldStructure(image, "/townhall", "ground", 301)!;
    expect(horizon.filepath).toBe("/world-art/horizon-watch-hall.webp");
    expect(horizon.height).toBe(shared.height);
    expect(horizon.frame).toMatchObject({ width: shared.frame.width, height: shared.frame.height });
    expect(horizon.shadow).toBe(shared.shadow);
    expect(resolveWorldStructure(image, "/townhall", "ground")).toEqual(shared);
    expect(resolveWorldStructure("https://uploadthing.b-cdn.net/f/custom.webp", "/townhall", "ground", 301)).toBeUndefined();
  });
});
