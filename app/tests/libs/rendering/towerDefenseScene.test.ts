import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import {
  Assets,
  type Container,
  Container as PixiContainer,
  Texture,
  UniformGroup,
} from "pixi.js";
import type { LpcCatalog } from "@/libs/lpc/catalog";
import * as animationTextures from "@/libs/rendering/animationTextures";
import * as character from "@/libs/rendering/primitives/character";
import type { GameFrame, GameRenderer } from "@/libs/rendering/runtime";
import * as runtime from "@/libs/rendering/runtime";
import {
  createTowerDefenseScene,
  type TowerDefenseRosterEntry,
  type TowerDefenseSceneView,
} from "@/libs/rendering/scenes/towerDefense";
import type { CharacterAnimation } from "@/libs/spriteAnimations";
import { createRun, stepRun, type TdState } from "@/libs/towerDefense/sim";
import { DEFAULT_VISUAL_EFFECTS } from "@/libs/visualEffects";
import type { SpriteAppearance } from "@/validators/lpc";

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

describe("tower defense clones", () => {
  it("builds the six clones once, however many frames wait on the first", async () => {
    const { game, frame } = fakeRenderer({ lpcCatalog: {} as LpcCatalog });
    const pending: ((value: character.LpcCharacter) => void)[] = [];
    const build = vi
      .spyOn(character, "createLpcCharacter")
      .mockImplementation((_game, _appearance, mode) =>
        mode === "travel"
          ? new Promise((resolve) => pending.push(resolve))
          : Promise.resolve(fakeCharacter()),
      );
    const state = createRun({ seed: "clones", startWave: 1, bestWave: 0, dojo: {} });
    const view = viewOf(state);
    await createTowerDefenseScene({
      ...sceneOptions(view),
      appearance: { layers: [] } as unknown as SpriteAppearance,
    });
    const travel = () => build.mock.calls.filter(([, , mode]) => mode === "travel");
    state.clonesUntil = state.tick + 100;
    view.events.push({ type: "ultimate", ultimate: "clones", x: 0, y: 0 } as never);
    for (let i = 0; i < 10; i++) frame();
    expect(travel()).toHaveLength(1);
    while (pending.length > 0) {
      pending.shift()?.(fakeCharacter());
      await Promise.resolve();
      await Promise.resolve();
      frame();
    }
    expect(travel()).toHaveLength(6);
    // Six clones circle the hero, and nothing builds more.
    expect(
      actorLayer(game.stage).children.filter((child) => child.visible),
    ).toHaveLength(1 + 6);
    for (let i = 0; i < 10; i++) frame();
    expect(travel()).toHaveLength(6);
  });

  it("stops building clones once the scene is gone", async () => {
    const { game, frame } = fakeRenderer({ lpcCatalog: {} as LpcCatalog });
    const pending: ((value: character.LpcCharacter) => void)[] = [];
    const build = vi
      .spyOn(character, "createLpcCharacter")
      .mockImplementation((_game, _appearance, mode) =>
        mode === "travel"
          ? new Promise((resolve) => pending.push(resolve))
          : Promise.resolve(fakeCharacter()),
      );
    const state = createRun({ seed: "clones", startWave: 1, bestWave: 0, dojo: {} });
    const scene = await createTowerDefenseScene({
      ...sceneOptions(viewOf(state)),
      appearance: { layers: [] } as unknown as SpriteAppearance,
    });
    const layer = actorLayer(game.stage);
    state.clonesUntil = state.tick + 100;
    frame();
    const actors = layer.children.length;
    scene.dispose();
    pending.shift()?.(fakeCharacter());
    await Promise.resolve();
    await Promise.resolve();
    expect(build.mock.calls.filter(([, , mode]) => mode === "travel")).toHaveLength(1);
    expect(layer.children.length).toBeLessThanOrEqual(actors);
  });
});

describe("tower defense enemy art", () => {
  it("releases a character's sheets once its enemies have been gone a while", async () => {
    const { frame } = fakeRenderer();
    const releases = new Map<string, ReturnType<typeof vi.fn>>();
    vi.spyOn(animationTextures, "acquireAnimationTexture").mockImplementation(
      (animation) => {
        const release = vi.fn();
        releases.set(animation.url, release);
        return { resource: Promise.resolve(Texture.WHITE), release };
      },
    );
    const state = runWithEnemies(2);
    const view = viewOf(state);
    const roster: TowerDefenseRosterEntry[] = [
      {
        userId: "ninja",
        username: "Ninja",
        level: 1,
        avatar: null,
        animations: { move: sheet("move"), idle: sheet("idle") },
      },
    ];
    await createTowerDefenseScene({ ...sceneOptions(view), roster });
    frame();
    expect([...releases.keys()].sort()).toEqual(["idle", "move"]);
    const living = state.enemies.filter((enemy) => !enemy.dead);
    for (const enemy of living) enemy.dead = true;
    // A short gap keeps the sheets for the next wave.
    frame(5_000);
    for (const release of releases.values()) expect(release).not.toHaveBeenCalled();
    frame(21_000);
    for (const release of releases.values()) expect(release).toHaveBeenCalledTimes(1);
    // The character's next enemy leases its sheets again.
    releases.clear();
    for (const enemy of living) enemy.dead = false;
    frame();
    expect([...releases.keys()].sort()).toEqual(["idle", "move"]);
  });
});

describe("tower defense enemy art budget", () => {
  it("asks again for sheets the atlas budget refused while the character is on the field", async () => {
    const { frame } = fakeRenderer();
    let room = false;
    const leased: string[] = [];
    const acquire = vi
      .spyOn(animationTextures, "acquireAnimationTexture")
      .mockImplementation((animation) => {
        if (!room) return undefined;
        leased.push(animation.url);
        return { resource: Promise.resolve(Texture.WHITE), release: vi.fn() };
      });
    const state = runWithEnemies(2);
    await createTowerDefenseScene({
      ...sceneOptions(viewOf(state)),
      roster: [ninja()],
    });
    frame();
    expect(acquire).toHaveBeenCalled();
    expect(leased).toHaveLength(0);
    room = true;
    // Retries are spaced out, so a full budget is not polled every frame.
    frame(100);
    expect(leased).toHaveLength(0);
    frame(1_000);
    expect(leased.sort()).toEqual(["idle", "move"]);
    // Leased sheets are not requested again.
    const calls = acquire.mock.calls.length;
    frame(1_000);
    expect(acquire.mock.calls.length).toBe(calls);
  });
});

const ninja = (): TowerDefenseRosterEntry => ({
  userId: "ninja",
  username: "Ninja",
  level: 1,
  avatar: null,
  animations: { move: sheet("move"), idle: sheet("idle") },
});

const sceneOptions = (view: TowerDefenseSceneView) => ({
  mount: document.createElement("div"),
  signal: new AbortController().signal,
  onError: vi.fn(),
  seed: "scene",
  roster: [] as TowerDefenseRosterEntry[],
  onFrame() {},
  getView: () => view,
  onTap: vi.fn(),
});

const viewOf = (state: TdState): TowerDefenseSceneView => ({
  state,
  pending: 0,
  events: [],
  reticle: null,
  mode: "aim",
});

const fakeCharacter = (): character.LpcCharacter =>
  ({
    sprite: new PixiContainer(),
    render: () => {},
    durations: {},
    hasHeadgear: false,
    layers: [],
  }) as unknown as character.LpcCharacter;

const sheet = (url: string): CharacterAnimation => ({
  id: url,
  name: url,
  url,
  smallUrl: null,
  columns: 1,
  rows: 1,
  frameCount: 1,
  fps: 8,
  facing: "right",
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

const fakeRenderer = (options: { lpcCatalog?: LpcCatalog } = {}) => {
  let update: (frame: GameFrame) => void = () => {};
  let now = 1_000;
  const owned = new Set<() => void>();
  let disposed = false;
  const canvas = document.createElement("canvas");
  const game = {
    visualEffects: { ...DEFAULT_VISUAL_EFFECTS },
    lpcCatalog: options.lpcCatalog,
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
  const frame = (elapsed = 16) => {
    now += elapsed;
    update({ now, delta: 0.016, reducedMotion: false });
  };
  return { game, frame };
};
