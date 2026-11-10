import { describe, expect, it, vi } from "bun:test";
import alea from "alea";
import {
  applySectorTiles,
  createSectorGeneration,
  createSectorWorkerHandler,
  recordSectorTiles,
  type SectorWorkerReply,
  type SectorWorkerRequest,
  sectorResultTransfers,
  type WindowRequest,
} from "@/libs/rendering/sectorGeneration";
import {
  createSectorGenerator,
  createSectorWorkerTransport,
  type SectorWorkerLike,
} from "@/libs/rendering/sectorGenerationClient";
import { prepareSectorGrid } from "@/libs/sector-map/sector-grid";
import { BUILTIN_TERRAINS_BY_KEY } from "@/libs/sector-map/terrains";
import { sectorMap } from "../../setup/sectorMap";

const library: WindowRequest["library"] = {
  version: "library-1",
  terrains: new Map([["ocean", BUILTIN_TERRAINS_BY_KEY.get("ocean")!]]),
  decorations: new Map(),
  mapAssets: [],
};

/** A wild sector; odd sectors have a coast whose seabed the window's field shapes. */
const source = (sector: number) => ({
  sector,
  map: sectorMap(
    12,
    12,
    (x) =>
      sector % 2 && x >= 7 ? { terrain: "ocean", battleBiome: "ocean" as const } : {},
    { sector },
  ),
  structures: [],
  villageType: null,
  globalTileType: 1,
  locations: [],
});

/** A row of sectors centred on the second; source keys change with `revision`. */
const windowRequest = (sectors: number[], revision = 0): WindowRequest => ({
  key: JSON.stringify([sectors, revision]),
  logicalWidth: 1024,
  lightLayout: false,
  library,
  entries: sectors.map((sector, index) => ({
    dx: index - 1,
    dy: 0,
    sourceKey: `${sector}:${revision}`,
    source: source(sector),
  })),
});

const sectorRequest = (window: WindowRequest, sector: number, edgeOnly = false) => ({
  window: window.key,
  sector,
  artKey: `${sector}:art`,
  edgeOnly,
});

/** Runs the worker's handler behind real structured cloning, as a page's worker would. */
const workerFixture = (options: { fails?: boolean } = {}) => {
  const handle = createSectorWorkerHandler();
  const posted: SectorWorkerRequest[] = [];
  const worker: SectorWorkerLike = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    terminate: vi.fn(),
    postMessage: (message) => {
      const copy = structuredClone(message);
      posted.push(copy);
      queueMicrotask(() => {
        if (options.fails) {
          worker.onerror?.({ message: "boom", preventDefault: () => {} } as ErrorEvent);
          return;
        }
        const { reply, transfer } = handle(copy);
        worker.onmessage?.({
          data: structuredClone(reply, { transfer }),
        } as MessageEvent<SectorWorkerReply>);
      });
    },
  };
  return { worker, posted };
};

describe("sector generation", () => {
  it("records tile values a grid prepared elsewhere takes on", () => {
    const generation = createSectorGeneration();
    const window = windowRequest([10, 11, 12]);
    generation.window(window);
    const result = generation.sector(sectorRequest(window, 11));
    const { grid } = prepareSectorGrid(
      1024,
      alea(12),
      1,
      [],
      source(11).map,
      library.terrains,
      null,
      null,
    );
    expect(recordSectorTiles(grid)).not.toEqual(result.tiles);
    applySectorTiles(grid, result.tiles);
    expect(recordSectorTiles(grid)).toEqual(result.tiles);
    // The coast's seabed comes from the window's field, which the caller never builds.
    expect(grid.getHex({ col: 11, row: 6 })!.terrace).toBeLessThan(0);
    expect(grid.getHex({ col: 2, row: 6 })!.asset).toBe("ground");
  });

  it("rebuilds only the terrain under retained scenery, replaying the same water", () => {
    const generation = createSectorGeneration();
    const window = windowRequest([10, 11, 12]);
    generation.window(window);
    const full = generation.sector(sectorRequest(window, 11));
    const edge = generation.sector(sectorRequest(window, 11, true));
    expect(full.descriptions?.length).toBeGreaterThan(0);
    expect(edge.descriptions).toBeUndefined();
    expect(edge.data).toEqual(full.data);
    expect(edge.tiles).toEqual(full.tiles);
    // Scenery built for other terraces is generated again rather than reused.
    const rebuilt = generation.sector({
      ...sectorRequest(window, 11, true),
      artKey: "new",
    });
    expect(rebuilt.descriptions).toEqual(full.descriptions);
  });

  it("names a request's window and refuses sectors outside it", () => {
    const generation = createSectorGeneration();
    const window = windowRequest([10, 11, 12]);
    expect(() => generation.sector(sectorRequest(window, 11))).toThrow();
    generation.window(window);
    expect(() => generation.sector(sectorRequest(window, 13))).toThrow();
  });

  it("hands every vertex stream over without copying", () => {
    const generation = createSectorGeneration();
    const window = windowRequest([10, 11, 12]);
    generation.window(window);
    const result = generation.sector(sectorRequest(window, 11));
    const streams = [
      ...result.data.segments.flatMap((segment) =>
        Object.values(segment).filter((value) => ArrayBuffer.isView(value)),
      ),
      result.data.surface,
      result.data.surfaceColors,
      result.data.boundary,
    ];
    const transfers = sectorResultTransfers(result);
    expect(transfers).toHaveLength(streams.length);
    const expected = structuredClone(result);
    expect(structuredClone(result, { transfer: transfers })).toEqual(expected);
  });
});

describe("sector generation worker", () => {
  it("matches in-process results while sending each source only once", async () => {
    const { worker, posted } = workerFixture();
    const start = vi.fn(() => worker);
    const generator = createSectorGenerator(
      createSectorWorkerTransport(start, vi.fn()),
    );
    const local = createSectorGeneration();
    const first = windowRequest([10, 11, 12]);
    expect(await generator.window(first)).toEqual(local.window(first));
    local.window(first);
    expect(await generator.sector(sectorRequest(first, 11))).toEqual(
      local.sector(sectorRequest(first, 11)),
    );
    // A crossing brings one sector into the window; the rest are already held.
    const crossed = windowRequest([11, 12, 13]);
    expect(await generator.window(crossed)).toEqual(local.window(crossed));
    expect(await generator.sector(sectorRequest(crossed, 13))).toEqual(
      local.sector(sectorRequest(crossed, 13)),
    );
    const sent = posted.flatMap((message) =>
      message.type === "window"
        ? [
            {
              library: !!message.request.library,
              sources: message.request.entries
                .filter((entry) => entry.source)
                .map((entry) => entry.sector),
            },
          ]
        : [],
    );
    expect(sent).toEqual([
      { library: true, sources: [10, 11, 12] },
      { library: false, sources: [13] },
    ]);
    // Changed sources are sent again.
    await generator.window(windowRequest([11, 12, 13], 1));
    expect(posted.at(-1)).toMatchObject({ type: "window" });
    const last = posted.at(-1);
    expect(
      last?.type === "window" && last.request.entries.filter((entry) => entry.source),
    ).toHaveLength(3);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("passes generation errors on and keeps the worker", async () => {
    const { worker } = workerFixture();
    const onFailure = vi.fn();
    const transport = createSectorWorkerTransport(() => worker, onFailure);
    const generator = createSectorGenerator(transport);
    const window = windowRequest([10, 11, 12]);
    await generator.window(window);
    await expect(generator.sector(sectorRequest(window, 99))).rejects.toThrow(
      "not part of the requested window",
    );
    expect(transport.isAvailable()).toBe(true);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("generates in process once the worker fails, reporting the failure once", async () => {
    const { worker } = workerFixture({ fails: true });
    const onFailure = vi.fn();
    const start = vi.fn(() => worker);
    const generator = createSectorGenerator(
      createSectorWorkerTransport(start, onFailure),
    );
    const local = createSectorGeneration();
    const window = windowRequest([10, 11, 12]);
    expect(await generator.window(window)).toEqual(local.window(window));
    expect(await generator.sector(sectorRequest(window, 12))).toEqual(
      local.sector(sectorRequest(window, 12)),
    );
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("builds the window's field in process when the worker stops after building it", async () => {
    const { worker } = workerFixture();
    const transport = createSectorWorkerTransport(() => worker, vi.fn());
    const generator = createSectorGenerator(transport);
    const window = windowRequest([10, 11, 12]);
    await generator.window(window);
    worker.onerror?.({ message: "lost", preventDefault: () => {} } as ErrorEvent);
    const local = createSectorGeneration();
    local.window(window);
    expect(await generator.sector(sectorRequest(window, 11))).toEqual(
      local.sector(sectorRequest(window, 11)),
    );
  });
});
