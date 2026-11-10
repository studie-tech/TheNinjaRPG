import alea from "alea";
import type { Grid } from "honeycomb-grid";
import type { MapAsset, VillageStructure } from "@/drizzle/schema";
import type { TerrainHex } from "@/libs/hexgrid";
import { buildSectorTerrainData } from "@/libs/rendering/sectorData";
import {
  sectorSpriteDescriptions,
  type WorldSpriteDescription,
} from "@/libs/rendering/sectorSprites";
import { type HexTerrainData, sectorFieldCell } from "@/libs/rendering/terrainData";
import {
  createTerrainField,
  liftSpritesToTerrain,
  objectFootprints,
  sectorRelief,
  type TerrainCell,
  type TerrainField,
  waterSampleKey,
} from "@/libs/rendering/terrainElevation";
import { planVillageLandscape } from "@/libs/rendering/villageLandscape";
import type { DecorationAsset } from "@/libs/sector-map/decorations";
import { buildWindowNav, type WindowNav } from "@/libs/sector-map/navigation";
import { prepareSectorGrid } from "@/libs/sector-map/sector-grid";
import type { TerrainSpec } from "@/libs/sector-map/terrains";
import type { NormalizedSectorMap } from "@/libs/sector-map/types";
import { planVillageWallWindow } from "@/libs/sector-map/village-walls";
import type { MapLocation } from "@/validators/mapLocation";

/**
 * Sector generation for the travel window: the terrain field across the window, each
 * sector's scenery descriptions and its terrain mesh data. It reads plain inputs and returns
 * structured-cloneable results, so it runs in a worker (`sectorGeneration.worker.ts`) as well
 * as in process. The caller builds its own sector grids from the same inputs and records the
 * tile values generation derives with `applySectorTiles`.
 */
export const createSectorGeneration = () => {
  const windows = new Map<string, GenerationWindow>();
  const builds = new Map<number, SectorBuildState>();
  /** Field grids of the latest window; a crossing keeps those of the sectors it retains. */
  let fieldGrids = new Map<number, { sourceKey: string; grid: Grid<TerrainHex> }>();

  const sectorBuild = (
    state: GenerationWindow,
    entry: WindowSourceEntry,
    artKey: string,
  ): SectorGenerationResult => {
    const { source } = entry;
    const { library, lightLayout } = state.request;
    const prng = alea(source.sector + 1);
    const { grid, villageWallPlan: wall } = prepareSectorGrid(
      state.request.logicalWidth,
      prng,
      source.globalTileType,
      source.structures,
      source.map,
      library.terrains,
      source.villageType,
      state.wallPlans.get(source.sector) ?? null,
    );
    const roads = planVillageLandscape(grid, source.structures, wall);
    const descriptions = sectorSpriteDescriptions({
      map: source.map,
      grid,
      structures: source.structures,
      decorations: library.decorations,
      wall,
      lightLayout,
      locations: source.locations,
      mapAssets: library.mapAssets,
      roads,
    });
    // An edge-only rebuild replays the water phases from the generator's state here.
    const seed = prng.exportState();
    const data = buildSectorTerrainData(grid, prng, lightLayout, {
      sector: source.sector,
      sprites: descriptions,
      wall,
      roads,
      field: sectorField(state, entry, grid),
    });
    liftSpritesToTerrain(descriptions, grid);
    builds.delete(source.sector);
    builds.set(source.sector, {
      sourceKey: entry.sourceKey,
      artKey,
      grid,
      roads,
      wall,
      seed,
      descriptions,
    });
    while (builds.size > RETAINED_BUILDS) {
      const oldest = builds.keys().next().value;
      if (oldest === undefined) break;
      builds.delete(oldest);
    }
    return { descriptions, data, tiles: recordSectorTiles(grid) };
  };

  return {
    /**
     * Registers the window's sources and builds its terrain field, returning what the field
     * gives each sector. Without a field (light layout) no sector has a result.
     */
    window: (request: WindowRequest) => {
      let state = windows.get(request.key);
      if (!state) {
        state = createGenerationWindow(request, fieldGrids);
        fieldGrids = state.fieldGrids;
        windows.set(request.key, state);
        while (windows.size > RETAINED_WINDOWS) {
          const oldest = windows.keys().next().value;
          if (oldest === undefined) break;
          windows.delete(oldest);
        }
      }
      return state.results;
    },
    /**
     * A sector's terrain data and the tile values it derives. Scenery descriptions are
     * generated too unless `edgeOnly` asks for new terrain under scenery that is still
     * current, which only the sector's own terraces and sources decide.
     */
    sector: (request: SectorRequest): SectorGenerationResult => {
      const state = windows.get(request.window);
      const entry = state?.entries.get(request.sector);
      if (!state || !entry)
        throw new Error(`Sector ${request.sector} is not part of the requested window`);
      const build = builds.get(request.sector);
      const field = state.field && sectorField(state, entry, build?.grid);
      if (
        !request.edgeOnly ||
        !build ||
        !field ||
        build.artKey !== request.artKey ||
        build.sourceKey !== entry.sourceKey
      )
        return sectorBuild(state, entry, request.artKey);
      const prng = alea(request.sector + 1);
      prng.importState(build.seed);
      const data = buildSectorTerrainData(build.grid, prng, state.request.lightLayout, {
        sector: request.sector,
        sprites: build.descriptions,
        wall: build.wall,
        roads: build.roads,
        field,
      });
      return { data, tiles: recordSectorTiles(build.grid) };
    },
  };
};

/**
 * Message handler of the generation worker. Requests run one at a time in arrival order;
 * sources and libraries sent before are kept, mirroring the page's record of what it sent,
 * so a crossing transfers only the sectors that enter the window.
 */
export const createSectorWorkerHandler = () => {
  const generation = createSectorGeneration();
  let library: SectorLibrary | null = null;
  let sources = new Map<number, SectorSource>();
  return (
    message: SectorWorkerRequest,
  ): { reply: SectorWorkerReply; transfer: ArrayBuffer[] } => {
    try {
      if (message.type === "window") {
        const { request } = message;
        if (request.library) library = request.library;
        if (!library) throw new Error("Sector library was never sent");
        const window = new Map<number, SectorSource>();
        const entries = request.entries.map(({ source, ...entry }) => {
          const known = source ?? sources.get(entry.sector);
          if (!known) throw new Error(`Sector ${entry.sector} source was never sent`);
          window.set(entry.sector, known);
          return { ...entry, source: known };
        });
        sources = window;
        const result = generation.window({ ...request, library, entries });
        return { reply: { id: message.id, result }, transfer: [] };
      }
      const result = generation.sector(message.request);
      return {
        reply: { id: message.id, result },
        transfer: sectorResultTransfers(result),
      };
    } catch (error) {
      return {
        reply: {
          id: message.id,
          error: {
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          },
        },
        transfer: [],
      };
    }
  };
};

/** Records the tile values generation derives, in grid order, for `applySectorTiles`. */
export const recordSectorTiles = (grid: Grid<TerrainHex>): SectorTileResults => {
  const tiles: SectorTileResults = { asset: [], cost: [], terrace: [], frozen: [] };
  for (const tile of grid) {
    tiles.asset.push(tile.asset);
    tiles.cost.push(tile.cost);
    tiles.terrace.push(tile.terrace);
    tiles.frozen.push(tile.frozen);
  }
  return tiles;
};

/** Copies generated tile values onto a grid prepared from the same sources. */
export const applySectorTiles = (grid: Grid<TerrainHex>, tiles: SectorTileResults) => {
  let index = 0;
  for (const tile of grid) {
    tile.asset = tiles.asset[index];
    tile.cost = tiles.cost[index] ?? tile.cost;
    tile.terrace = tiles.terrace[index];
    tile.frozen = tiles.frozen[index];
    index++;
  }
};

/** Buffers of a result's vertex streams, which a worker hands over instead of copying. */
export const sectorResultTransfers = (result: SectorGenerationResult) => {
  const buffers = new Set<ArrayBuffer>();
  const collect = (value: unknown) => {
    if (ArrayBuffer.isView(value) && value.buffer instanceof ArrayBuffer)
      buffers.add(value.buffer);
  };
  const { data } = result;
  for (const segment of data.segments)
    for (const value of Object.values(segment)) collect(value);
  collect(data.surface);
  collect(data.surfaceColors);
  collect(data.boundary);
  return [...buffers];
};

const createGenerationWindow = (
  request: WindowRequest,
  previous: GenerationWindow["fieldGrids"],
): GenerationWindow => {
  const entries = new Map(request.entries.map((entry) => [entry.source.sector, entry]));
  const placed = request.entries.map((entry) => ({ ...entry.source, ...entry }));
  const wallPlans = planVillageWallWindow(placed);
  const state: GenerationWindow = {
    request,
    entries,
    wallPlans,
    nav: null,
    field: null,
    results: new Map(),
    fieldGrids: new Map(),
  };
  // One terrain field spans the same aligned grid as travel, without changing its navigation.
  if (request.lightLayout) return state;
  const nav = request.nav ?? buildWindowNav(placed, 10);
  if (!nav) return state;
  const cells = new Map<TerrainHex, TerrainCell>();
  for (const entry of request.entries) {
    const { source } = entry;
    // Settlements stay level; wild sectors rise in steps around their shrines and paths.
    const settled = !!source.villageType;
    const relief = sectorRelief(source.sector, source.map.width, source.map.height);
    const retained = previous.get(source.sector);
    const grid =
      retained?.sourceKey === entry.sourceKey
        ? retained.grid
        : prepareSectorGrid(
            request.logicalWidth,
            alea(source.sector + 1),
            source.globalTileType,
            source.structures,
            source.map,
            request.library.terrains,
            source.villageType,
            wallPlans.get(source.sector) ?? null,
          ).grid;
    state.fieldGrids.set(source.sector, { sourceKey: entry.sourceKey, grid });
    const footprints = objectFootprints(grid, source.map.objects);
    for (const tile of grid) {
      const unified = nav.toUnified(entry.dx, entry.dy, tile.col, tile.row);
      if (unified)
        cells.set(unified, sectorFieldCell(tile, { settled, footprints, relief }));
    }
  }
  const field = createTerrainField(nav.pathFinder.grid, cells);
  Object.assign(state, { nav, field });
  for (const entry of request.entries) {
    const origin = nav.toUnified(entry.dx, entry.dy, 0, 0);
    if (origin)
      state.results.set(
        entry.source.sector,
        terrainResultKey(nav.pathFinder.grid, cells, field, origin, entry.source.map),
      );
  }
  return state;
};

/** The window's terrain field seen from one sector, whose local points map onto the window grid. */
const sectorField = (
  state: GenerationWindow,
  entry: WindowSourceEntry,
  grid: Grid<TerrainHex> | undefined,
): TerrainField | undefined => {
  const { nav, field } = state;
  const { dx, dy } = entry;
  const unifiedOrigin = nav?.toUnified(dx, dy, 0, 0),
    localOrigin = grid?.getHex({ col: 0, row: 0 });
  if (!nav || !field || !unifiedOrigin || !localOrigin) return undefined;
  const toWindow = (point: { x: number; y: number }) => ({
    x:
      unifiedOrigin.x +
      ((point.x - localOrigin.x) * unifiedOrigin.width) / localOrigin.width,
    y:
      unifiedOrigin.y +
      ((point.y - localOrigin.y) * unifiedOrigin.height) / localOrigin.height,
  });
  return {
    level: (tile) => {
      const unified = nav.toUnified(dx, dy, tile.col, tile.row);
      return unified ? field.level(unified) : 0;
    },
    sample: (point) => field.sample(toWindow(point)),
    at: (point) => field.at(toWindow(point)),
  };
};

/**
 * What the terrain field gives one sector: its tiles' terraces, its water's ice and shore
 * samples, and the terraces just across its borders that its edge walls drop to. Window
 * changes that leave these alone keep the sector's terrain and artwork.
 */
const terrainResultKey = (
  grid: Grid<TerrainHex>,
  cells: ReadonlyMap<TerrainHex, TerrainCell>,
  field: TerrainField,
  origin: TerrainHex,
  map: Pick<NormalizedSectorMap, "width" | "height">,
): TerrainResultKey => {
  let inside = "",
    edge = "";
  for (let row = origin.row - 1; row <= origin.row + map.height; row++) {
    for (let col = origin.col - 1; col <= origin.col + map.width; col++) {
      const isInside =
        col >= origin.col &&
        col < origin.col + map.width &&
        row >= origin.row &&
        row < origin.row + map.height;
      const tile = grid.getHex({ col, row });
      const cell = tile && cells.get(tile);
      let part = " ";
      if (tile && cell) {
        part = String.fromCharCode(76 + field.level(tile));
        if (isInside && cell.isWater)
          for (const corner of tile.corners)
            part += waterSampleKey(field.sample(corner));
      }
      if (isInside) inside += part;
      else edge += part;
    }
    inside += "/";
  }
  return { inside, edge };
};

/** Fields of the current window and the one a stale request may still name. */
const RETAINED_WINDOWS = 2;
/** Two windows of sectors keep their scenery inputs for edge-only terrain rebuilds. */
const RETAINED_BUILDS = 18;

/** Everything a sector's generated content depends on besides its window neighbours. */
export type SectorSource = {
  sector: number;
  map: NormalizedSectorMap;
  structures: VillageStructure[];
  villageType: string | null;
  globalTileType: number;
  locations: MapLocation[];
};

/** Content libraries shared by every sector; `version` changes whenever their content does. */
export type SectorLibrary = {
  version: string;
  terrains: Map<string, TerrainSpec>;
  decorations: Map<string, DecorationAsset>;
  mapAssets: Pick<MapAsset, "id" | "imageUrl" | "renderScale">[];
};

/** A sector's place in the window; `sourceKey` changes whenever its source does. */
export type WindowSourceEntry = {
  dx: number;
  dy: number;
  sourceKey: string;
  source: SectorSource;
};

export type WindowRequest = {
  /** Identity of the window's sectors, offsets and sources; equal keys share one field. */
  key: string;
  logicalWidth: number;
  lightLayout: boolean;
  library: SectorLibrary;
  entries: WindowSourceEntry[];
  /** Navigation already built for these entries, shared when generation runs in process. */
  nav?: WindowNav | null;
};

export type SectorRequest = {
  /** Key of the window request whose field the sector's terrain stands on. */
  window: string;
  sector: number;
  /** The sector's sources and own terraces: what its scenery depends on. */
  artKey: string;
  edgeOnly: boolean;
};

export type TerrainResultKey = { inside: string; edge: string };

/** Tile values generation derives, in grid order. */
export type SectorTileResults = {
  asset: (string | undefined)[];
  cost: number[];
  terrace: (number | undefined)[];
  frozen: (boolean | undefined)[];
};

export type SectorGenerationResult = {
  /** Present whenever scenery was generated; an edge-only rebuild keeps the caller's artwork. */
  descriptions?: WorldSpriteDescription[];
  data: HexTerrainData;
  tiles: SectorTileResults;
};

/** A window request whose sources and library may be omitted when the worker holds them. */
export type WorkerWindowRequest = Omit<WindowRequest, "library" | "entries" | "nav"> & {
  library?: SectorLibrary;
  entries: (Omit<WindowSourceEntry, "source"> & {
    sector: number;
    source?: SectorSource;
  })[];
};

export type SectorWorkerRequest =
  | { id: number; type: "window"; request: WorkerWindowRequest }
  | { id: number; type: "sector"; request: SectorRequest };

export type SectorWorkerReply =
  | { id: number; result: Map<number, TerrainResultKey> | SectorGenerationResult }
  | { id: number; error: { message: string; stack?: string } };

type GenerationWindow = {
  request: WindowRequest;
  entries: Map<number, WindowSourceEntry>;
  wallPlans: ReturnType<typeof planVillageWallWindow>;
  nav: WindowNav | null;
  field: TerrainField | null;
  results: Map<number, TerrainResultKey>;
  fieldGrids: Map<number, { sourceKey: string; grid: Grid<TerrainHex> }>;
};

type SectorBuildState = {
  sourceKey: string;
  artKey: string;
  grid: Grid<TerrainHex>;
  roads: ReturnType<typeof planVillageLandscape>;
  wall: ReturnType<typeof prepareSectorGrid>["villageWallPlan"];
  /** The sector generator's state where terrain building starts consuming it. */
  seed: ReturnType<ReturnType<typeof alea>["exportState"]>;
  descriptions: WorldSpriteDescription[];
};
