import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { Assets, Container, Texture, UniformGroup } from "pixi.js";
import type { GameAsset } from "@/drizzle/schema";
import type { GroundEffect } from "@/libs/combat/types";
import { hexGridHeightRatio } from "@/libs/hexgrid";
import type { GameFrame, GameRenderer } from "@/libs/rendering/runtime";
import * as runtime from "@/libs/rendering/runtime";
import {
  type CombatSceneSnapshot,
  createCombatScene,
} from "@/libs/rendering/scenes/combat";
import * as combatEffects from "@/libs/rendering/scenes/combatEffects";
import * as combatTerrain from "@/libs/rendering/scenes/combatTerrain";
import { DEFAULT_VISUAL_EFFECTS } from "@/libs/visualEffects";
import { makeBattleUser, makeCompleteBattle } from "../../setup/combat";
import { deferred } from "../../setup/deferred";

const cleanups: (() => void)[] = [];
const originalTerrain = combatTerrain.prepareCombatTerrain;
beforeEach(() => {
  vi.spyOn(Assets, "load").mockImplementation(async () => Texture.WHITE);
  vi.spyOn(Assets, "unload").mockResolvedValue(undefined);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => {
  for (const dispose of cleanups.splice(0)) dispose();
  vi.restoreAllMocks();
});

/** Exercise actual scene transforms and gestures without a GPU or network textures. */
const setup = async (
  zoom = 2,
  lightLayout = true,
  extra: { groundEffects?: GroundEffect[]; assets?: GameAsset[] } = {},
  initialFrames = true,
) => {
  const user = makeBattleUser("camera-user", {
    isAi: true,
    isOriginal: true,
    longitude: 6,
    latitude: 5,
  });
  const battle = makeCompleteBattle({
    usersState: [user],
    width: 12,
    height: 10,
    background: lightLayout ? "ground" : "ocean",
    groundEffects: extra.groundEffects ?? [],
  });
  let snapshot = {
    battle,
    userId: user.userId,
    actions: [],
    timeDiff: 0,
    assets: extra.assets ?? [],
    requestedIds: new Set(),
    active: true,
    sound: false,
    volume: 0,
    showGridNumbers: false,
    inspect: true,
  } as unknown as CombatSceneSnapshot;
  const height = 390 * hexGridHeightRatio(12, 10),
    canvas = document.createElement("canvas");
  canvas.getBoundingClientRect = () => new DOMRect(0, 0, 390, height);
  const listeners = new window.AbortController(),
    owned = new Set<() => void>();
  let update = (_frame: GameFrame) => {},
    resize = (_width: number, _height: number) => {},
    disposed = false;
  const game = {
    visualEffects: { ...DEFAULT_VISUAL_EFFECTS },
    stage: new Container(),
    canvas,
    signal: new AbortController().signal,
    animation: new UniformGroup({ uTime: { value: 0, type: "f32" } }),
    renderer: { width: 390, height, render: vi.fn() },
    assets: { texture: async () => Texture.WHITE },
    own: (callback: () => void) => owned.add(callback),
    disown: (callback: () => void) => owned.delete(callback),
    isDisposed: () => disposed,
    invalidate() {},
    setAnimating() {},
    setUpdate: (callback: typeof update) => {
      update = callback;
    },
    setResize: (callback: typeof resize) => {
      resize = callback;
      callback(390, height);
    },
    listen: (type: string, callback: EventListener) =>
      canvas.addEventListener(type, callback, { signal: listeners.signal }),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      listeners.abort();
      game.stage.destroy({ children: true });
      for (const callback of owned) callback();
    },
  } as unknown as GameRenderer;
  vi.spyOn(runtime, "createGameRenderer").mockResolvedValue(game);
  const onTap = vi.fn(),
    scene = await createCombatScene({
      mount: document.createElement("div"),
      signal: game.signal,
      onError: vi.fn(),
      getSnapshot: () => snapshot,
      onTap,
      onHover: vi.fn(),
      onZoom: vi.fn(),
      play() {},
      initialZoom: zoom,
      lightLayout,
      seed: "dANJxSd487DEuvNbNVZOK",
    });
  cleanups.push(scene.dispose);
  const world = game.stage.children[0] as Container;
  let now = 0;
  const tick = (count = 1) => {
    for (let i = 0; i < count; i++) {
      now += 1000 / 60;
      update({ now, delta: 1 / 60, reducedMotion: false });
    }
  };
  const event = (type: string, x: number, y: number) => {
    const pointer = new window.MouseEvent(type, { button: 0, clientX: x, clientY: y });
    Object.defineProperty(pointer, "pointerId", { value: 1 });
    canvas.dispatchEvent(pointer);
  };
  const drag = (dx: number, dy: number) => {
    event("pointerdown", 195, height / 2);
    event("pointermove", 195 + dx, height / 2 + dy);
    event("pointerup", 195 + dx, height / 2 + dy);
    tick();
  };
  const refresh = (longitude?: number) => {
    snapshot = {
      ...snapshot,
      battle: {
        ...snapshot.battle,
        version: snapshot.battle.version + 1,
        usersState: snapshot.battle.usersState.map((fighter) =>
          longitude === undefined ? { ...fighter } : { ...fighter, longitude },
        ),
      },
    };
    scene.refresh();
  };
  if (initialFrames) tick(120);
  return {
    getSnapshot: () => snapshot,
    patchSnapshot: (patch: Partial<CombatSceneSnapshot>) => {
      snapshot = { ...snapshot, ...patch };
    },
    game,
    world,
    scene,
    user,
    tick,
    event,
    drag,
    refresh,
    onTap,
    resize: () => resize(390, height),
  };
};

describe("combat camera gestures", () => {
  it("defers scenery reconciliation to the first frame's appearance suppression", async () => {
    const original = combatEffects.createCombatEffects,
      phases: boolean[] = [];
    vi.spyOn(combatEffects, "createCombatEffects").mockImplementation((...args) => {
      const effects = original(...args),
        sync = effects.sync;
      effects.sync = (next, initial = false) => {
        phases.push(initial);
        return sync(next, initial);
      };
      return effects;
    });
    vi.spyOn(combatTerrain, "prepareCombatTerrain").mockImplementation((...args) => ({
      ...originalTerrain(...args),
      scenery: [
        {
          id: "held-border",
          kind: "decoration",
          image: "held-border.png",
          size: 20,
          x: 30,
          y: 30,
          groundY: 20,
        },
      ],
    }));
    const { promise: held, resolve: release } = deferred<Texture>();
    vi.spyOn(Assets, "load").mockImplementation(async (input) =>
      JSON.stringify(input).includes("held-border") ? held : Texture.WHITE,
    );
    const fixture = await setup(2, false, {}, false);
    const effect = {
      id: "before-first-frame",
      type: "visual",
      longitude: 6,
      latitude: 5,
      power: 100,
      appearSfx: "arrival",
    } as GroundEffect;
    fixture.patchSnapshot({
      sound: true,
      battle: { ...fixture.getSnapshot().battle, groundEffects: [effect] },
    });
    release(Texture.WHITE);
    for (let i = 0; i < 3; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(phases).toEqual([true]);
    fixture.tick();
    expect(phases).toEqual([true, true]);
  });

  it.each([false, true])(
    "keeps fighters usable while border scenery loads and ignores cancelled artwork (%s)",
    async (cancel) => {
      vi.spyOn(combatTerrain, "prepareCombatTerrain").mockImplementation((...args) => ({
        ...originalTerrain(...args),
        scenery: [
          {
            id: "pending-border",
            kind: "decoration",
            image: "pending-combat-border.png",
            size: 20,
            x: 30,
            y: 30,
            groundY: 20,
          },
        ],
      }));
      const { promise: pending, resolve: release } = deferred<Texture>();
      vi.spyOn(Assets, "load").mockImplementation(async (input) =>
        JSON.stringify(input).includes("pending-combat-border")
          ? pending
          : Texture.WHITE,
      );
      const fixture = await setup(2, false);
      expect(fixture.game.isDisposed()).toBe(false);
      expect(fixture.world.getChildByLabel("combat-health", true)).not.toBeNull();
      expect(fixture.world.getChildByLabel("pending-border", true)).toBeNull();
      if (cancel) fixture.scene.dispose();
      release(Texture.WHITE);
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (cancel) expect(fixture.world.destroyed).toBe(true);
      else {
        expect(fixture.world.getChildByLabel("pending-border", true)).not.toBeNull();
        await fixture.scene.renderAt(1000);
        expect(fixture.game.isDisposed()).toBe(false);
      }
    },
  );

  it("reports character details only on a tap and clears the character hit on empty terrain", async () => {
    const { world, user, event, tick, onTap, game } = await setup();
    const actor = world.getChildByLabel(user.userId, true)!;
    const bounds = actor.getChildByLabel("combat-art", true)!.getBounds();
    const x = (bounds.minX + bounds.maxX) / 2,
      y = (bounds.minY + bounds.maxY) / 2;
    event("pointermove", x, y);
    tick();
    expect(onTap).not.toHaveBeenCalled();
    event("pointerdown", x, y);
    event("pointerup", x, y);
    expect(onTap).toHaveBeenCalledTimes(1);
    expect(onTap.mock.calls[0]?.[1]).toEqual({
      tileKey: `${user.longitude},${user.latitude}`,
      userId: user.userId,
      position: { x, y },
    });
    event("pointerdown", 80, game.renderer.height / 2);
    event("pointerup", 80, game.renderer.height / 2);
    expect(onTap).toHaveBeenCalledTimes(2);
    expect(onTap.mock.calls[1]?.[1]).toBeUndefined();
  });
  it("keeps grid markings below physical actors and their HUD", async () => {
    const { world, user } = await setup();
    const outlines = world.getChildByLabel("combat-grid-outlines", true)!;
    const actors = world.children.find((child) =>
      child.getChildByLabel(user.userId),
    ) as Container;
    const fighter = actors.getChildByLabel(user.userId)!;
    const art = fighter.getChildByLabel("combat-art")!;
    const depth = art.parentRenderLayer!,
      ground = outlines.parent!;
    expect(world.getChildIndex(ground)).toBeLessThan(
      world.getChildIndex(depth.parent!),
    );
    const hud = fighter.getChildByLabel("combat-health")!;
    expect(world.getChildIndex(hud.parentRenderLayer!)).toBeGreaterThan(
      world.getChildIndex(ground),
    );
  });
  it("draws static ground effect artwork on the ground plane beneath fighters and grid outlines", async () => {
    const effect = {
      id: "static-ground",
      type: "visual",
      longitude: 6,
      latitude: 5,
      power: 100,
      staticAssetPath: "static-art",
    } as GroundEffect;
    const assets = [
      { id: "static-art", image: "https://example.com/static-art.png" },
    ] as unknown as GameAsset[];
    const { world, user, tick } = await setup(2, true, {
      groundEffects: [effect],
      assets,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    tick();
    const art = world.getChildByLabel(effect.id, true)!;
    expect(art.getChildByLabel("static", true)).toBeTruthy();
    const effectsGround = art.parent!,
      terrain = world.children[0] as Container;
    // Shares the terrain's ground plane: above flat land faces and edges, below grid outlines.
    expect(effectsGround.parent).toBe(terrain);
    const outlines = terrain.children
      .filter((child) => child.label === "combat-grid-outlines")
      .map((child) => child.zIndex);
    expect(effectsGround.zIndex).toBeGreaterThan(5);
    expect(effectsGround.zIndex).toBeLessThan(Math.max(...outlines));
    // And renders before the painter-sorted layer that holds the fighters' artwork.
    const fighter = world.getChildByLabel(user.userId, true)!;
    const depth = fighter.getChildByLabel("combat-art")!.parentRenderLayer!;
    const ground = effectsGround.parentRenderLayer;
    if (ground) {
      expect(ground.parent).toBe(depth.parent);
      expect(ground.parent!.getChildIndex(ground)).toBeLessThan(
        depth.parent!.getChildIndex(depth),
      );
    } else
      expect(world.getChildIndex(terrain)).toBeLessThan(
        world.getChildIndex(depth.parent!),
      );
  });
  it("places recessed targeting strokes between water and higher opaque land faces", async () => {
    const { world } = await setup(2, false);
    const terrain = world.children[0]!;
    const strokes = terrain.children.filter(
      (child) => child.label === "combat-grid-outlines",
    );
    expect(strokes.map((child) => child.zIndex).sort()).toEqual([3.5, 5.5]);
    const water = terrain.children.filter((child) => child.zIndex === 2),
      land = terrain.children.filter((child) => child.zIndex === 4);
    expect(water.length).toBeGreaterThan(0);
    expect(land.length).toBeGreaterThan(0);
    const recessed = strokes.find((child) => child.zIndex === 3.5)!;
    for (const face of water) expect(face.zIndex).toBeLessThan(recessed.zIndex);
    for (const face of land) expect(face.zIndex).toBeGreaterThan(recessed.zIndex);
    expect(terrain.sortableChildren).toBe(true);
  });
  it("retains a manually panned view across frames, resize and unchanged battle refreshes", async () => {
    const { world, drag, tick, refresh, resize, onTap } = await setup();
    const initial = world.position.clone();
    drag(30, 20);
    const panned = world.position.clone();
    expect(panned.x).toBeCloseTo(initial.x + 30);
    expect(panned.y).toBeCloseTo(initial.y + 20);
    tick(120);
    refresh();
    tick(120);
    resize();
    tick();
    expect(world.position.x).toBeCloseTo(panned.x);
    expect(world.position.y).toBeCloseTo(panned.y);
    expect(onTap).not.toHaveBeenCalled();
  });
  it("bounds both drag directions and resets the fit view when zoomed out", async () => {
    const { game, world, drag, tick } = await setup();
    drag(10000, 10000);
    expect(world.x).toBeCloseTo(0);
    expect(world.y).toBeCloseTo(game.renderer.height * 2);
    drag(-10000, -10000);
    expect(world.x).toBeCloseTo(-game.renderer.width);
    expect(world.y).toBeCloseTo(game.renderer.height);
    game.canvas.dispatchEvent(
      new window.WheelEvent("wheel", { deltaY: 10000, cancelable: true }),
    );
    tick();
    expect(world.scale.x).toBe(1);
    expect(world.x).toBeCloseTo(0);
    expect(world.y).toBeCloseTo(game.renderer.height);
    drag(60, 60);
    expect(world.x).toBeCloseTo(0);
    expect(world.y).toBeCloseTo(game.renderer.height);
  });
  it("resumes tracking the rendered fighter when it moves instead of jumping to its destination", async () => {
    const { world, scene, drag, tick, refresh, user } = await setup();
    drag(40, 20);
    const actors = world.children.find((child) =>
        child.getChildByLabel(user.userId),
      ) as Container,
      actor = actors.getChildByLabel(user.userId)!;
    const originalX = actor.x;
    const destination = scene.grid.getHex({ col: 10, row: user.latitude })!;
    const originalFocus = originalX + destination.width / 2;
    const destinationFocus = -destination.center.x + destination.width / 2;
    refresh(10);
    tick(12);
    expect(actor.x).toBeGreaterThan(originalX);
    const cameraX = (195 - world.x) / world.scale.x;
    expect(cameraX).toBeLessThan((originalFocus + destinationFocus) / 2);
    tick(300);
    expect(actor.x).toBeCloseTo(-destination.center.x);
    expect((195 - world.x) / world.scale.x).toBeGreaterThan(cameraX);
  });
});
