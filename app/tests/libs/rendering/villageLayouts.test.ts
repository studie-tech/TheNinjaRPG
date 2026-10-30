import alea from "alea";
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { sectorSpriteDescriptions } from "@/libs/rendering/sectorSprites";
import { boundsOverlap, worldSpriteBounds } from "@/libs/rendering/visibility";
import { WORLD_ASSET_SOURCES, worldAssetSource } from "@/libs/rendering/worldAssetSources";
import { WORLD_STRUCTURE_ART } from "@/libs/rendering/worldStructures";
import { prepareSectorGrid } from "@/libs/sector-map/sector-grid";
import { createGenericStructure, createShrineStructure } from "@/libs/sector-map/structures";
import { mergeTerrainSpecs } from "@/libs/sector-map/terrains";
import type { NormalizedSectorMap } from "@/libs/sector-map/types";
import { villageLayouts } from "../../setup/villageLayouts";
import { worldArtDirectory, worldArtFile } from "../../setup/worldArt";

const migration = readFileSync(new URL("../../../drizzle/migrations/0131_mighty_thor.sql", import.meta.url), "utf8");
const plots = [...migration.matchAll(/UNION ALL SELECT (NULL|'[^']+'), '([^']+)', (\d+), (\d+), (\d+), (\d+), '([^']+)'/g)]
  .map(([, village, route, x, y, nextX, nextY, image]) => ({ village: village === "NULL" ? null : village!.slice(1, -1), route, x: Number(x), y: Number(y), nextX: Number(nextX), nextY: Number(nextY), image }));

describe("canonical village plots", () => {
  it("guards published artwork and saved coordinates while keeping arrival and hospital plots fixed", () => {
    expect(plots).toHaveLength(23);
    expect(migration).toContain("s.`longitude` = plots.oldLongitude AND s.`latitude` = plots.oldLatitude AND s.`image` = CAST(plots.image AS BINARY)");
    for (const plot of plots) {
      expect(Object.values(WORLD_STRUCTURE_ART).some(art => art.route === plot.route && (plot.village === null || art.village === plot.village))).toBe(true);
      expect(plot.image).toBeTruthy();
      expect(["", "/hospital", "/alliancehall"]).not.toContain(plot.route!);
      expect(plot.nextX).toBeGreaterThanOrEqual(3); expect(plot.nextX).toBeLessThanOrEqual(22);
      expect(plot.nextY).toBeGreaterThanOrEqual(3); expect(plot.nextY).toBeLessThanOrEqual(22);
    }
    expect(plots.filter(plot => plot.village === null).map(plot => plot.route).sort()).toEqual(["/academy", "/battlearena"]);
    expect(migration).toContain("v.`type` IN ('HIDEOUT', 'STRONGHOLD')");
  });

  for (const layout of villageLayouts) {
    const map: NormalizedSectorMap = {
      formatVersion: 1, sector: layout.sector, name: layout.name, width: 26, height: 26,
      tiles: Array.from({ length: 676 }, (_, i) => ({ x: i % 26, y: Math.floor(i / 26), terrain: "ground", walkCost: 1, blocked: false, zone: "village", battleBiome: "ground" })),
      objects: [], anchors: [{ key: "shrine.default", x: 13, y: 5 }], exits: [], metadata: { source: "tiled", importedAt: "2026-01-01T00:00:00Z" },
    };
    const structures = layout.structures.map(([route, x, y]) => {
      const art = Object.values(WORLD_STRUCTURE_ART).find(art => art.village === layout.name && art.route === route)!;
      const move = plots.find(plot => plot.village === layout.name && plot.route === route && plot.x === x && plot.y === y);
      return createGenericStructure({ name: route, route, image: art.sourceImage, longitude: move?.nextX ?? x, latitude: move?.nextY ?? y });
    });
    structures.push(createShrineStructure(map, 1));
    const { grid } = prepareSectorGrid(1000, alea(1), 1, structures, map, mergeTerrainSpecs([]), null);
    const sprites = sectorSpriteDescriptions({ grid, map, structures, wall: null, lightLayout: true, decorations: new Map() });
    const pairs = sprites.flatMap((a, index) => sprites.slice(index + 1).map(b => ({ a, b,
      ab: worldSpriteBounds({ x: a.x, y: a.y, width: a.size * a.frame!.width / a.frame!.height, height: a.size, anchorX: .5, anchorY: a.anchorY!, rotation: 0 }),
      bb: worldSpriteBounds({ x: b.x, y: b.y, width: b.size * b.frame!.width / b.frame!.height, height: b.size, anchorX: .5, anchorY: b.anchorY!, rotation: 0 }),
    }))).filter(({ ab, bb }) => boundsOverlap(ab, bb));

    it(`keeps ${layout.name} building envelopes from substantially obscuring each other`, () => {
      expect(sprites).toHaveLength(structures.length);
      for (const { a, b, ab, bb } of pairs) {
        const overlap = Math.max(0, Math.min(ab.maxX, bb.maxX) - Math.max(ab.minX, bb.minX)) * Math.max(0, Math.min(ab.maxY, bb.maxY) - Math.max(ab.minY, bb.minY));
        expect(overlap / Math.min((ab.maxX-ab.minX)*a.size, (bb.maxX-bb.minX)*b.size)).toBeLessThan(.15);
      }
    });

    it.skipIf(!worldArtDirectory)(`keeps ${layout.name} painted facades and roof silhouettes distinct`, async () => {
      const images = new Map(await Promise.all([...new Set(sprites.map(sprite => sprite.image))].map(async image => {
        const key = Object.keys(WORLD_ASSET_SOURCES).find(key => worldAssetSource(key) === worldAssetSource(image))!;
        return [image, await sharp(worldArtFile(key)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })] as const;
      })));
      const step = grid.toArray()[0]!.height / 32;
      for (const { a, b, ab, bb } of pairs) {
        let covered = 0;
        for (let y = Math.max(ab.minY, bb.minY) + step / 2; y < Math.min(ab.maxY, bb.maxY); y += step)
          for (let x = Math.max(ab.minX, bb.minX) + step / 2; x < Math.min(ab.maxX, bb.maxX); x += step) {
            const isOpaque = (sprite: typeof a, bounds: typeof ab) => {
              const { data, info } = images.get(sprite.image)!, frame = sprite.frame!;
              const u = Math.floor((x - bounds.minX) / (bounds.maxX - bounds.minX) * frame.width);
              const v = Math.floor((bounds.maxY - y) / sprite.size * frame.height);
              return data[((frame.y + v) * info.width + frame.x + u) * 4 + 3]! >= 128;
            };
            if (isOpaque(a, ab) && isOpaque(b, bb)) covered++;
          }
        const overlap = covered * step * step / Math.min((ab.maxX-ab.minX)*a.size, (bb.maxX-bb.minX)*b.size);
        const names = [a.id, b.id].map(id => structures.find(structure => structure.id === id)!.route).join(" / ");
        expect(overlap, names).toBeLessThan(.005);
      }
    });
  }
});
