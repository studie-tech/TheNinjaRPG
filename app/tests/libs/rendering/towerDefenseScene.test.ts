import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import {
  Assets,
  type Container,
  Container as PixiContainer,
  Texture,
  UniformGroup,
} from "pixi.js";
import type { GameFrame, GameRenderer } from "@/libs/rendering/runtime";
import * as runtime from "@/libs/rendering/runtime";
import {
  createTowerDefenseScene,
  type TowerDefenseSceneView,
} from "@/libs/rendering/scenes/towerDefense";
import { createRun, stepRun, type TdState } from "@/libs/towerDefense/sim";
import { DEFAULT_VISUAL_EFFECTS } from "@/libs/visualEffects";

const originalMatchMedia = Object.getOwnPropertyDescriptor(globalThis, "matchMedia");
const cleanups: (() => void)[] = [];
beforeEach(() => {
  Object.defineProperty(globalThis, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false }),
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
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
      }) as never,
  );
});
afterEach(() => {
  for (const dispose of cleanups.splice(0)) dispose();
  vi.restoreAllMocks();
  if (originalMatchMedia)
    Object.defineProperty(globalThis, "matchMedia", originalMatchMedia);
  else Reflect.deleteProperty(globalThis, "matchMedia");
});

describe("tower defense scene", () => {
  it("recycles enemy display objects and drains the event queue in place", async () => {
    const { game, frame } = fakeRenderer();
    const state = runWithEnemies(3);
    const view: TowerDefenseSceneView = {
      state,
      pending: 0,
      events: [],
      reticle: null,
      mode: "aim",
    };
    const scene = await createTowerDefenseScene({
      mount: document.createElement("div"),
      signal: new AbortController().signal,
      onError: vi.fn(),
      seed: "pool",
      roster: [],
      onFrame() {},
      getView: () => view,
      onTap: vi.fn(),
    });
    const actors = actorLayer(game.stage);
    const living = () => state.enemies.filter((enemy) => !enemy.dead);
    const crowd = living().length;

    const events = view.events;
    events.push({ type: "wave", wave: 1, boss: false, titan: false, eras: [] });
    frame();
    expect(view.events).toBe(events);
    expect(events).toHaveLength(0);
    // The hero plus one root per living enemy.
    expect(actors.children).toHaveLength(1 + crowd);
    const roots = actors.children.slice(1);

    for (const enemy of living()) enemy.dead = true;
    frame();
    expect(actors.children).toHaveLength(1);
    for (const root of roots) expect(root.destroyed).toBe(false);

    // New enemies take the released records instead of building new ones.
    const template = state.enemies[0];
    if (!template) throw new Error("Run has no enemies");
    state.enemies = Array.from({ length: crowd }, (_, index) => ({
      ...template,
      id: 10_000 + index,
      dead: false,
      boss: index === 0,
      elite: index === 1,
      shield: 5,
      maxShield: 10,
      hp: template.maxHp / 2,
    }));
    frame();
    expect(actors.children).toHaveLength(1 + crowd);
    for (const root of actors.children.slice(1))
      expect(roots.includes(root)).toBe(true);

    // Released records still in the pool are destroyed with the scene.
    state.enemies = state.enemies.slice(1);
    frame();
    const pooled = roots.filter((root) => !root.parent);
    expect(pooled).toHaveLength(1);
    scene.dispose();
    for (const root of roots) expect(root.destroyed).toBe(true);
  });
});

/** Steps a fresh run until at least `count` enemies are on the field. */
const runWithEnemies = (count: number): TdState => {
  const state = createRun({ seed: "pool", startWave: 1, bestWave: 0, dojo: {} });
  for (let tick = 0; tick < 2_000; tick++) {
    if (state.enemies.filter((enemy) => !enemy.dead).length >= count) return state;
    stepRun(state);
  }
  throw new Error("Run never fielded enough enemies");
};

const actorLayer = (stage: Container) => {
  const camera = stage.children[0];
  const world = camera?.children[0];
  const layer = world?.children.find((child) => child.sortableChildren);
  if (!layer) throw new Error("Actor layer missing");
  return layer;
};

const fakeRenderer = () => {
  let update: (frame: GameFrame) => void = () => {};
  let now = 1_000;
  const owned = new Set<() => void>();
  let disposed = false;
  const canvas = document.createElement("canvas");
  const game = {
    visualEffects: { ...DEFAULT_VISUAL_EFFECTS },
    stage: new PixiContainer(),
    canvas,
    animation: new UniformGroup({ uTime: { value: 0, type: "f32" } }),
    renderer: {
      width: 800,
      height: 440,
      gl: { MAX_TEXTURE_SIZE: 0x0d33, getParameter: () => 4096 },
    },
    assets: { texture: async () => Texture.WHITE },
    signal: new AbortController().signal,
    isDisposed: () => disposed,
    own: (dispose: () => void) => {
      owned.add(dispose);
    },
    disown: (dispose: () => void) => {
      owned.delete(dispose);
    },
    setAnimating: vi.fn(),
    invalidate: vi.fn(),
    setUpdate: (callback: typeof update) => {
      update = callback;
    },
    setResize: (resize: (width: number, height: number) => void) => resize(800, 440),
    listen: vi.fn(),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      game.stage.destroy({ children: true, texture: false, textureSource: false });
      for (const dispose of owned) dispose();
      owned.clear();
    },
  } as unknown as GameRenderer;
  vi.spyOn(runtime, "createGameRenderer").mockImplementation(async () => game);
  cleanups.push(game.dispose);
  const frame = () => {
    now += 16;
    update({ now, delta: 0.016, reducedMotion: false });
  };
  return { game, frame };
};
