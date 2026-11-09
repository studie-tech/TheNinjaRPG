import { afterEach, describe, expect, it, vi } from "bun:test";
import alea from "alea";
import { BufferImageSource, Mesh, Shader, Texture, UniformGroup } from "pixi.js";
import type { VillageStructure } from "@/drizzle/schema";
import { PathCalculator, type TerrainHex } from "@/libs/hexgrid";
import { linearRenderColor } from "@/libs/rendering/color";
import { createHexTerrain, textureRanges } from "@/libs/rendering/primitives/terrain";
import type { GameRenderer } from "@/libs/rendering/runtime";
import { buildSectorTerrainData } from "@/libs/rendering/sectorData";
import type { WorldSpriteDescription } from "@/libs/rendering/sectorSprites";
import {
  hexTerrainAt,
  KIND,
  LAND_SEGMENT,
  sectorFieldCell,
} from "@/libs/rendering/terrainData";
import {
  createTerrainField,
  LAND_STEP,
  liftSpritesToTerrain,
  MAX_SEABED_DEPTH,
  standingOffset,
  WATER_FIELD_REACH,
} from "@/libs/rendering/terrainElevation";
import { resolveWorldTerrain } from "@/libs/rendering/worldArt";
import { buildWindowNav } from "@/libs/sector-map/navigation";
import { prepareSectorGrid } from "@/libs/sector-map/sector-grid";
import { mergeTerrainSpecs } from "@/libs/sector-map/terrains";
import type { NormalizedSectorMap } from "@/libs/sector-map/types";
import {
  getNeighborCoordinates,
  isReachableCoordinate,
  isWalkableCoordinate,
} from "@/libs/sector-map/validation";
import { sectorMap } from "../../setup/sectorMap";

const mapOf = (width: number, height: number): NormalizedSectorMap =>
  sectorMap(
    width,
    height,
    (x, y) => {
      const terrain =
        ["ground", "ocean", "dessert", "ice", "snow"][(x + y) % 5] ?? "ground";
      return {
        terrain,
        battleBiome:
          terrain === "dessert"
            ? "dessert"
            : terrain === "ice"
              ? "ice"
              : terrain === "snow"
                ? "snow"
                : terrain === "ocean"
                  ? "ocean"
                  : "ground",
      };
    },
    { sector: 724, name: "Terrain map", anchors: [] },
  );
const prepare = (
  map: NormalizedSectorMap,
  light = false,
  registry = mergeTerrainSpecs([]),
) => {
  const random = alea(map.sector + 1);
  const { grid } = prepareSectorGrid(1024, random, 1, [], map, registry, null);
  return { grid, data: buildSectorTerrainData(grid, random, light) };
};

type TerrainData = ReturnType<typeof prepare>["data"];
/** The face vertices of one tile, wherever its segment placed them. */
const faceOf = (data: TerrainData, key: string) => {
  for (const segment of data.segments) {
    const tile = segment.tiles.find((entry) => entry.key === key);
    if (tile) return { segment, start: tile.start, count: tile.count };
  }
  throw new Error(`no face for ${key}`);
};
/** Per-vertex kinds across all segments, with each vertex's segment order. */
const vertices = (data: TerrainData) =>
  data.segments.flatMap((segment) =>
    Array.from(segment.kinds, (kind, index) => ({
      kind,
      order: segment.order,
      slot: segment.slots[index]!,
      x: segment.positions[index * 2]!,
      y: segment.positions[index * 2 + 1]!,
      color: [...segment.colors.slice(index * 4, index * 4 + 4)],
      relief: [...segment.relief.slice(index * 2, index * 2 + 2)],
    })),
  );

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.restoreAllMocks();
});
const renderer = (texture: (path: string) => Promise<Texture>) => {
  const controller = new AbortController(),
    owned = new Set<() => void>();
  let disposed = false;
  const own = vi.fn((cleanup: () => void) => {
    owned.add(cleanup);
  });
  const game = {
    assets: { texture },
    animation: new UniformGroup({ uTime: { value: 0, type: "f32" } }),
    signal: controller.signal,
    isDisposed: () => disposed,
    own,
    dispose: () => {
      disposed = true;
      for (const cleanup of owned) cleanup();
      owned.clear();
    },
  } as unknown as GameRenderer;
  cleanups.push(game.dispose);
  return { game, controller, own };
};

describe("shared hex terrain textures", () => {
  it.each(["ocean", "ice"] as const)(
    "supports both sides of coastal walls over %s without filling distant water",
    (terrain) => {
      const map = mapOf(15, 15);
      map.tiles = map.tiles.map((tile) => ({ ...tile, terrain, battleBiome: terrain }));
      const authored = structuredClone(map);
      const { grid, villageWallPlan } = prepareSectorGrid(
        1024,
        alea(1),
        terrain === "ocean" ? 0 : 3,
        [{ longitude: 7, latitude: 7, hasPage: 1 }] as VillageStructure[],
        map,
        mergeTerrainSpecs([]),
        "VILLAGE",
      );
      expect(villageWallPlan!.edges.length).toBeGreaterThan(0);
      for (const edge of villageWallPlan!.edges) {
        const outside = getNeighborCoordinates(edge.tile)[edge.direction]!;
        for (const point of [edge.tile, outside]) {
          const tile = grid.getHex({ col: point.x, row: point.y })!;
          expect(tile.spec?.isWater).toBe(false);
          expect(tile.spec?.depression).toBe(0);
          expect(tile.spec?.key).toBe(terrain === "ocean" ? "dessert" : "snow");
        }
      }
      expect(grid.getHex({ col: 0, row: 0 })?.spec?.key).toBe(terrain);
      expect(map).toEqual(authored);
    },
  );

  it("retains authored dry land materials along the outside of village walls", () => {
    const map = mapOf(15, 15);
    map.tiles = map.tiles.map((tile) => ({
      ...tile,
      terrain: "dessert",
      battleBiome: "dessert",
    }));
    const registry = mergeTerrainSpecs([]);
    const { grid, villageWallPlan } = prepareSectorGrid(
      1024,
      alea(1),
      3,
      [{ longitude: 7, latitude: 7, hasPage: 1 }] as VillageStructure[],
      map,
      registry,
      "VILLAGE",
    );
    for (const edge of villageWallPlan!.edges) {
      const outside = getNeighborCoordinates(edge.tile)[edge.direction]!;
      expect(grid.getHex({ col: outside.x, row: outside.y })?.spec).toBe(
        registry.get("dessert"),
      );
    }
  });

  const textured = (map: NormalizedSectorMap) => {
    const registry = mergeTerrainSpecs([]);
    registry.set("ocean", {
      ...registry.get("ocean")!,
      textureUrl: "optional-water.png",
    });
    return prepare(map, false, registry);
  };
  it.each(["mixed", "ocean", "ice"] as const)(
    "draws %s terrain as an underwater mesh below a land mesh, back to front by sector",
    async (kind) => {
      const map = mapOf(5, 3);
      if (kind !== "mixed")
        map.tiles = map.tiles.map((tile) => ({
          ...tile,
          terrain: kind,
          battleBiome: kind,
        }));
      const { data } = prepare(map);
      const { game } = renderer(async () => Texture.WHITE);
      const terrain = await createHexTerrain(game, data);
      const meshes = (terrain.container.children as Mesh[]).filter(
        (mesh) => mesh.geometry.attributes.aKind,
      );
      expect(meshes.map((mesh) => mesh.zIndex).sort()).toEqual(
        data.segments.map((segment) => segment.order).sort(),
      );
      const all = vertices(data);
      // The seabed and translucent surface share the underwater mesh; the surface paints after its seabed.
      const lastSeabed = all.map((vertex) => vertex.kind).lastIndexOf(KIND.seabed);
      const firstSurface = all.findIndex((vertex) => vertex.kind === KIND.water);
      if (kind !== "ice") {
        expect(lastSeabed).toBeGreaterThanOrEqual(0);
        expect(lastSeabed).toBeLessThan(firstSurface);
        expect(all[firstSurface]!.order).toBeLessThan(4);
      }
      for (const mesh of meshes) expect(mesh.state.blend).toBe(true);
      terrain.setDepthBias(-0.001);
      expect(
        meshes.every(
          (mesh, index) => mesh.zIndex === data.segments[index]!.order - 0.001,
        ),
      ).toBe(true);
    },
  );

  it("paints each sector's rim beneath every sector's terrain so borders show the neighbour, not a cut", async () => {
    const map = mapOf(6, 4);
    map.tiles = map.tiles.map((tile) => ({
      ...tile,
      terrain: tile.x < 3 ? "ground" : "ocean",
      battleBiome: tile.x < 3 ? "ground" : "ocean",
    }));
    const { data } = prepare(map);
    const [rim, ...terrain] = data.segments;
    expect(rim!.order).toBeLessThan(
      Math.min(...terrain.map((segment) => segment.order)),
    );
    // The rim holds only the cut faces: no tile faces, and sector-local, never inside the grid's footprint.
    expect(rim!.tiles).toEqual([]);
    expect([...rim!.kinds].every((kind) => kind === KIND.flat)).toBe(true);
    const { game } = renderer(async () => Texture.WHITE);
    const terrainMeshes = await Promise.all([
      createHexTerrain(game, data),
      createHexTerrain(game, data),
    ]);
    terrainMeshes[1]!.setDepthBias(0.001);
    const zIndices = (index: number) =>
      (terrainMeshes[index]!.container.children as Mesh[])
        .filter((mesh) => mesh.geometry.attributes.aKind)
        .map((mesh) => mesh.zIndex);
    // Even a sector further forward keeps its rim below the other sector's underwater and land meshes.
    expect(Math.max(zIndices(1)[0]!, zIndices(0)[0]!)).toBeLessThan(
      Math.min(...zIndices(0).slice(1), ...zIndices(1).slice(1)),
    );
    expect(
      prepare(map, true).data.segments.every((segment) => segment.order !== rim!.order),
    ).toBe(true);
  });

  it("splits a segment only when it needs more images than a mesh binds", () => {
    const slots = new Float32Array([
      1, 1, 1, 2, 2, 2, 0, 0, 0, 3, 3, 3, 4, 4, 4, 5, 5, 5, 1, 1, 1,
    ]);
    expect(textureRanges(slots, 4)).toEqual([
      { start: 0, end: 15, slots: [1, 2, 3, 4] },
      { start: 15, end: 21, slots: [5, 1] },
    ]);
  });

  it("raises terraces with lit cliffs, drop outlines and pickable faces, painting higher levels later", async () => {
    const map = mapOf(6, 5);
    map.tiles = map.tiles.map((tile) => ({
      ...tile,
      terrain: "ground",
      battleBiome: "ground",
    }));
    const random = alea(3);
    const { grid } = prepareSectorGrid(
      1024,
      random,
      1,
      [],
      map,
      mergeTerrainSpecs([]),
      null,
    );
    const plateau = new Set(["2,2", "3,2", "2,3", "3,3"]);
    const field = {
      level: (tile: { col: number; row: number }) =>
        plateau.has(`${tile.col},${tile.row}`) ? 2 : 0,
      sample: () => ({ depth: 1, frozen: 0 }),
      at: () => null,
    };
    const data = buildSectorTerrainData(grid, random, false, { field: field as never });
    const raised = grid.getHex({ col: 2, row: 2 })!;
    expect(raised.terrace).toBe(2);
    expect(data.faceOffsets.get("2,2")).toBeCloseTo(2 * LAND_STEP * raised.height);
    expect(data.faceOffsets.get("0,0")).toBe(0);
    expect(standingOffset(raised)).toBeCloseTo(2 * LAND_STEP * raised.height);
    const top = faceOf(data, "2,2"),
      flat = faceOf(data, "0,0");
    expect(top.segment).toBe(flat.segment);
    // Painter order: plain ground, then the cliffs it carries, then the plateau above them.
    const cliffs = Array.from(flat.segment.kinds)
      .map((kind, index) => ({ kind, index }))
      .filter(
        ({ kind, index }) =>
          kind === KIND.flat &&
          index > flat.start &&
          index < top.start &&
          flat.segment.colors[index * 4 + 3] === 1,
      );
    expect(top.start).toBeGreaterThan(flat.start);
    expect(cliffs.length).toBeGreaterThan(0);
    // Cliff faces turned toward the upper-left light are brighter than those turned away.
    const shades = new Set(
      cliffs.map(({ index }) => flat.segment.colors[index * 4]!.toFixed(3)),
    );
    expect(shades.size).toBeGreaterThan(2);
    // A dark outline traces the plateau's rim after its face.
    const rim = Array.from(top.segment.kinds).some(
      (kind, index) =>
        kind === KIND.flat &&
        index > top.start &&
        top.segment.colors[index * 4 + 3] === 0.5,
    );
    expect(rim).toBe(true);
    const center = { x: raised.x, y: raised.y + (data.faceOffsets.get("2,2") ?? 0) };
    expect(hexTerrainAt(grid, data.faceOffsets, center.x, center.y)).toBe(raised);
    const sprite = {
      x: raised.x,
      y: raised.y,
      groundY: raised.y,
    } as WorldSpriteDescription;
    liftSpritesToTerrain([sprite], grid);
    expect(sprite.y).toBeCloseTo(raised.y + standingOffset(raised));
    expect(sprite.groundY).toBe(sprite.y);
  });

  it("keeps terrain geometry, palette and picking when one optional image fails", async () => {
    const { grid, data } = textured(mapOf(3, 2));
    const failedTexture = data.textures[0]!;
    const failure = new Error("HTTP 404 for optional terrain image");
    const image = new Texture({
      source: new BufferImageSource({
        resource: new Uint8Array([255, 255, 255, 255]),
        width: 1,
        height: 1,
      }),
    });
    const { game } = renderer(async (path) => {
      if (path === failedTexture) throw failure;
      return image;
    });
    cleanups.push(() => image.destroy(true));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const terrain = await createHexTerrain(game, data);
    const meshes = terrain.container.children.filter(
      (child): child is Mesh =>
        child instanceof Mesh && Boolean(child.geometry.attributes.aKind),
    );
    expect(meshes).toHaveLength(data.segments.length);
    data.segments.forEach((segment, index) => {
      const mesh = meshes[index]!;
      const length = segment.positions.length;
      expect([...mesh.geometry.getBuffer("aPosition").data].slice(0, length)).toEqual([
        ...segment.positions,
      ]);
      expect(
        [...mesh.geometry.getBuffer("aColor").data].slice(0, segment.colors.length),
      ).toEqual([...segment.colors]);
    });
    const images = meshes.flatMap((mesh) =>
      [1, 2, 3, 4].map((slot) => mesh.shader!.resources[`uImage${slot}`]),
    );
    expect(images).toContain(Texture.WHITE.source);
    if (data.textures.length > 1) expect(images).toContain(image.source);
    expect(warning).toHaveBeenCalledWith("Terrain texture unavailable", failure);
    for (const tile of grid) {
      const offset = data.faceOffsets.get(`${tile.col},${tile.row}`) ?? 0;
      expect(tile.blocked).toBe(false);
      expect(hexTerrainAt(grid, data.faceOffsets, tile.x, tile.y + offset)).toBe(tile);
    }
    game.dispose();
    expect(terrain.container.destroyed).toBe(true);
    expect(image.source.destroyed).toBe(false);
  });

  it.each(["abort", "dispose"])(
    "does not create fallback resources after %s during a failed image load",
    async (cancel) => {
      let reject = (_error: Error) => {};
      const pending = new Promise<Texture>((_resolve, fail) => {
        reject = fail;
      });
      const { game, controller, own } = renderer(() => pending);
      const terrain = createHexTerrain(game, textured(mapOf(2, 2)).data);
      if (cancel === "abort") controller.abort();
      else game.dispose();
      const failure = new Error("Image load failed after cancellation");
      reject(failure);
      await expect(terrain).rejects.toBe(failure);
      expect(own).not.toHaveBeenCalled();
    },
  );

  it("preserves an image loader's AbortError even before its signal is aborted", async () => {
    const failure = new DOMException("Image load cancelled", "AbortError");
    const { game, own } = renderer(async () => {
      throw failure;
    });
    await expect(createHexTerrain(game, textured(mapOf(2, 2)).data)).rejects.toBe(
      failure,
    );
    expect(own).not.toHaveBeenCalled();
  });

  it("propagates terrain initialization errors after images load", async () => {
    const failure = new Error("Shader initialization failed");
    const { game } = renderer(async () => Texture.WHITE);
    vi.spyOn(Shader, "from").mockImplementation(() => {
      throw failure;
    });
    await expect(createHexTerrain(game, textured(mapOf(2, 2)).data)).rejects.toBe(
      failure,
    );
  });
});

describe("shared hex terrain data", () => {
  it("draws narrow paths over intact terrain in both detail modes without changing picking or navigation", () => {
    const map = mapOf(3, 2);
    map.tiles = map.tiles.map((tile) => ({
      ...tile,
      terrain: "ground",
      battleBiome: "ground",
      zone: tile.x === 1 ? "road" : "wilderness",
    }));
    const before = structuredClone(map);
    const { grid, data } = prepare(map);
    expect(data.surface.length).toBeGreaterThan(0);
    expect(data.surfaceColors.length / 3).toBe(data.surface.length / 2);
    expect([...data.surface, ...data.surfaceColors].every(Number.isFinite)).toBe(true);
    for (const tile of grid)
      expect(hexTerrainAt(grid, data.faceOffsets, tile.x, tile.y)).toBe(tile);
    expect(prepare(map, true).data.surface.length).toBeGreaterThan(0);
    const bare = {
      ...map,
      tiles: map.tiles.map((tile) => ({ ...tile, zone: "wilderness" as const })),
    };
    expect(data.segments).toEqual(prepare(bare).data.segments);
    const road = grid.getHex({ col: 1, row: 0 })!;
    const xs = Array.from(data.surface).filter((_, index) => index % 2 === 0);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(road.width * 0.4);
    const paved = {
      ...map,
      tiles: map.tiles.map((tile) => ({ ...tile, zone: "road" as const })),
    };
    expect(prepare(paved).data.surface.length).toBeGreaterThan(0);
    expect(map).toEqual(before);
  });

  it("keeps a land segment for bridges and roads in a sector that is all water", async () => {
    const map = mapOf(3, 2);
    map.tiles = map.tiles.map((tile) => ({
      ...tile,
      terrain: "ocean",
      battleBiome: "ocean",
      zone: tile.x === 1 ? "road" : "wilderness",
    }));
    const { data } = prepare(map);
    expect(data.surface.length).toBeGreaterThan(0);
    expect(data.segments.some((segment) => segment.order === LAND_SEGMENT)).toBe(false);
    const { game } = renderer(async () => Texture.WHITE);
    const terrain = await createHexTerrain(game, data);
    const meshes = (terrain.container.children as Mesh[]).filter(
      (mesh) => mesh.geometry.attributes.aKind,
    );
    expect(meshes.some((mesh) => mesh.zIndex === LAND_SEGMENT)).toBe(true);
  });

  it("preserves positive fractional terrain costs in both navigation grids", () => {
    const map = mapOf(1, 1);
    map.tiles[0]!.walkCost = 0.5;
    expect(prepare(map).grid.getHex({ col: 0, row: 0 })?.cost).toBe(1.5);
    expect(
      buildWindowNav([{ sector: map.sector, dx: 0, dy: 0, map }], 10)?.toUnified(
        0,
        0,
        0,
        0,
      )?.cost,
    ).toBe(1.5);
  });

  it.each(["ground", "dessert", "snow", "ice", "ocean"] as const)(
    "keeps shaded %s walkable in rendering, window navigation and server validation",
    (terrain) => {
      const map = mapOf(3, 1);
      map.tiles = map.tiles.map((tile) => ({
        ...tile,
        terrain,
        battleBiome: terrain,
        blocked: tile.x === 1,
        walkCost: tile.x === 1 ? 0 : 1,
      }));
      const before = structuredClone(map);
      const { grid, data } = prepare(map);
      const tile = grid.getHex({ col: 1, row: 0 })!;
      expect(tile.blocked).toBe(false);
      expect(tile.cost).toBe(2);
      expect(
        new PathCalculator(grid).getShortestPath(
          grid.getHex({ col: 0, row: 0 })!,
          tile,
        ),
      ).toBeDefined();
      const nav = buildWindowNav([{ sector: map.sector, dx: 0, dy: 0, map }], 10)!;
      expect(nav.toUnified(0, 0, 1, 0)?.blocked).toBe(false);
      expect(isWalkableCoordinate(map, { x: 1, y: 0 })).toBe(true);
      expect(isReachableCoordinate(map, { x: 0, y: 0 }, { x: 2, y: 0 })).toBe(true);
      expect(isWalkableCoordinate(map, { x: -1, y: 0 })).toBe(false);
      // Movement does not rewrite the authored palette or its shaded appearance.
      expect(map).toEqual(before);
      if (terrain !== "ocean") {
        const face = faceOf(data, "1,0");
        const color = linearRenderColor(resolveWorldTerrain(tile.spec!).colors[2]!);
        const [r, g, b] = face.segment.colors.slice(face.start * 4, face.start * 4 + 3);
        expect([r, g, b].map((value) => value!.toFixed(4))).toEqual(
          [color.r, color.g, color.b].map((value) => value.toFixed(4)),
        );
      }
    },
  );

  it.each([false, true])(
    "outlines exposed faces at their terrain height (light layout: %s)",
    (light) => {
      const { grid, data } = prepare(mapOf(2, 1), light);
      const [land, water] = grid.toArray();
      expect(data.boundary.length).toBe(10 * 4);
      if (light) expect(data.faceOffsets.get("1,0")).toBe(0);
      else expect(data.faceOffsets.get("1,0")).toBeLessThan(0);
      for (const tile of [land!, water!]) {
        const offset = data.faceOffsets.get(`${tile.col},${tile.row}`)!;
        const exposedEdges = tile.corners.flatMap((a, index) => {
          const b = tile.corners[(index + 1) % tile.corners.length]!;
          const neighbor = tile === land ? water! : land!;
          // Shared grid edges are interior even when the two faces have different heights.
          if (
            [a, b].every((point) =>
              neighbor.corners.some(
                (corner) => Math.hypot(point.x - corner.x, point.y - corner.y) < 1e-4,
              ),
            )
          )
            return [];
          return [a.x, a.y + offset, b.x, b.y + offset];
        });
        expect(exposedEdges).toHaveLength(5 * 4);
        for (let index = 0; index < exposedEdges.length; index += 4) {
          expect(
            Array.from({ length: data.boundary.length / 4 }, (_, edge) =>
              exposedEdges
                .slice(index, index + 4)
                .every(
                  (value, coordinate) =>
                    Math.abs(value - data.boundary[edge * 4 + coordinate]!) < 1e-4,
                ),
            ).some(Boolean),
          ).toBe(true);
        }
      }
    },
  );

  it("picks each authored tile on its recessed face without renderer hit objects", () => {
    const { grid, data } = prepare(mapOf(26, 26));
    for (const tile of grid) {
      const offset = data.faceOffsets.get(`${tile.col},${tile.row}`) ?? 0;
      expect(hexTerrainAt(grid, data.faceOffsets, tile.x, tile.y + offset)).toBe(tile);
    }
    expect(hexTerrainAt(grid, data.faceOffsets, -1000, -1000)).toBeNull();
  });
  it("keeps all terrain vertices in a few texture batches and preserves walkability data", () => {
    const map = mapOf(26, 26),
      before = JSON.stringify(map);
    const { data } = prepare(map);
    expect(JSON.stringify(map)).toBe(before);
    expect(data.segments.length).toBeLessThanOrEqual(4);
    expect(data.segments.reduce((sum, segment) => sum + segment.tiles.length, 0)).toBe(
      26 * 26,
    );
    const all = vertices(data);
    // Each stock water tile adds one seabed block beneath its surface.
    const surfaces = all.filter((vertex) => vertex.kind === KIND.water).length;
    expect(all.filter((vertex) => vertex.kind === KIND.seabed).length).toBe(surfaces);
    expect(data.animatedTiles).toBeGreaterThan(0);
    expect(data.boundary.length).toBeGreaterThan(0);
    for (const segment of data.segments) {
      const count = segment.positions.length / 2;
      expect(segment.uvs.length).toBe(count * 2);
      expect(segment.colors.length).toBe(count * 4);
      expect(segment.kinds.length).toBe(count);
      expect(segment.slots.length).toBe(count);
      expect(segment.waves.length).toBe(count);
      expect(segment.relief.length).toBe(count * 2);
      expect(
        [...segment.positions, ...segment.uvs, ...segment.colors].every(
          Number.isFinite,
        ),
      ).toBe(true);
    }
  });
  it("light layout drops texture requests, water animation and recessed geometry", () => {
    const { data } = prepare(mapOf(26, 26), true);
    expect(data.animatedTiles).toBe(0);
    expect(data.textures).toEqual([]);
    expect([...data.faceOffsets.values()].every((offset) => offset === 0)).toBe(true);
    for (const segment of data.segments)
      for (const tile of segment.tiles)
        expect(
          [...segment.kinds.slice(tile.start, tile.start + tile.count)].every(
            (kind) => kind === KIND.solid,
          ),
        ).toBe(true);
    expect(
      vertices(data).every(
        (vertex) => vertex.kind === KIND.solid || vertex.kind === KIND.flat,
      ),
    ).toBe(true);
  });
  it("keeps seeded terrain and water phases stable across renderer remounts", () => {
    const map = mapOf(8, 8);
    const a = prepare(map).data,
      b = prepare(map).data;
    expect(a.segments).toEqual(b.segments);
  });
});

describe("coastal water depth", () => {
  it("sinks a seabed only under the stock ocean, whatever form its stored texture URL takes", () => {
    const seabedUnder = (textureUrl: string) => {
      const map = mapOf(8, 4);
      map.tiles = map.tiles.map((tile) => ({
        ...tile,
        terrain: tile.x < 2 ? "ground" : "ocean",
        battleBiome: tile.x < 2 ? "ground" : "ocean",
      }));
      const registry = mergeTerrainSpecs([]);
      registry.set("ocean", { ...registry.get("ocean")!, textureUrl });
      const random = alea(map.sector + 1);
      const { grid } = prepareSectorGrid(1024, random, 1, [], map, registry, null);
      const footprints = new Set<TerrainHex>();
      const field = createTerrainField(
        grid,
        new Map(
          grid
            .toArray()
            .map((tile) => [
              tile,
              sectorFieldCell(tile, { settled: false, footprints, relief: () => 0 }),
            ]),
        ),
      );
      const data = buildSectorTerrainData(grid, random, false, { field });
      return {
        grid,
        seabed: vertices(data).some((vertex) => vertex.kind === KIND.seabed),
        field,
      };
    };
    const stock = mergeTerrainSpecs([]).get("ocean")!.textureUrl!;
    expect(seabedUnder(stock.replace(/\.webp$/, "")).seabed).toBe(true);
    const custom = seabedUnder(stock.replace("/f/", "/f/custom-"));
    // Custom water is drawn flat, so the field holds it level instead of cutting seabed walls.
    expect(custom.seabed).toBe(false);
    for (const tile of custom.grid) expect(custom.field.level(tile)).toBe(0);
  });

  const coast = (sector: number, hasLand: boolean) => {
    const map = mapOf(8, 6);
    map.sector = sector;
    map.tiles = map.tiles.map((tile) => ({
      ...tile,
      terrain: hasLand && tile.x < 5 ? "ground" : "ocean",
      battleBiome: hasLand && tile.x < 5 ? "ground" : "ocean",
    }));
    return map;
  };

  it("keeps shared water vertices continuous across a sector boundary without changing faces or navigation", () => {
    const maps = [coast(222, true), coast(223, false)];
    const nav = buildWindowNav(
      maps.map((map, dx) => ({ sector: map.sector, dx, dy: 0, map })),
      10,
    )!;
    const grids = maps.map((map) => prepare(map).grid);
    const cells = new Map();
    for (const [dx, grid] of grids.entries())
      for (const tile of grid)
        cells.set(nav.toUnified(dx, 0, tile.col, tile.row)!, {
          isWater: !!tile.spec?.isWater,
          flat: true,
        });
    const field = createTerrainField(nav.pathFinder.grid, cells);
    const seams: Map<string, number[]>[] = [];
    for (const [dx, grid] of grids.entries()) {
      const before = grid.toArray().map((tile) => [tile.cost, tile.blocked, tile.spec]);
      const local = grid.getHex({ col: 0, row: 0 })!;
      const unified = nav.toUnified(dx, 0, 0, 0)!;
      const toWindow = (point: { x: number; y: number }) => ({
        x: unified.x + ((point.x - local.x) * unified.width) / local.width,
        y: unified.y + ((point.y - local.y) * unified.height) / local.height,
      });
      const local_field = {
        level: (tile: { col: number; row: number }) =>
          field.level(nav.toUnified(dx, 0, tile.col, tile.row)!),
        sample: (point: { x: number; y: number }) => field.sample(toWindow(point)),
        at: (point: { x: number; y: number }) => field.at(toWindow(point)),
      };
      const plain = buildSectorTerrainData(grid, alea(1), false);
      const data = buildSectorTerrainData(grid, alea(1), false, {
        field: local_field as never,
      });
      // Edges shared with the other sector drop to its real seabed instead of a cut to the floor.
      const rimOf = (terrain: typeof data) =>
        terrain.segments.find(
          (segment) =>
            segment.tiles.length === 0 &&
            segment.kinds.every((kind) => kind === KIND.flat),
        );
      expect(rimOf(data)?.positions.length ?? 0).toBeLessThan(
        rimOf(plain)!.positions.length,
      );
      const surfaces = (terrain: typeof data) =>
        vertices(terrain)
          .filter(
            (vertex) =>
              vertex.kind === KIND.water ||
              vertex.kind === KIND.noise ||
              vertex.kind === KIND.image,
          )
          .map((vertex) => [vertex.x, vertex.y]);
      expect(surfaces(data)).toEqual(surfaces(plain));
      expect(data.faceOffsets).toEqual(plain.faceOffsets);
      expect(
        grid.toArray().map((tile) => [tile.cost, tile.blocked, tile.spec]),
      ).toEqual(before);
      const shared = new Map<string, number[]>();
      for (const vertex of vertices(data).filter(
        (vertex) => vertex.kind === KIND.water,
      ))
        shared.set(
          `${(vertex.x + dx * 8 * local.width * 0.75).toFixed(4)},${vertex.y.toFixed(4)}`,
          [...vertex.color, ...vertex.relief],
        );
      seams.push(shared);
    }
    const shared = [...seams[0]!].filter(([point]) => seams[1]!.has(point));
    expect(shared.length).toBeGreaterThan(3);
    for (const [point, color] of shared) expect(seams[1]!.get(point)).toEqual(color);
  });

  const frozenCoast = (frost: "snow" | "ground") => {
    const map = mapOf(16, 4);
    map.tiles = map.tiles.map((tile) => ({
      ...tile,
      terrain: tile.x < 2 ? frost : "ocean",
      battleBiome: tile.x < 2 ? (frost === "snow" ? "snow" : "ground") : "ocean",
    }));
    return prepare(map);
  };

  it("freezes stock water off an icy coast and leaves open water beyond its reach", () => {
    const { grid, data } = frozenCoast("snow");
    const frozen = grid
      .toArray()
      .filter((tile) => tile.frozen)
      .map((tile) => tile.col);
    expect(frozen.length).toBeGreaterThan(0);
    expect(Math.min(...frozen)).toBe(2);
    expect(Math.max(...frozen)).toBeLessThanOrEqual(1 + WATER_FIELD_REACH);
    expect(grid.toArray().some((tile) => tile.spec?.isWater && !tile.frozen)).toBe(
      true,
    );
    expect(grid.toArray().every((tile) => !tile.frozen || tile.spec?.isWater)).toBe(
      true,
    );
    const water = vertices(data).filter((vertex) => vertex.kind === KIND.water);
    expect(water.some((vertex) => vertex.relief[1] === 1)).toBe(true);
    expect(
      water.every((vertex) => vertex.relief[0]! >= 0 && vertex.relief[0]! <= 1),
    ).toBe(true);
    // The seabed under the ice steps down offshore, a block per terrace.
    const depths = vertices(data)
      .filter((vertex) => vertex.kind === KIND.seabed)
      .map((vertex) => Math.round(vertex.relief[0]! * MAX_SEABED_DEPTH));
    expect(Math.min(...depths)).toBe(1);
    expect(Math.max(...depths)).toBeGreaterThan(1);
  });

  it("keeps temperate coasts liquid and their tidal edge unfrozen", () => {
    const { grid, data } = frozenCoast("ground");
    const snowy = frozenCoast("snow").data;
    expect(grid.toArray().some((tile) => tile.frozen)).toBe(false);
    expect(
      vertices(data).some(
        (vertex) => vertex.kind === KIND.water && vertex.relief[1]! > 0,
      ),
    ).toBe(false);
    expect(data.surfaceColors).not.toEqual(snowy.surfaceColors);
    expect(data.faceOffsets).toEqual(snowy.faceOffsets);
  });

  it("keeps custom water textures and light layout outside the stock depth treatment", () => {
    const map = coast(222, true),
      registry = mergeTerrainSpecs([]);
    const ocean = registry.get("ocean")!;
    registry.set("ocean", { ...ocean, colors: ["#203040", "#304050", "#405060"] });
    const colored = prepare(map, false, registry).data;
    expect(colored.textures).toContain(ocean.textureUrl!);
    registry.set("ocean", { ...ocean, textureUrl: "custom-water.png" });
    const { grid } = prepareSectorGrid(1024, alea(1), 1, [], map, registry, null);
    const custom = buildSectorTerrainData(grid, alea(1), false, { sector: 222 });
    expect(custom.textures).toContain("custom-water.png");
    expect(
      buildSectorTerrainData(grid, alea(1), true, { sector: 222 }).animatedTiles,
    ).toBe(0);
  });
});
