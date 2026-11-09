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
