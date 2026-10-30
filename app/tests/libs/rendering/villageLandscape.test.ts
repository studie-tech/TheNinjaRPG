import alea from "alea";
import { describe, expect, it } from "bun:test";
import { SECTOR_MAP_VERSION } from "@/drizzle/constants";
import type { VillageStructure } from "@/drizzle/schema";
import { PathCalculator, type TerrainHex } from "@/libs/hexgrid";
import { buildSectorTerrainData } from "@/libs/rendering/sectorData";
import { sectorSpriteDescriptions, type WorldSpriteDescription } from "@/libs/rendering/sectorSprites";
import { WORLD_STRUCTURE_ART } from "@/libs/rendering/worldStructures";
import { getWorldForecourtPoint, getWorldStructureEntrance, resolveWorldStructure } from "@/libs/rendering/worldStructures";
import { getVillageRoadLayout, isOnVillageRoad, planVillageLandscape } from "@/libs/rendering/villageLandscape";
import { prepareSectorGrid } from "@/libs/sector-map/sector-grid";
import { DECORATION_ASSETS_BY_KEY } from "@/libs/sector-map/decorations";
import { mergeTerrainSpecs } from "@/libs/sector-map/terrains";
import type { NormalizedSectorMap } from "@/libs/sector-map/types";
import { planVillageWalls } from "@/libs/sector-map/village-walls";
import { getVillageWallSpriteSpec, STONE_VILLAGE_WALL_KIT } from "@/libs/sector-map/village-wall-assets";

/** A dry town split by a river with one crossing exercises decorative route planning. */
const town = () => {
  const map: NormalizedSectorMap = {
    formatVersion: SECTOR_MAP_VERSION, sector: 724, name: "Town", width: 8, height: 8,
    tiles: Array.from({ length: 64 }, (_, index) => {
      const x = index % 8, y = Math.floor(index / 8), water = x === 4 && y !== 5;
      return { x, y, terrain: water ? "ocean" : "ground", walkCost: 1, blocked: false, zone: "wilderness", battleBiome: water ? "ocean" : "ground" };
    }), objects: [], anchors: [], exits: [], metadata: { importedAt: "2026-01-01T00:00:00Z", source: "tiled" },
  };
  const { grid } = prepareSectorGrid(1024, alea(1), 1, [], map, mergeTerrainSpecs([]), null);
  const structures = ([
    ["/academy", 1, 2], ["/hospital", 6, 1], ["/missionhall", 6, 6],
  ] as const).map(([route, longitude, latitude]) => ({
    route, longitude, latitude, hasPage: 1,
    image: WORLD_STRUCTURE_ART[`akikaze${route}`]!.sourceImage,
  })) as VillageStructure[];
  return { grid, structures, map };
};

describe("village landscape", () => {
  it("keeps narrow dry paths on the bank while water routes use wooden crossings", () => {
    const { grid } = town();
    const roads = new Set(["2,3", "3,2", "3,3", "3,4", "4,3", "5,3"]);
    const layout = getVillageRoadLayout(grid, roads);
    for (const segment of layout.segments) {
      expect(segment.halfWidth * 2).toBeLessThan(segment.a.tile.width * .4);
      if (segment.a.tile.spec?.isWater || segment.b.tile.spec?.isWater) expect(segment.bridge).toBe(true);
    }
    const bank = layout.nodes.find(node => node.tile.col === 3 && node.tile.row === 3)!;
    expect(bank.x).toBe(bank.tile.x);
    expect(bank.y).toBe(bank.tile.y);
    expect(isOnVillageRoad(bank, layout)).toBe(true);
    expect(layout.segments.some(segment => segment.bridge)).toBe(true);
  });
  it("clears a path footprint while retaining small scenery beside it in the same hex", () => {
    const { grid, map } = town();
    const roads = new Set(Array.from({ length: 8 }, (_, row) => `2,${row}`));
    map.objects = [
      { id: "on-path", type: "decoration", x: 2, y: 3, assetKey: "training.dummy", offsetY: .418 },
      { id: "beside-path", type: "decoration", x: 2, y: 3, assetKey: "training.dummy", offsetX: .3, offsetY: .418 },
    ];
    const descriptions = sectorSpriteDescriptions({ grid, map, structures: [], wall: null, lightLayout: false, decorations: DECORATION_ASSETS_BY_KEY, roads });
    expect(descriptions.some(sprite => sprite.id === "on-path")).toBe(false);
    expect(descriptions.some(sprite => sprite.id === "beside-path")).toBe(true);
  });
  it("uses inset tower stairs consistently for artwork and its road landing", () => {
    const { grid, map, structures } = town();
    const tile = grid.getHex({ col: 2, row: 4 })!;
    const tower = { ...structures[0]!, id: "tower", route: "/anbu", longitude: 2, latitude: 4,
      image: WORLD_STRUCTURE_ART["akikaze/anbu"]!.sourceImage };
    const height = tile.height * resolveWorldStructure(tower.image, tower.route)!.height;
    const entrance = getWorldStructureEntrance(tile, height, resolveWorldStructure(tower.image, tower.route)!);
    const art = sectorSpriteDescriptions({ grid, map, structures: [tower], wall: null, lightLayout: false, decorations: DECORATION_ASSETS_BY_KEY });
    expect(art.find(sprite => sprite.structureId === tower.id)?.entrance).toMatchObject(entrance);
    expect(entrance.x).toBeLessThan(getWorldStructureEntrance(tile, height).x);
    expect(entrance.y).toBeGreaterThan(getWorldStructureEntrance(tile, height).y);
  });
  it("blends grove materials without extra terrain geometry or changes to custom materials and navigation", () => {
    const { grid } = town();
    const tile = grid.getHex({ col: 2, row: 3 })!;
    const tree: WorldSpriteDescription = { id: "grove", kind: "decoration", image: "/world-art/woodland-village.webp", size: tile.height * 3, x: tile.x, y: tile.y, groundY: tile.y };
    const options = { sector: 555, roads: new Set<string>() };
    const before = grid.toArray().map((tile) => [tile.cost, tile.blocked, tile.spec]);
    const plain = buildSectorTerrainData(grid, alea(1), false, options);
    const grove = buildSectorTerrainData(grid, alea(1), false, { ...options, sprites: [tree] });
    expect(grove.batches.map((batch) => batch.positions)).toEqual(plain.batches.map((batch) => batch.positions));
    expect(grove.batches.map((batch) => batch.colors)).not.toEqual(plain.batches.map((batch) => batch.colors));
    expect(grove.surface).toEqual(plain.surface);
    expect(grove.faceOffsets).toEqual(plain.faceOffsets);
    expect(grid.toArray().map((tile) => [tile.cost, tile.blocked, tile.spec])).toEqual(before);
    for (const tile of grid) if (tile.spec?.key === "ground") tile.spec = { ...tile.spec, colors: ["#614126", "#614126", "#614126"] };
    const custom = buildSectorTerrainData(grid, alea(1), false, options);
    expect(buildSectorTerrainData(grid, alea(1), false, { ...options, sprites: [tree] }).batches.map((batch) => batch.colors)).toEqual(custom.batches.map((batch) => batch.colors));
  });
  it("clears bundled tree canopies from landmark approaches while retaining custom artwork", () => {
    const { grid, structures, map } = town();
    const landmark = { ...structures[0]!, route: "/townhall", longitude: 2, latitude: 2,
      image: WORLD_STRUCTURE_ART["akikaze/townhall"]!.sourceImage };
    const building = grid.getHex({ col: 2, row: 2 })!;
    const contact = getWorldStructureEntrance(building, building.height * resolveWorldStructure(landmark.image, landmark.route)!.height, resolveWorldStructure(landmark.image, landmark.route)!);
    const foreground = grid.pointToHex({ x: contact.x, y: contact.y - building.height })!;
    map.objects = [{ id: "court-tree", type: "decoration", x: foreground.col, y: foreground.row, assetKey: "tree.green.tall" }];
    const before = structuredClone(map.objects);
    const asset = DECORATION_ASSETS_BY_KEY.get("tree.green.tall")!;
    const options = { grid, map, structures: [landmark], wall: null, lightLayout: false, roads: new Set<string>() };
    const bundled = sectorSpriteDescriptions({ ...options, decorations: new Map([[asset.key, asset]]) });
    const custom = sectorSpriteDescriptions({ ...options, decorations: new Map([[asset.key, { ...asset, filepath: "custom.png" }]]) });
    expect(bundled.some((sprite) => sprite.id === "court-tree")).toBe(false);
    expect(custom.some((sprite) => sprite.id === "court-tree" && sprite.image === "custom.png")).toBe(true);
    expect(map.objects).toEqual(before);
  });
  it("connects service entrances over dry ground without changing navigation or authored data", () => {
    const { grid, structures } = town();
    const before = grid.toArray().map((tile) => ({ cost: tile.cost, blocked: tile.blocked, spec: tile.spec, authored: tile.authored }));
    const roads = planVillageLandscape(grid, structures, null);
    expect(roads.size).toBeGreaterThan(3);
    for (const tile of grid) if (roads.has(`${tile.col},${tile.row}`)) expect(tile.spec?.isWater).toBe(false);
    const routeGrid = grid.map((tile) => Object.assign(tile.clone<TerrainHex>(), { cost: 1, blocked: !roads.has(`${tile.col},${tile.row}`) }));
    const entrances = structures.map((structure) => {
      const tile = grid.getHex({ col: structure.longitude, row: structure.latitude })!;
      const contact = getWorldStructureEntrance(tile, tile.height * resolveWorldStructure(structure.image, structure.route)!.height, resolveWorldStructure(structure.image, structure.route)!);
      const landing = routeGrid.toArray().filter((tile) => !tile.blocked).sort((a, b) => Math.hypot(a.x - contact.x, a.y - contact.y) - Math.hypot(b.x - contact.x, b.y - contact.y))[0]!;
      expect(Math.hypot(landing.x - contact.x, landing.y - contact.y)).toBeLessThan(tile.height * 2);
      expect(roads.has(`${tile.col},${tile.row}`)).toBe(false);
      return landing;
    });
    const finder = new PathCalculator(routeGrid);
    for (const entrance of entrances.slice(1)) expect(finder.getShortestPath(entrances[0]!, entrance)).toBeDefined();
    expect(grid.toArray().map((tile) => ({ cost: tile.cost, blocked: tile.blocked, spec: tile.spec, authored: tile.authored }))).toEqual(before);
  });

  it("retains authored roads when no stock services need a landscape", () => {
    const { grid } = town();
    const tile = grid.getHex({ col: 1, row: 1 })!;
    tile.zone = "road";
    expect([...planVillageLandscape(grid, [], null)]).toEqual(["1,1"]);
  });
  it.each([
    ["training.dummy", 0.82, 94, 192],
    ["training.rail", 0.65, 116, 87],
  ] as const)("keeps authored %s at its physical height and exact desert position", (assetKey, height, width, frameHeight) => {
    const { grid, map } = town();
    const tile = grid.getHex({ col: 5, row: 3 })!;
    tile.spec = mergeTerrainSpecs([]).get("dessert");
    map.objects = [{ id: "target", type: "decoration", x: 5, y: 3, assetKey }];
    const target = sectorSpriteDescriptions({ grid, map, structures: [], wall: null, lightLayout: false, decorations: DECORATION_ASSETS_BY_KEY })
      .find(sprite => sprite.id === "target")!;
    expect(target.x).toBe(tile.x);
    expect(target.groundY).toBeCloseTo(tile.y + tile.height * (height * 0.1 - 0.5));
    expect(target.size).toBeCloseTo(tile.height * height);
    expect(target.preserveAspect).toBe(true);
    expect(target.frame).toMatchObject({ width, height: frameHeight });
  });
  it("joins every closed wall panel to its real hex corners with upright gate piers", () => {
    const { map } = town();
    map.width = map.height = 27;
    map.tiles = Array.from({ length: 729 }, (_, i) => ({ ...map.tiles[0]!, x: i % 27, y: Math.floor(i / 27), zone: "village" }));
    const { grid, villageWallPlan: wall } = prepareSectorGrid(1024, alea(1), 1, [{ longitude: 13, latitude: 13, hasPage: 1 }] as VillageStructure[], map, mergeTerrainSpecs([]), "VILLAGE");
    const before = grid.toArray().map(tile => [tile.cost, tile.blocked]);
    const sprites = sectorSpriteDescriptions({ grid, map, structures: [], wall, lightLayout: false, decorations: DECORATION_ASSETS_BY_KEY });
    const corners = [[2,3], [5,0], [3,4], [1,2], [4,5], [0,1]];
    const axes = new Set<string>();
    for (const edge of wall!.edges) {
      if (edge.kind === "gate") continue;
      const panel = sprites.find(sprite => sprite.id === `wall:${edge.vertices.join(":")}`);
      if (!panel) continue;
      axes.add(edge.axis);
      const spec = getVillageWallSpriteSpec(STONE_VILLAGE_WALL_KIT, edge.kind, edge.axis);
      expect(panel.image).toBe(spec.url);
      const tile = grid.getHex({ col: edge.tile.x, row: edge.tile.y })!;
      const endpoints = corners[edge.direction]!.map(index => tile.corners[index]!).sort((a,b) => a.x-b.x);
      for (const [index, contact] of spec.connectors.entries()) {
        const x = panel.x + (contact.x-panel.anchorX!) * panel.width!;
        const y = panel.y - (contact.y-panel.anchorY!) * panel.size + (x-panel.x) * (panel.shearY ?? 0);
        expect(x).toBeCloseTo(endpoints[index]!.x);
        expect(y).toBeCloseTo(endpoints[index]!.y);
      }
    }
    expect(axes.size).toBe(3);
    const piers = sprites.filter(sprite => sprite.kind === "village_wall_pier");
    expect(piers.length).toBeGreaterThan(0);
    for (const pier of piers) {
      expect(pier.width).toBeUndefined();
      expect(pier.preserveAspect).toBe(true);
      expect(pier.anchorY).toBe(STONE_VILLAGE_WALL_KIT.pier.anchorY);
    }
    expect(grid.toArray().map(tile => [tile.cost, tile.blocked])).toEqual(before);
  });
  it("preserves roofed gate proportions across broad openings and leaves the passage clear", () => {
    const { map } = town();
    map.width = map.height = 27;
    map.tiles = Array.from({ length: 729 }, (_, i) => ({ ...map.tiles[0]!, x: i % 27, y: Math.floor(i / 27), zone: "village" }));
    const { grid, villageWallPlan: wall } = prepareSectorGrid(1024, alea(1), 1, [{ longitude: 13, latitude: 13, hasPage: 1 }] as VillageStructure[], map, mergeTerrainSpecs([]), "VILLAGE");
    const before = grid.toArray().map(tile => [tile.cost, tile.blocked]);
    const corners = [[2,3], [5,0], [3,4], [1,2], [4,5], [0,1]];
    const axes = new Set<string>();
    for (const [index, edge] of wall!.edges.entries()) {
      const plan = { ...wall!, edges: wall!.edges.map((candidate, i) => ({ ...candidate, kind: i === index ? "gate" as const : "wall" as const })) };
      const sprites = sectorSpriteDescriptions({ grid, map, structures: [], wall: plan, lightLayout: false, decorations: DECORATION_ASSETS_BY_KEY });
      const gate = sprites.find(sprite => sprite.id === `wall:${edge.vertices.join(":")}`);
      if (!gate) continue; // Depth-facing gates use an open passage between upright piers.
      axes.add(edge.axis);
      expect(gate.width! / gate.size).toBeCloseTo(gate.frame!.width / gate.frame!.height);
      expect(Math.abs(gate.shearY ?? 0)).toBeLessThan(.3);
      const ends = edge.vertices.map(vertex => {
        const other = plan.edges[plan.vertices.find(v => v.id === vertex)!.edges.find(i => i !== index)!]!;
        expect(sprites.some(sprite => sprite.id === `wall:${other.vertices.join(":")}`)).toBe(false);
        const id = other.vertices.find(id => id !== vertex)!;
        const tile = grid.getHex({ col: other.tile.x, row: other.tile.y })!;
        return tile.corners[corners[other.direction]![other.vertices.indexOf(id)]!]!;
      }).sort((a,b) => a.x-b.x);
      const spec = getVillageWallSpriteSpec(STONE_VILLAGE_WALL_KIT, "gate", edge.axis, (ends[1]!.y-ends[0]!.y)/(ends[1]!.x-ends[0]!.x));
      expect(gate.frame).toEqual(spec.frame);
      for (const [i, contact] of spec.connectors.entries()) {
        const x = gate.x+(contact.x-gate.anchorX!)*gate.width!;
        const y = gate.y-(contact.y-gate.anchorY!)*gate.size+(x-gate.x)*(gate.shearY ?? 0);
        expect(x).toBeCloseTo(ends[i]!.x);
        expect(y).toBeCloseTo(ends[i]!.y);
      }
    }
    expect(axes.size).toBe(3);
    expect(grid.toArray().map(tile => [tile.cost, tile.blocked])).toEqual(before);
  });
  it("keeps nearby road gates from consuming the same wall segment", () => {
    const { map } = town();
    map.width = map.height = 27;
    map.tiles = Array.from({ length: 729 }, (_, i) => ({ ...map.tiles[0]!, x: i % 27, y: Math.floor(i / 27), zone: Math.floor(i / 27) === 11 && [12,13,14].includes(i % 27) ? "road" : "village" }));
    const { grid, villageWallPlan: wall } = prepareSectorGrid(1024, alea(1), 1, [{ longitude: 13, latitude: 13, hasPage: 1 }] as VillageStructure[], map, mergeTerrainSpecs([]), "VILLAGE");
    const sprites = sectorSpriteDescriptions({ grid, map, structures: [], wall, lightLayout: false, decorations: DECORATION_ASSETS_BY_KEY });
    const gates = wall!.edges.filter(edge => edge.kind === "gate").map(edge => sprites.find(sprite => sprite.id === `wall:${edge.vertices.join(":")}`)!);
    expect(gates).toHaveLength(2);
    const intervals = gates.map(gate => {
      expect(gate.width! / gate.size).toBeCloseTo(gate.frame!.width / gate.frame!.height);
      expect(gate.size).toBeGreaterThan(grid.getHex({ col: 13, row: 13 })!.height * 1.2);
      const spec = Object.values(STONE_VILLAGE_WALL_KIT.gates).find(spec => spec.frame!.x === gate.frame!.x)!;
      return spec.connectors.map(contact => gate.x+(contact.x-gate.anchorX!)*gate.width!);
    }).sort((a,b) => a[0]!-b[0]!);
    expect(intervals[0]![1]!).toBeLessThanOrEqual(intervals[1]![0]! + .001);
  });
  it("connects disconnected authored streets to the service network", () => {
    const { grid, structures } = town();
    grid.getHex({ col: 0, row: 6 })!.zone = "road";
    grid.getHex({ col: 0, row: 7 })!.zone = "road";
    const roads = planVillageLandscape(grid, structures, null);
    const routeGrid = grid.map(tile => Object.assign(tile.clone<TerrainHex>(), { cost: 1, blocked: !roads.has(`${tile.col},${tile.row}`) }));
    const service = structures[0]!, tile = grid.getHex({ col: service.longitude, row: service.latitude })!;
    const art = resolveWorldStructure(service.image, service.route)!;
    const contact = getWorldStructureEntrance(tile, tile.height * art.height, art);
    const [x, y] = getWorldForecourtPoint(contact, 0, tile.height * .7);
    const landing = routeGrid.pointToHex({ x, y })!;
    expect(new PathCalculator(routeGrid).getShortestPath(routeGrid.getHex({ col: 0, row: 7 })!, landing)).toBeDefined();
    expect(roads.has("0,6")).toBe(true);
    expect(roads.has("0,7")).toBe(true);
  });
  it("joins island services with boardwalks while retaining the water face and movement data", () => {
    const { grid, structures } = town();
    for (const tile of grid) if (tile.col === 4) tile.spec = mergeTerrainSpecs([]).get("ocean");
    const before = grid.toArray().map((tile) => [tile.cost, tile.blocked, tile.spec]);
    const roads = planVillageLandscape(grid, structures, null);
    const crossing = grid.toArray().find((tile) => tile.spec?.isWater && roads.has(`${tile.col},${tile.row}`));
    expect(crossing).toBeDefined();
    const data = buildSectorTerrainData(grid, alea(1), false, { roads });
    expect(data.faceOffsets.get(`${crossing!.col},${crossing!.row}`)).toBeLessThan(0);
    expect(data.surface.length).toBeGreaterThan(0);
    expect(grid.toArray().map((tile) => [tile.cost, tile.blocked, tile.spec])).toEqual(before);
  });
  it("connects sparse trailheads through a roadside landmark", () => {
    const { grid, structures } = town();
    grid.getHex({ col: 0, row: 2 })!.zone = "road";
    grid.getHex({ col: 7, row: 2 })!.zone = "road";
    const roads = planVillageLandscape(grid, structures.slice(0, 1), null);
    expect(roads.has("0,2")).toBe(true);
    expect(roads.has("7,2")).toBe(true);
    const routeGrid = grid.map((tile) => Object.assign(tile.clone<TerrainHex>(), { cost: 1, blocked: !roads.has(`${tile.col},${tile.row}`) }));
    expect(new PathCalculator(routeGrid).getShortestPath(routeGrid.getHex({ col: 0, row: 2 })!, routeGrid.getHex({ col: 7, row: 2 })!)).toBeDefined();
  });
  it("keeps landmark paving on dry ground without moving terrain faces or navigation", () => {
    const { grid } = town();
    const tile = grid.getHex({ col: 3, row: 4 })!;
    const sprite: WorldSpriteDescription = { id: "court", kind: "structure", image: "hall.png", size: 100, x: tile.x, y: tile.y, groundY: tile.y, entrance: { x: tile.x, y: tile.y, width: tile.height * 0.6 } };
    const before = grid.toArray().map((tile) => [tile.cost, tile.blocked, tile.spec]);
    const options = { sector: 724, sprites: [sprite], roads: new Set<string>() };
    const plain = buildSectorTerrainData(grid, alea(1), false, options);
    sprite.entrance!.hasCourt = true;
    const paved = buildSectorTerrainData(grid, alea(1), false, options);
    const added = paved.surface.slice(plain.surface.length);
    expect(added.length).toBeGreaterThan(0);
    // Stone courses follow the front facade; their receding edges share the diagonal approach.
    for (let index = 0; index < added.length; index += 12) {
      const dx = added[index + 2]! - added[index]!, dy = added[index + 3]! - added[index + 1]!;
      expect(dx).toBeGreaterThan(0);
      expect(Math.abs(dy + dx * .18)).toBeLessThanOrEqual(1);
      expect(added[index + 10]!).toBeLessThan(added[index]!);
      expect(added[index + 11]!).toBeLessThan(added[index + 1]!);
    }
    for (let index = 0; index < added.length; index += 2) expect(grid.pointToHex({ x: added[index]!, y: added[index + 1]! })?.spec?.isWater).toBe(false);
    expect(paved.faceOffsets).toEqual(plain.faceOffsets);
    expect(grid.toArray().map((tile) => [tile.cost, tile.blocked, tile.spec])).toEqual(before);
    expect(buildSectorTerrainData(grid, alea(1), true, options).surface.length).toBe(0);
  });
  it("retains narrow through-paths across a shrine precinct without copying full terrain faces", () => {
    const { grid } = town();
    const tile = grid.getHex({ col: 2, row: 3 })!;
    const sprite: WorldSpriteDescription = { id: "shrine", kind: "structure", image: "shrine.png", size: 100, x: tile.x, y: tile.y, groundY: tile.y,
      entrance: { x: tile.x, y: tile.y + tile.height, width: tile.height * 0.6, hasCourt: true } };
    const options = { sector: 555, sprites: [sprite], roads: new Set(["2,3"]) };
    const plain = buildSectorTerrainData(grid, alea(1), false, options);
    sprite.entrance!.hasPrecinct = true;
    const precinct = buildSectorTerrainData(grid, alea(1), false, options);
    const batch = plain.batches.find((batch) => batch.tiles.some((tile) => tile.key === "2,3"))!;
    const road = batch.tiles.find((tile) => tile.key === "2,3")!;
    const face = batch.positions.slice(road.start * 2, (road.start + road.count) * 2);
    expect(precinct.surface.some((_, index) => face.every((value, offset) => precinct.surface[index + offset] === value))).toBe(false);
    const path = buildSectorTerrainData(grid, alea(1), false, { roads: options.roads });
    expect(precinct.surface.some((_, index) => path.surface.every((value, offset) => precinct.surface[index + offset] === value))).toBe(true);
    expect(precinct.batches.map((batch) => batch.positions)).toEqual(plain.batches.map((batch) => batch.positions));
    expect(precinct.faceOffsets).toEqual(plain.faceOffsets);
  });
  it("keeps civic flagstones inside the village enclosure", () => {
    const { grid, map } = town();
    const tile = grid.getHex({ col: 3, row: 3 })!;
    const wall = planVillageWalls(map, [{ longitude: 3, latitude: 3, hasPage: 1 }]);
    const interior = new Set(wall.interior.map(point => `${point.x},${point.y}`));
    const sprite: WorldSpriteDescription = { id: "hall", kind: "structure", image: "hall.png", size: tile.height * 4.4, x: tile.x, y: tile.y, groundY: tile.y,
      entrance: { ...getWorldStructureEntrance(tile, tile.height * 4.4), hasCourt: true } };
    const options = { wall, roads: new Set<string>() };
    const plain = buildSectorTerrainData(grid, alea(1), false, options);
    const paved = buildSectorTerrainData(grid, alea(1), false, { ...options, sprites: [sprite] });
    const added = paved.surface.slice(plain.surface.length);
    expect(added.length).toBeGreaterThan(0);
    for (let index = 0; index < added.length; index += 2) {
      const point = grid.pointToHex({ x: added[index]!, y: added[index + 1]! })!;
      expect(interior.has(`${point.col},${point.row}`)).toBe(true);
    }
  });
  it("retains complete surface geometry for a dense authored snow and ice map", () => {
    const map: NormalizedSectorMap = { ...town().map, width: 26, height: 26,
      tiles: Array.from({ length: 26 * 26 }, (_, index) => ({ x: index % 26, y: Math.floor(index / 26), terrain: index % 2 ? "snow" : "ice", walkCost: 1, blocked: false, zone: "wilderness", battleBiome: "ice" })) };
    const { grid } = prepareSectorGrid(1024, alea(1), 3, [], map, mergeTerrainSpecs([]), null);
    const data = buildSectorTerrainData(grid, alea(1), false);
    expect(data.surface.length).toBeGreaterThan(131072);
    expect(data.surfaceColors.length).toBe((data.surface.length / 2) * 3);
    expect(data.batches.reduce((count, batch) => count + batch.tiles.length, 0)).toBe(676);
  });
});
