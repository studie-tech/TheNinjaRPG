import { buildGlobeClimate } from "@/libs/rendering/globeClimate";
import {
  createSectorGeneration,
  type GlobeClimateRequest,
  type SectorGenerationResult,
  type SectorRequest,
  type SectorWorkerReply,
  type SectorWorkerRequest,
  type TerrainResultKey,
  type WindowRequest,
} from "@/libs/rendering/sectorGeneration";
import { reportRendererFailure } from "@/libs/rendering/telemetry";

/**
 * Sector generation for one travel scene, and the globe's climate field. In the browser it runs in a worker shared by every
 * scene, so building the sectors a crossing brings into view leaves the main thread free to
 * keep presenting frames. Where no worker can run, including Bun's test runner, whose
 * TypeScript worker would load outside a suite's module mocks, it runs in process. Once the
 * worker fails, generation continues in process.
 */
export const createSectorGenerator = (
  transport: SectorWorkerTransport | null = sharedTransport(),
): SectorGenerator => {
  let local: ReturnType<typeof createSectorGeneration> | null = null;
  let lastWindow: WindowRequest | null = null;
  const inProcess = () => {
    local ??= createSectorGeneration();
    return local;
  };
  return {
    window: async (request) => {
      lastWindow = request;
      if (transport?.isAvailable())
        try {
          return await transport.window(request);
        } catch (error) {
          if (!(error instanceof WorkerUnavailableError)) throw error;
        }
      return inProcess().window(request);
    },
    sector: async (request) => {
      if (transport?.isAvailable())
        try {
          return await transport.sector(request);
        } catch (error) {
          if (!(error instanceof WorkerUnavailableError)) throw error;
        }
      // A worker lost after building the window's field leaves it behind; build it here.
      if (lastWindow?.key === request.window) inProcess().window(lastWindow);
      return inProcess().sector(request);
    },
    globe: async (request) => {
      if (transport?.isAvailable())
        try {
          return await transport.globe(request);
        } catch (error) {
          if (!(error instanceof WorkerUnavailableError)) throw error;
        }
      return buildGlobeClimate(request.protectedSectors);
    },
  };
};

/**
 * Requests to a generation worker, sending only the sources and library it does not already
 * hold. The first failure terminates the worker, rejects every pending request as
 * unavailable and is reported once.
 */
export const createSectorWorkerTransport = (
  start: () => SectorWorkerLike,
  onFailure: (cause: unknown) => void,
) => {
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: unknown) => void }
  >();
  let worker: SectorWorkerLike | null = null;
  let isBroken = false;
  let nextId = 0;
  let sentLibrary: string | null = null;
  let sentSources = new Map<number, string>();

  const abandon = (cause: unknown) => {
    if (isBroken) return;
    isBroken = true;
    worker?.terminate();
    worker = null;
    onFailure(cause);
    for (const waiting of pending.values())
      waiting.reject(new WorkerUnavailableError("Sector generation worker stopped"));
    pending.clear();
  };

  const connect = () => {
    if (worker || isBroken) return worker;
    try {
      const started = start();
      started.onmessage = ({ data }) => {
        const waiting = pending.get(data.id);
        if (!waiting) return;
        pending.delete(data.id);
        if ("error" in data) {
          const error = new Error(data.error.message);
          if (data.error.stack) error.stack = data.error.stack;
          waiting.reject(error);
        } else waiting.resolve(data.result);
      };
      started.onerror = (event) => {
        event.preventDefault();
        abandon(new Error(event.message || "Sector generation worker failed"));
      };
      started.onmessageerror = () =>
        abandon(new Error("Sector generation worker sent an unreadable reply"));
      worker = started;
    } catch (error) {
      abandon(error);
    }
    return worker;
  };

  const post = <T>(message: WithoutId<SectorWorkerRequest>) => {
    const target = connect();
    if (!target)
      return Promise.reject<T>(
        new WorkerUnavailableError("Sector generation worker is unavailable"),
      );
    const id = ++nextId;
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      target.postMessage({ ...message, id });
    });
  };

  return {
    isAvailable: () => !isBroken,
    window: async (request: WindowRequest) => {
      const sendLibrary = sentLibrary !== request.library.version;
      const entries = request.entries.map(({ source, ...entry }) => ({
        ...entry,
        sector: source.sector,
        source: sentSources.get(source.sector) === entry.sourceKey ? undefined : source,
      }));
      sentLibrary = request.library.version;
      sentSources = new Map(
        request.entries.map((entry) => [entry.source.sector, entry.sourceKey]),
      );
      try {
        return await post<Map<number, TerrainResultKey>>({
          type: "window",
          request: {
            key: request.key,
            logicalWidth: request.logicalWidth,
            lightLayout: request.lightLayout,
            library: sendLibrary ? request.library : undefined,
            entries,
          },
        });
      } catch (error) {
        // The worker may hold only part of this request; send everything next time.
        sentLibrary = null;
        sentSources = new Map();
        throw error;
      }
    },
    sector: (request: SectorRequest) =>
      post<SectorGenerationResult>({ type: "sector", request }),
    globe: (request: GlobeClimateRequest) =>
      post<Uint8Array>({ type: "globe", request }),
  };
};

/** The worker every travel scene shares, started on first use; null where none can run. */
const sharedTransport = () => {
  if (shared !== undefined) return shared;
  shared =
    typeof window === "undefined" ||
    typeof Worker === "undefined" ||
    process.env.NODE_ENV === "test"
      ? null
      : createSectorWorkerTransport(
          () =>
            new Worker(new URL("./sectorGeneration.worker.ts", import.meta.url), {
              type: "module",
              name: "sector-generation",
            }),
          (cause) =>
            reportRendererFailure(cause, { surface: "travel", phase: "generation" }),
        );
  return shared;
};

let shared: SectorWorkerTransport | null | undefined;

/** Marks a request the worker never answered, which in-process generation then serves. */
class WorkerUnavailableError extends Error {}

export type SectorGenerator = {
  window: (request: WindowRequest) => Promise<Map<number, TerrainResultKey>>;
  sector: (request: SectorRequest) => Promise<SectorGenerationResult>;
  globe: (request: GlobeClimateRequest) => Promise<Uint8Array>;
};

export type SectorWorkerTransport = ReturnType<typeof createSectorWorkerTransport>;

/** The parts of a `Worker` generation uses. */
export type SectorWorkerLike = {
  postMessage: (message: SectorWorkerRequest) => void;
  terminate: () => void;
  onmessage: ((event: MessageEvent<SectorWorkerReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
};

type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;
