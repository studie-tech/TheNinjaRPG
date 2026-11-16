import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import {
  Assets,
  BufferImageSource,
  Container,
  type Sprite,
  Texture,
  UniformGroup,
} from "pixi.js";
import { IMG_FARM_PLOT_SOIL, TD_SHURIKEN_IMAGE_URL } from "@/drizzle/constants";
import { useGameScene } from "@/hooks/game-scene";
import type { GameRenderer } from "@/libs/rendering/runtime";
import * as runtime from "@/libs/rendering/runtime";
import { createFarmScene } from "@/libs/rendering/scenes/farm";
import { farmPlotPosition, farmViewScale } from "@/libs/rendering/scenes/farmLayout";
import { createTowerDefenseScene } from "@/libs/rendering/scenes/towerDefense";
import { createRun } from "@/libs/towerDefense/sim";
import { DEFAULT_VISUAL_EFFECTS } from "@/libs/visualEffects";
import type { FarmPlotState, FarmVisualState } from "@/validators/farming";

const cleanups: (() => void)[] = [];
const originalMatchMedia = Object.getOwnPropertyDescriptor(globalThis, "matchMedia");
beforeEach(() => {
  Object.defineProperty(globalThis, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false }),
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(Assets, "load").mockImplementation(async () => Texture.WHITE);
  vi.spyOn(Assets, "unload").mockResolvedValue(undefined);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () =>
      ({
        scale() {},
        createRadialGradient: () => ({ addColorStop() {} }),
        fillRect() {},
        fillText() {},
        strokeText() {},
        createLinearGradient: () => ({ addColorStop() {} }),
        measureText: () => ({ width: 24 }),
      }) as never,
  );
});
afterEach(async () => {
  cleanup();
  for (const dispose of cleanups.splice(0)) dispose();
  await Promise.resolve();
  vi.restoreAllMocks();
  if (originalMatchMedia)
    Object.defineProperty(globalThis, "matchMedia", originalMatchMedia);
  else Reflect.deleteProperty(globalThis, "matchMedia");
});

const renderer = (texture: (path: string) => Promise<Texture>) => {
  const controller = new AbortController(),
    listeners = new window.AbortController();
  const mount = document.createElement("div"),
    canvas = document.createElement("canvas");
  mount.appendChild(canvas);
  canvas.getBoundingClientRect = () => new DOMRect(0, 0, 800, 440);
  const owned = new Set<() => void>();
  let signal = controller.signal,
    disposed = false;
  const game = {
    visualEffects: { ...DEFAULT_VISUAL_EFFECTS },
    stage: new Container(),
    canvas,
    animation: new UniformGroup({ uTime: { value: 0, type: "f32" } }),
    renderer: {
      width: 800,
      height: 440,
      resize: vi.fn(),
      gl: { MAX_TEXTURE_SIZE: 0x0d33, getParameter: () => 4096 },
    },
    assets: { texture },
    get signal() {
      return signal;
    },
    isDisposed: () => disposed,
    own: (dispose: () => void) => {
      owned.add(dispose);
    },
    disown: (dispose: () => void) => {
      owned.delete(dispose);
    },
    setAnimating: vi.fn(),
    invalidate: vi.fn(),
    setUpdate: vi.fn(),
    setResize: (resize: (width: number, height: number) => void) => resize(800, 440),
    listen: (type: string, listener: EventListener) =>
      canvas.addEventListener(type, listener, { signal: listeners.signal }),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      listeners.abort();
      game.stage.destroy({ children: true, texture: false, textureSource: false });
      for (const dispose of owned) dispose();
      owned.clear();
      canvas.remove();
    },
  } as unknown as GameRenderer;
  vi.spyOn(runtime, "createGameRenderer").mockImplementation(async (options) => {
    signal = options.signal;
    signal.addEventListener("abort", game.dispose, { once: true });
    return game;
  });
  cleanups.push(game.dispose);
  const pointer = (type: string, x: number, y: number) => {
    const event = new window.MouseEvent(type, { button: 0, clientX: x, clientY: y });
    Object.defineProperty(event, "pointerId", { value: 1 });
    canvas.dispatchEvent(event);
  };
  return { game, controller, mount, pointer };
};
const pendingTexture = () => {
  let resolve = (_texture: Texture) => {},
    reject = (_error: Error) => {};
  const promise = new Promise<Texture>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
};
const image = () => {
  const texture = new Texture({
    source: new BufferImageSource({
      resource: new Uint8Array(16),
      width: 2,
      height: 2,
    }),
  });
  cleanups.push(() => texture.destroy(true));
  return texture;
};
const cropPlot = (cropImage = "crop.png"): FarmPlotState => ({
  id: "plot",
  slotIndex: 0,
  seedItemId: "seed",
  seedName: "Seed",
  cropName: "Crop",
  cropImage,
  plantedAt: new Date(Date.now() - 2000),
  finishAt: new Date(Date.now() - 1000),
  lastWateredAt: null,
  fertilizerApplied: true,
  isReady: true,
  canWater: false,
  nextWateringAt: null,
  growthProgress: 1,
  growthStage: 4,
});
const farmOptions = (fixture: ReturnType<typeof renderer>, plot = cropPlot()) => ({
  mount: fixture.mount,
  signal: fixture.controller.signal,
  initialState: { totalPlots: 6, plots: [plot] } as FarmVisualState,
  getTimeDiff: () => 0,
  showDayNight: () => false,
  onPlotClick: vi.fn(),
  onError: vi.fn(),
});
const cropSprites = (game: GameRenderer) => {
  const world = game.stage.children[1] as Container;
  return [world.children[4]!.children[0], world.children[3]!.children[0]] as Sprite[];
};

describe("optional farm crop artwork", () => {
  it("keeps the hook ready and every plot selectable after a late crop-image failure", async () => {
    const pending = pendingTexture(),
      failure = new Error("Crop image unavailable");
    const fixture = renderer((path) =>
      path === "crop.png" ? pending.promise : Promise.resolve(Texture.WHITE),
    );
    const options = farmOptions(fixture),
      mount = { current: fixture.mount };
    const hook = renderHook(() =>
      useGameScene("farm", mount, (element, signal, onError) =>
        createFarmScene({ ...options, mount: element, signal, onError }),
      ),
    );
    await waitFor(() => expect(hook.result.current.isReady).toBe(true));
    await act(async () => {
      pending.reject(failure);
      await Promise.resolve();
    });
    expect(hook.result.current.error).toBe(false);
    expect(hook.result.current.isReady).toBe(true);
    expect(fixture.game.isDisposed()).toBe(false);
    expect(fixture.mount.contains(fixture.game.canvas)).toBe(true);
    for (let slot = 0; slot < 6; slot++) {
      const position = farmPlotPosition(slot, 6),
        scale = farmViewScale(800, 440, 6);
      fixture.pointer(
        "pointerdown",
        400 + position.x * scale,
        220 + position.y * scale,
      );
    }
    expect(options.onPlotClick.mock.calls.map(([slot]) => slot)).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
    expect(
      cropSprites(fixture.game).every((sprite) => sprite.texture === Texture.EMPTY),
    ).toBe(true);
    expect(console.warn).toHaveBeenCalledWith("Farm crop artwork unavailable", failure);
    hook.unmount();
    expect(fixture.game.isDisposed()).toBe(true);
    expect(fixture.mount.children).toHaveLength(0);
  });

  it("reports presses on the field outside every plot", async () => {
    const fixture = renderer(() => Promise.resolve(Texture.WHITE));
    const onFieldClick = vi.fn();
    const options = { ...farmOptions(fixture), onFieldClick };
    const scene = await createFarmScene(options);
    fixture.pointer("pointerdown", 10, 10);
    expect(onFieldClick).toHaveBeenCalledTimes(1);
    expect(options.onPlotClick).not.toHaveBeenCalled();
    const position = farmPlotPosition(0, 6),
      scale = farmViewScale(800, 440, 6);
    fixture.pointer("pointerdown", 400 + position.x * scale, 220 + position.y * scale);
    expect(options.onPlotClick).toHaveBeenCalledTimes(1);
    expect(onFieldClick).toHaveBeenCalledTimes(1);
    scene.dispose();
  });

  it("uses healthy crop/glow artwork and clears only changed artwork when its replacement fails", async () => {
    const healthy = image(),
      pending = pendingTexture(),
      failure = new Error("Replacement crop unavailable");
    const fixture = renderer((path) =>
      path === "replacement.png" ? pending.promise : Promise.resolve(healthy),
    );
    const options = farmOptions(fixture),
      scene = await createFarmScene(options);
    await Promise.resolve();
    const sprites = cropSprites(fixture.game);
    expect(sprites.every((sprite) => sprite.texture === healthy)).toBe(true);
    expect(sprites[0]!.width).toBeCloseTo(1.1);
    scene.updateState({
      ...options.initialState,
      plots: [cropPlot("replacement.png")],
    });
    pending.reject(failure);
    await Promise.resolve();
    expect(sprites.every((sprite) => sprite.texture === Texture.EMPTY)).toBe(true);
    expect(options.onError).not.toHaveBeenCalled();
    scene.dispose();
    expect(sprites.every((sprite) => sprite.destroyed)).toBe(true);
    expect(healthy.source.destroyed).toBe(false);
  });

  it.each(["resolve", "reject"])(
    "ignores a stale crop-image %s after a newer crop loads",
    async (completion) => {
      const pending = pendingTexture(),
        healthy = image();
      const fixture = renderer((path) =>
        path === "crop.png" ? pending.promise : Promise.resolve(healthy),
      );
      const options = farmOptions(fixture),
        scene = await createFarmScene(options);
      scene.updateState({ ...options.initialState, plots: [cropPlot("new.png")] });
      await Promise.resolve();
      if (completion === "resolve") pending.resolve(Texture.WHITE);
      else pending.reject(new Error("Old crop unavailable"));
      await Promise.resolve();
      expect(
        cropSprites(fixture.game).every((sprite) => sprite.texture === healthy),
      ).toBe(true);
      expect(console.warn).not.toHaveBeenCalled();
      expect(options.onError).not.toHaveBeenCalled();
    },
  );

  it.each(["resolve", "reject"])(
    "ignores a late crop-image %s after disposal",
    async (completion) => {
      const pending = pendingTexture(),
        fixture = renderer((path) =>
          path === "crop.png" ? pending.promise : Promise.resolve(Texture.WHITE),
        );
      const options = farmOptions(fixture),
        scene = await createFarmScene(options);
      scene.dispose();
      fixture.game.invalidate = vi.fn();
      if (completion === "resolve") pending.resolve(Texture.WHITE);
      else pending.reject(new Error("Late image failure"));
      await Promise.resolve();
      expect(fixture.game.invalidate).not.toHaveBeenCalled();
      expect(console.warn).not.toHaveBeenCalled();
      expect(options.onError).not.toHaveBeenCalled();
    },
  );

  it("still rejects a failed soil prerequisite and disposes the renderer", async () => {
    const failure = new Error("Soil texture unavailable"),
      fixture = renderer(async (path) => {
        if (path === IMG_FARM_PLOT_SOIL) throw failure;
        return Texture.WHITE;
      });
    await expect(createFarmScene(farmOptions(fixture))).rejects.toBe(failure);
    expect(fixture.game.isDisposed()).toBe(true);
  });
});

const towerOptions = (fixture: ReturnType<typeof renderer>, onTap = vi.fn()) => ({
  mount: fixture.mount,
  signal: fixture.controller.signal,
  onError: vi.fn(),
  seed: "optional-art",
  roster: [],
  onFrame() {},
  getView: () => ({
    state: createRun({
      seed: "optional-art",
      startWave: 1,
      bestWave: 0,
      level: 1,
      dojo: {},
    }),
    pending: 0,
    events: [],
    reticle: null,
    mode: "aim" as const,
  }),
  onTap,
});
describe("optional tower-defense projectile artwork", () => {
  it("initializes the arena and tap input when only the projectile image fails", async () => {
    const failure = new Error("Shuriken image unavailable"),
      fixture = renderer(async (path) => {
        if (path === TD_SHURIKEN_IMAGE_URL) throw failure;
        return Texture.WHITE;
      });
    const onTap = vi.fn();
    const scene = await createTowerDefenseScene(towerOptions(fixture, onTap));
    expect(fixture.game.isDisposed()).toBe(false);
    fixture.pointer("pointerdown", 400, 220);
    expect(onTap).toHaveBeenCalledTimes(1);
    const [point] = onTap.mock.lastCall ?? [];
    expect(Math.abs(point.x)).toBeLessThan(0.01);
    expect(Math.abs(point.y)).toBeLessThan(0.01);
    expect(console.warn).toHaveBeenCalledWith(
      "Tower defense projectile artwork unavailable",
      failure,
    );
    scene.dispose();
    fixture.pointer("pointerdown", 400, 220);
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it.each(["abort", "dispose", "AbortError"])(
    "preserves %s while projectile artwork is loading",
    async (cancellation) => {
      const pending = pendingTexture(),
        fixture = renderer((path) =>
          path === TD_SHURIKEN_IMAGE_URL
            ? pending.promise
            : Promise.resolve(Texture.WHITE),
        );
      const scene = createTowerDefenseScene(towerOptions(fixture));
      const failure =
        cancellation === "AbortError"
          ? new DOMException("Image cancelled", "AbortError")
          : new Error("Late image failure");
      await new Promise((resolve) => setTimeout(resolve, 20));
      if (cancellation === "abort") fixture.controller.abort();
      if (cancellation === "dispose") fixture.game.dispose();
      pending.reject(failure);
      await expect(scene).rejects.toBeDefined();
      expect(console.warn).not.toHaveBeenCalledWith(
        "Tower defense projectile artwork unavailable",
        expect.anything(),
      );
    },
  );
});
