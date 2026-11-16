import { afterEach, describe, expect, it, vi } from "bun:test";
import { WebGLRenderer } from "pixi.js";
import { createFrameLoop } from "@/libs/rendering/frameLoop";
import { createLeaseCache } from "@/libs/rendering/leaseCache";
import { destroyParkedRenderer } from "@/libs/rendering/rendererPool";
import { createGameRenderer } from "@/libs/rendering/runtime";
import { farmPlotAt, farmPlotPosition } from "@/libs/rendering/scenes/farmLayout";
import type { RendererSurface } from "@/libs/rendering/telemetry";

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
    destroyParkedRenderer();
    vi.restoreAllMocks();
    Object.assign(globalThis, originals);
    frame = null;
    lost = false;
  });
  const start = async (onError: (error: unknown) => void, backgroundAlpha = 0) => {
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
    let canvas = document.createElement("canvas");
    const init = vi
      .spyOn(WebGLRenderer.prototype, "init")
      .mockImplementation(async function (this: WebGLRenderer) {
        canvas = document.createElement("canvas");
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
    const resize = vi
      .spyOn(WebGLRenderer.prototype, "resize")
      .mockImplementation(() => {});
    const render = vi.spyOn(WebGLRenderer.prototype, "render");
    const create = async (surface: RendererSurface = "travel") => {
      const mount = document.createElement("div");
      const game = await createGameRenderer({
        surface,
        mount,
        signal: new window.AbortController().signal,
        height: () => 100,
        backgroundAlpha,
        onError,
      });
      games.push(game);
      return { game, mount };
    };
    const { game, mount } = await create();
    return { game, mount, canvas, render, destroy, init, resize, create };
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

  it("hands a disposed renderer to the next scene of its surface", async () => {
    const { game, mount, canvas, init, destroy, resize, create } = await start(vi.fn());
    expect(mount.contains(canvas)).toBe(true);
    game.dispose();
    expect(mount.contains(canvas)).toBe(false);
    expect(destroy).not.toHaveBeenCalled();
    const next = await create();
    expect(init).toHaveBeenCalledTimes(1);
    expect(next.game.canvas).toBe(canvas);
    expect(next.mount.contains(canvas)).toBe(true);
    expect(resize).toHaveBeenCalledWith(1, 100, 1);
    expect(destroy).not.toHaveBeenCalled();
  });

  it("destroys a parked renderer when another surface starts a scene", async () => {
    const { game, canvas, init, destroy, create } = await start(vi.fn());
    game.dispose();
    const next = await create("combat");
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledTimes(2);
    expect(next.game.canvas).not.toBe(canvas);
  });

  for (const surface of ["combat", "travel"] as const) {
    it(`destroys a cancelled combat renderer while a ${surface} scene holds one`, async () => {
      const { game: initial, destroy, init, create } = await start(vi.fn());
      initial.dispose();
      const cancelled = new window.AbortController();
      const first = createGameRenderer({
        surface: "combat",
        mount: document.createElement("div"),
        signal: cancelled.signal,
        height: () => 100,
        onError: vi.fn(),
      });
      // Starting combat discards the initial travel renderer.
      destroy.mockClear();
      const second = create(surface);
      cancelled.abort();
      await expect(first).rejects.toMatchObject({ name: "AbortError" });
      const { game } = await second;
      expect(init).toHaveBeenCalledTimes(3);
      expect(destroy).toHaveBeenCalledTimes(1);
      game.dispose();
      expect(destroy).toHaveBeenCalledTimes(1);
      await create(surface);
      expect(init).toHaveBeenCalledTimes(3);
    });
  }

  it("destroys a renderer released while the page is already hidden", async () => {
    const { game, destroy, init, create } = await start(vi.fn());
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    try {
      game.dispose();
    } finally {
      Reflect.deleteProperty(document, "hidden");
    }
    expect(destroy).toHaveBeenCalledTimes(1);
    await create();
    expect(init).toHaveBeenCalledTimes(2);
  });

  it("ignores a disposed scene's background update after its renderer is reused", async () => {
    const { game, create } = await start(vi.fn(), 1);
    game.dispose();
    const next = await create();
    expect(next.game.renderer).toBe(game.renderer);
    next.game.setBackground(0x123456);
    const color = next.game.renderer.background.color;
    game.setBackground(0xabcdef);
    expect(next.game.renderer.background.color).toEqual(color);
  });

  it("never parks a preview renderer, whose canvas its caller restyles", async () => {
    const { init, destroy, create } = await start(vi.fn());
    const preview = await create("battlefield-preview");
    expect(init).toHaveBeenCalledTimes(2);
    preview.game.dispose();
    expect(destroy).toHaveBeenCalledTimes(1);
    await create("battlefield-preview");
    expect(init).toHaveBeenCalledTimes(3);
  });

  it("does not reuse a renderer that failed a frame or lost its context", async () => {
    const { render, init, destroy, create } = await start(vi.fn());
    render.mockImplementation(() => {
      throw new Error("broken scene");
    });
    runFrame(16);
    expect(destroy).toHaveBeenCalledTimes(1);
    render.mockImplementation(() => {});
    const second = await create();
    expect(init).toHaveBeenCalledTimes(2);
    lost = true;
    second.game.dispose();
    expect(destroy).toHaveBeenCalledTimes(2);
    lost = false;
    await create();
    expect(init).toHaveBeenCalledTimes(3);
  });

  it("destroys a parked renderer when its context is lost or the page is hidden", async () => {
    const { game, canvas, init, destroy, create } = await start(vi.fn());
    game.dispose();
    canvas.dispatchEvent(new window.Event("webglcontextlost"));
    expect(destroy).toHaveBeenCalledTimes(1);
    const second = await create();
    expect(init).toHaveBeenCalledTimes(2);
    second.game.dispose();
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    try {
      document.dispatchEvent(new window.Event("visibilitychange"));
    } finally {
      Reflect.deleteProperty(document, "hidden");
    }
    expect(destroy).toHaveBeenCalledTimes(2);
  });

  it("presents a continuous scene on every second refresh of a 120 Hz display", async () => {
    const { game, render } = await start(vi.fn());
    render.mockImplementation(() => {});
    const deltas: number[] = [];
    game.setUpdate((frame) => {
      deltas.push(frame.delta);
    });
    const refresh = 1000 / 120;
    // The first refreshes also teach the shared loop the display's interval.
    for (let tick = 1; tick <= 40; tick++) runFrame(1000 + tick * refresh);
    render.mockClear();
    deltas.length = 0;
    for (let tick = 41; tick <= 60; tick++) runFrame(1000 + tick * refresh);
    expect(render).toHaveBeenCalledTimes(10);
    for (const delta of deltas) expect(delta).toBeCloseTo(2 * refresh * 0.001, 5);
    // Invalidation never waits out a slower rate, but still respects the display cadence.
    game.setAnimating(true, 30);
    for (let tick = 61; tick <= 84; tick++) runFrame(1000 + tick * refresh);
    render.mockClear();
    for (let tick = 85; tick <= 108; tick++) runFrame(1000 + tick * refresh);
    expect(render).toHaveBeenCalledTimes(6);
  });

  it("keeps the previous frame when the scene reports no change until it is invalidated", async () => {
    const { game, render } = await start(vi.fn());
    render.mockImplementation(() => {});
    let changed = true;
    game.setUpdate(() => changed);
    runFrame(5000);
    expect(render).toHaveBeenCalledTimes(1);
    changed = false;
    runFrame(5100);
    runFrame(5200);
    expect(render).toHaveBeenCalledTimes(1);
    game.invalidate();
    runFrame(5300);
    expect(render).toHaveBeenCalledTimes(2);
    changed = true;
    runFrame(5400);
    expect(render).toHaveBeenCalledTimes(3);
  });

  it("sleeps between the frames of a slow scene and wakes on a timer", async () => {
    const { game, render } = await start(vi.fn());
    render.mockImplementation(() => {});
    game.setAnimating(true, 5);
    runFrame(performance.now());
    expect(render).toHaveBeenCalledTimes(1);
    // No refresh is requested until the next frame is due.
    expect(frame).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 260));
    expect(frame).not.toBeNull();
    runFrame(performance.now());
    expect(render).toHaveBeenCalledTimes(2);
    game.setAnimating(true);
    expect(frame).not.toBeNull();
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
  it("paces frames on whole refreshes of the measured display rate", () => {
    let callback: FrameRequestCallback = () => {};
    const loop = createFrameLoop(
      (next) => {
        callback = next;
        return 1;
      },
      () => {},
    );
    const leave = loop.subscribe(() => {});
    let now = 0;
    // Refreshes per presented frame with a 60 fps target: 60 and 90 Hz present every refresh,
    // 120 and 144 Hz every second one (60 and 72 fps), 240 Hz every fourth.
    for (const [hz, vsyncs] of [
      [60, 1],
      [90, 1],
      [120, 2],
      [144, 2],
      [240, 4],
    ] as const) {
      for (let tick = 0; tick < 30; tick++) {
        now += 1000 / hz;
        callback(now);
      }
      const interval = loop.minimumInterval(60);
      expect(interval).toBeLessThanOrEqual((vsyncs * 1000) / hz);
      expect(interval).toBeGreaterThan(((vsyncs - 1) * 1000) / hz);
    }
    leave();
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
