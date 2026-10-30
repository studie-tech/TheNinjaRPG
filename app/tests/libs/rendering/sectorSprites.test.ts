import { describe, expect, it } from "bun:test";
import type { VillageStructure } from "@/drizzle/schema";
import { sectorSpriteDescriptions } from "@/libs/rendering/sectorSprites";
import { WORLD_STRUCTURE_ART } from "@/libs/rendering/worldStructures";
import { createGenericStructure } from "@/libs/sector-map/structures";
import type { DecorationAsset } from "@/libs/sector-map/decorations";
import type { NormalizedSectorMap } from "@/libs/sector-map/types";
import type { MapLocation } from "@/validators/mapLocation";

const grid = { getHex: ({ col, row }: { col: number; row: number }) => {
  if (!Number.isFinite(col) || !Number.isFinite(row)) throw new Error("Invalid coordinates");
  return { col, row, x: col * 20, y: row * 20, width: 20, height: 20 };
} } as never;
const location: MapLocation = { id: "tower", sector: 724, longitude: 3, latitude: 4, name: "Tower", description: "A tower.", assetId: "art", scale: 1 };
const asset = { id: "art", imageUrl: "tower.png", renderScale: 2.4 };
const objects = [{ id: "tree", type: "decoration", x: 3, y: 4, assetKey: "tree" }];
const descriptions = (locations: MapLocation[], assets = [asset], mapObjects = objects, structures: VillageStructure[] = []) => sectorSpriteDescriptions({ grid, map: { sector: 0, objects: mapObjects } as NormalizedSectorMap,
  structures, wall: null, lightLayout: false, locations, mapAssets: assets,
  decorations: new Map([["tree", { key: "tree", filepath: "tree.png", renderScale: 2 } as DecorationAsset]]),
});

describe("sector scenery recipes", () => {
  it("gives imported faction buildings matched materials and paving outside themed settlements", () => {
    const art = { ...WORLD_STRUCTURE_ART["syndicate/bank"]!, sourceImage: "uploaded-faction-bank.webp", filepath: "uploaded-faction-atlas.webp" };
    const structure = { ...createGenericStructure({ name: "Bank", route: art.route, image: art.sourceImage, longitude: 3, latitude: 4 }), worldArt: art };
    const sprite = descriptions([], [], [], [structure])[0]!;
    expect(sprite.worldMaterial).toEqual({ material: art.material, surfaces: art.surfaces });
    expect(sprite.entrance).toMatchObject({ hasCourt: true, courtSlope: art.courtSlope });
    expect(sprite.frame).toEqual(art.frame);
    expect(sprite).toMatchObject({ image: art.filepath, rendition: 0 });
  });
  it("draws one building for co-located objectives with an independent pin", () => {
    const sprites = descriptions([location, { ...location, id: "second" }]);
    expect(sprites).toHaveLength(2);
    expect(new Set(sprites.map((sprite) => sprite.locationId)).size).toBe(1);
    expect(sprites[0]).toMatchObject({ preserveAspect: true, size: 48, anchorY: 0.85 });
    expect(sprites[0]?.mask).toBeUndefined();
  });
  it("changes art without changing the authored entrance or mutating its source", () => {
    const before = structuredClone(location);
    const first = descriptions([location]), second = descriptions([location], [{ ...asset, imageUrl: "replacement.png" }]);
    expect(first[0]?.image).toBe("tower.png");
    expect(second[0]?.image).toBe("replacement.png");
    expect(first[1]).toEqual(second[1]);
    expect(location).toEqual(before);
  });
  it("keeps a usable arrival pin when the artwork is unavailable", () => {
    const sprites = descriptions([location], []);
    expect(sprites).toHaveLength(1);
    expect(sprites[0]?.locationId).toBe("tower");
  });
  it("restores overlapping decoration after its private entrance ends", () => {
    expect(descriptions([location]).some((sprite) => sprite.id === "tree")).toBe(false);
    expect(descriptions([]).some((sprite) => sprite.id === "tree")).toBe(true);
  });
  it("skips drafts with invalid coordinates", () => {
    const draft = { ...location, longitude: Number.NaN };
    expect(descriptions([draft, location])).toEqual(descriptions([location]));
  });
  it("orders scenery by its ground contact", () => {
    const sprites = descriptions([], [asset], [objects[0]!, { ...objects[0]!, id: "far-tree", y: 9 }]);
    expect(sprites.map((sprite) => sprite.id)).toEqual(["far-tree", "tree"]);
  });
  it("orders village buildings at their base without moving their centered artwork", () => {
    const home = { id: "home", longitude: 3, latitude: 4, image: "home.png", hasPage: 1 } as VillageStructure;
    const sprite = descriptions([], [], [], [home])[0]!;
    expect(sprite).toMatchObject({ x: 60, y: 82, size: 60, structureId: "home" });
    expect(sprite.groundY).toBeCloseTo(61);
    expect(sprite.anchorY).toBeUndefined();
  });
  it.each(["structure", "landmark"])("orders authored %s art at its base without moving it", (type) => {
    const sprite = descriptions([], [], [{ id: type, type, x: 3, y: 4, assetKey: "building.png" }])[0]!;
    expect(sprite).toMatchObject({ x: 60, y: 82.5, size: 48 });
    expect(sprite.groundY).toBeCloseTo(65.7);
    expect(sprite.anchorY).toBeUndefined();
  });
  it("retains the center contact for other authored object types", () => {
    const sprite = descriptions([], [], [{ id: "shrine", type: "shrine", x: 3, y: 4, assetKey: "shrine.png" }])[0]!;
    expect(sprite).toMatchObject({ x: 60, y: 82.5, size: 24, groundY: 82.5 });
  });
});
