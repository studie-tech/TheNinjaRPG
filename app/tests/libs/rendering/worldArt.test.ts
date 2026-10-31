import { describe, expect, it } from "bun:test";
import sharp from "sharp";
import { GROUND_DETAIL_ART, resolveWorldDecoration, resolveWorldTerrain } from "@/libs/rendering/worldArt";
import { WORLD_STRUCTURE_ART, resolveWorldStructure } from "@/libs/rendering/worldStructures";
import { worldAssetSource } from "@/libs/rendering/worldAssetSources";
import { transformImageUrl } from "@/utils/image";
import { worldArtDirectory, worldArtFile } from "../../setup/worldArt";
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

  it("shares sixteen native pixel cutouts with clear atlas gutters across biome-specific stock ground cover", async () => {
    const decoded = worldArtDirectory ? await sharp(worldArtFile("ground-details.webp")).ensureAlpha().raw().toBuffer({ resolveWithObject: true }) : null;
    const info = decoded?.info ?? worldAssetSource("/world-art/ground-details.webp")!, data = decoded?.data;
    expect(info.width * info.height * 4).toBeLessThanOrEqual(16 * 1024);
    expect(GROUND_DETAIL_ART).toHaveLength(16);
    for (const [index, asset] of GROUND_DETAIL_ART.entries()) {
      const { x, y, width, height } = asset.frame!;
      expect(x + width).toBeLessThanOrEqual(info.width);
      expect(y + height).toBeLessThanOrEqual(info.height);
      expect(Math.max(width, height)).toBeLessThanOrEqual(14);
      let covered = 0;
      if (data) for (let v = 0; v < height; v++) for (let u = 0; u < width; u++) {
        const alpha = data[((y + v) * info.width + x + u) * 4 + 3]!;
        expect([0, 255]).toContain(alpha);
        if (u === 0 || v === 0 || u === width - 1 || v === height - 1) expect(alpha).toBe(0);
        if (alpha) covered++;
      }
      if (data) expect(covered).toBeGreaterThan(0);
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

  it("recognizes published structures across CDN aliases and retains custom replacements", () => {
    const image = WORLD_STRUCTURE_ART["akikaze/academy"]!.sourceImage;
    const stock = resolveWorldStructure(image, "/academy");
    expect(stock?.frame).toBeDefined();
    expect(resolveWorldStructure(`${transformImageUrl(image)}?width=200`, "/academy")).toEqual(stock);
    expect(resolveWorldStructure("https://uploadthing.b-cdn.net/f/custom.webp", "/academy")).toBeUndefined();
    expect(resolveWorldStructure(image, "/hospital")).toBeUndefined();
  });
  it("keeps Wake Island services and its shrine visually distinct and source-aligned", () => {
    const buildings = Object.values(WORLD_STRUCTURE_ART).filter((art) => art.village === "Wake Island");
    expect(buildings).toHaveLength(10);
    expect(new Set(buildings.map((art) => art.sourceImage)).size).toBe(10);
    for (const art of buildings) expect(worldAssetSource(art.filepath)?.material).toBe(art.material);
  });
  it("keeps every settlement's stair contacts and material frames inside its published artwork", () => {
    expect(new Set(Object.values(WORLD_STRUCTURE_ART).map((art) => art.village)).size).toBe(9);
    for (const art of Object.values(WORLD_STRUCTURE_ART)) {
      const source = worldAssetSource(art.filepath)!;
      expect(source.frames).toContainEqual([art.frame.x, art.frame.y, art.frame.width, art.frame.height]);
      expect(art.stair.x).toBeGreaterThan(0); expect(art.stair.x).toBeLessThan(art.frame.width);
      expect(art.stair.y).toBeGreaterThan(art.frame.height * .8); expect(art.stair.y).toBeLessThanOrEqual(art.frame.height);
      expect(art.courtSlope).toBeGreaterThan(0); expect(art.courtSlope).toBeLessThan(.6);
      expect(source.material).toBe(art.material); expect(source.surfaces).toBe(art.surfaces);
    }
  });
  it("keeps structure pixel density consistent with displayed world heights", () => {
    for (const art of Object.values(WORLD_STRUCTURE_ART)) {
      const source = worldAssetSource(art.filepath)!;
      expect(source.width).toBeLessThanOrEqual(1024);
      expect(source.height).toBeLessThanOrEqual(1024);
      const pixelsPerHex = art.frame.height / art.height;
      expect(pixelsPerHex).toBeGreaterThanOrEqual(55);
      expect(pixelsPerHex).toBeLessThanOrEqual(75);
    }
  });
  it("uses persisted materials only while their source image and service still match", () => {
    const art = WORLD_STRUCTURE_ART["horizon/townhall"]!;
    const configured = { ...art, height: art.height + .1 };
    expect(resolveWorldStructure(art.sourceImage, art.route, configured)).toBe(configured);
    expect(resolveWorldStructure("custom-townhall.webp", art.route, configured)).toBeUndefined();
    expect(resolveWorldStructure(art.sourceImage, "/bank", configured)).toBeUndefined();
    expect(art.sourceImage).not.toBe(WORLD_STRUCTURE_ART["akikaze/townhall"]!.sourceImage);
  });
});
