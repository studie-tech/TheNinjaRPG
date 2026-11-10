import { afterEach, describe, expect, it, vi } from "bun:test";
import { WebGLRenderer } from "pixi.js";
import { createFrameLoop } from "@/libs/rendering/frameLoop";
import { createLeaseCache } from "@/libs/rendering/leaseCache";
import { createGameRenderer } from "@/libs/rendering/runtime";
import { farmPlotAt, farmPlotPosition } from "@/libs/rendering/scenes/farmLayout";

describe("renderer initialization failure", () => {
  afterEach(() => vi.restoreAllMocks());

  it("rejects with the initialization error when teardown of a partial renderer also throws", async () => {
    const cause = new Error("This browser does not support WebGL");
    vi.spyOn(WebGLRenderer.prototype, "init").mockImplementation(async function (
      this: WebGLRenderer,
    ) {
      Object.assign(this, { view: { canvas: document.createElement("canvas") } });
      throw cause;
    });
    vi.spyOn(WebGLRenderer.prototype, "destroy").mockImplementation(() => {
      throw new TypeError("Cannot read properties of undefined (reading 'destroy')");
    });
    const start = createGameRenderer({
      surface: "travel",
      mount: document.createElement("div"),
      signal: new AbortController().signal,
      height: () => 100,
      onError: () => {},
    });
    await expect(start).rejects.toBe(cause);
  });
});

describe("renderer context loss", () => {
  const originals = {
    IntersectionObserver: globalThis.IntersectionObserver,
    ResizeObserver: globalThis.ResizeObserver,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    matchMedia: globalThis.matchMedia,
    AbortController: globalThis.AbortController,
  };
  let frame: FrameRequestCallback | null = null;
  let lost = false;
  const games: { dispose: () => void }[] = [];
  afterEach(() => {
    // The frame loop is shared by the module; leaving a scene subscribed would starve the next.
    for (const game of games.splice(0)) game.dispose();
    vi.restoreAllMocks();
    Object.assign(globalThis, originals);
    frame = null;
    lost = false;
  });
  const start = async (onError: (error: unknown) => void) => {
    class NoopObserver {
      observe() {}
      disconnect() {}
    }
    Object.assign(globalThis, {
      IntersectionObserver: NoopObserver,
      ResizeObserver: NoopObserver,
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        frame = callback;
        return 1;
      },
      cancelAnimationFrame: () => {
        frame = null;
      },
      matchMedia: () => ({ matches: false, addEventListener() {} }),
      // jsdom's canvas listeners only accept jsdom's own signals.
      AbortController: window.AbortController,
    });
    const canvas = document.createElement("canvas");
    vi.spyOn(WebGLRenderer.prototype, "init").mockImplementation(async function (
      this: WebGLRenderer,
    ) {
      // Only what the runtime reads after initialization; a real GL context is unavailable here.
      const gl = { isContextLost: () => lost };
      for (const [key, value] of Object.entries({
        canvas,
        gl,
        context: {
          get isLost() {
            return lost;
          },
        },
        width: 100,
        height: 100,
        resolution: 1,
        background: { color: 0, alpha: 0 },
      })) {
        Object.defineProperty(this, key, { configurable: true, value });
      }
    });
    const destroy = vi
      .spyOn(WebGLRenderer.prototype, "destroy")
      .mockImplementation(() => {});
    const render = vi.spyOn(WebGLRenderer.prototype, "render");
    const game = await createGameRenderer({
      surface: "travel",
      mount: document.createElement("div"),
      signal: new window.AbortController().signal,
      height: () => 100,
      onError,
    });
    games.push(game);
    return { game, canvas, render, destroy };
  };
  const runFrame = (now: number) => {
    const callback = frame;
    frame = null;
    callback?.(now);
  };

  it("skips frames while the context is lost before its event arrives, then resumes on restore", async () => {
    const onError = vi.fn();
    const { canvas, render, destroy } = await start(onError);
    render.mockImplementation(() => {});
    lost = true;
    runFrame(16);
    expect(render).not.toHaveBeenCalled();
    expect(frame).toBeNull();
    lost = false;
    canvas.dispatchEvent(new window.Event("webglcontextrestored"));
    runFrame(32);
    expect(render).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(destroy).not.toHaveBeenCalled();
  });

  it("keeps the scene when a GL call fails because the context was lost mid-frame", async () => {
    const onError = vi.fn();
    const { render, destroy } = await start(onError);
    render.mockImplementation(() => {
      lost = true;
      throw new TypeError(
        "Argument 1 ('shader') to shaderSource must be a WebGLShader",
      );
    });
    runFrame(16);
    expect(onError).not.toHaveBeenCalled();
    expect(destroy).not.toHaveBeenCalled();
    expect(frame).toBeNull();
  });

  it("still reports frame failures while the context is live", async () => {
    const onError = vi.fn();
    const { render, destroy } = await start(onError);
    const failure = new Error("broken scene");
    render.mockImplementation(() => {
      throw failure;
    });
    runFrame(16);
    expect(onError).toHaveBeenCalledWith(failure);
    expect(destroy).toHaveBeenCalled();
  });
});

describe("shared renderer frame loop", () => {
  it("uses one request for multiple canvases and cancels when the last leaves", () => {
    let callback: FrameRequestCallback = () => {};
    let requests = 0;
    const cancelled: number[] = [];
    const loop = createFrameLoop(
      (next) => {
        callback = next;
        return ++requests;
      },
      (id) => cancelled.push(id),
    );
    const frames: string[] = [];
    const leaveA = loop.subscribe(() => frames.push("a"));
    const leaveB = loop.subscribe(() => frames.push("b"));
    expect(requests).toBe(1);
    callback(16);
    expect(frames).toEqual(["a", "b"]);
    expect(requests).toBe(2);
    leaveA();
    callback(32);
    expect(frames).toEqual(["a", "b", "b"]);
    leaveB();
    expect(cancelled).toEqual([3]);
    leaveB();
    expect(cancelled).toHaveLength(1);
  });
  it("does not invoke a canvas removed by an earlier subscriber", () => {
    let callback: FrameRequestCallback = () => {};
    const loop = createFrameLoop(
      (next) => {
        callback = next;
        return 1;
      },
      () => {},
    );
    let leaveB = () => {};
    const leaveA = loop.subscribe(() => leaveB());
    let count = 0;
    leaveB = loop.subscribe(() => count++);
    callback(16);
    expect(count).toBe(0);
    leaveA();
  });
});

describe("scene resource leases", () => {
  it("shares loads, protects active resources and evicts least recently released textures", async () => {
    const loaded: string[] = [];
    const unloaded: string[] = [];
    const cache = createLeaseCache({
      load: async (key) => {
        loaded.push(key);
        return 4;
      },
      unload: async (key) => {
        unloaded.push(key);
      },
      bytes: (size) => size,
      idleBudget: 4,
    });
    const a = cache.acquire("a");
    const shared = cache.acquire("a");
    const b = cache.acquire("b");
    await Promise.all([a.resource, shared.resource, b.resource]);
    expect(loaded).toEqual(["a", "b"]);
    a.release();
    b.release();
    expect(unloaded).toEqual([]);
    shared.release();
    shared.release();
    expect(unloaded).toEqual(["b"]);
  });
  it("releases a texture that finishes loading after its scene has gone away", async () => {
    let complete = (_size: number) => {};
    const unloaded: string[] = [];
    const cache = createLeaseCache({
      load: () =>
        new Promise<number>((resolve) => {
          complete = resolve;
        }),
      unload: async (key) => {
        unloaded.push(key);
      },
      bytes: (size) => size,
      idleBudget: 0,
    });
    const lease = cache.acquire("late");
    lease.release();
    await Promise.resolve();
    complete(100);
    await lease.resource;
    expect(unloaded).toEqual(["late"]);
  });
  it("waits for an old unload before reacquiring the same URL", async () => {
    let finishUnload = () => {};
    const events: string[] = [];
    const cache = createLeaseCache({
      load: async (key) => {
        events.push(`load ${key}`);
        return 4;
      },
      unload: () =>
        new Promise<void>((resolve) => {
          finishUnload = resolve;
        }),
      bytes: (size) => size,
      idleBudget: 0,
    });
    const first = cache.acquire("a");
    await first.resource;
    first.release();
    const second = cache.acquire("a");
    await Promise.resolve();
    expect(events).toEqual(["load a"]);
    finishUnload();
    await second.resource;
    expect(events).toEqual(["load a", "load a"]);
  });
});

describe("farm pointer coordinates", () => {
  it("picks every plot after each supported grid expansion", () => {
    for (let count = 1; count <= 25; count++) {
      for (let slot = 0; slot < count; slot++) {
        const { x, y } = farmPlotPosition(slot, count);
        expect(farmPlotAt(x, y, count)).toBe(slot);
      }
    }
  });
  it("rejects gaps, unpurchased slots and coordinates outside the farm", () => {
    const first = farmPlotPosition(0, 6);
    expect(farmPlotAt(first.x + 1, first.y, 6)).toBeNull();
    const empty = farmPlotPosition(9, 6);
    expect(farmPlotAt(empty.x, empty.y, 6)).toBeNull();
    expect(farmPlotAt(-100, -100, 6)).toBeNull();
  });
});
