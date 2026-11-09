import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { Assets, Container, Texture, UniformGroup } from "pixi.js";
import type { GameAsset } from "@/drizzle/schema";
import type { GroundEffect } from "@/libs/combat/types";
import { hexGridHeightRatio } from "@/libs/hexgrid";
import * as terrainPrimitive from "@/libs/rendering/primitives/terrain";
import type { GameFrame, GameRenderer } from "@/libs/rendering/runtime";
import * as runtime from "@/libs/rendering/runtime";
import {
  type CombatSceneSnapshot,
  createCombatScene,
} from "@/libs/rendering/scenes/combat";
import * as combatEffects from "@/libs/rendering/scenes/combatEffects";
import { DEFAULT_VISUAL_EFFECTS } from "@/libs/visualEffects";
import { makeBattleUser, makeCompleteBattle } from "../../setup/combat";
import { deferred } from "../../setup/deferred";

const HELD_AVATAR = "https://example.com/held-fighter.png";
const cleanups: (() => void)[] = [];
beforeEach(() => {
  vi.spyOn(Assets, "unload").mockResolvedValue(undefined);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => {
  for (const dispose of cleanups.splice(0)) dispose();
  vi.restoreAllMocks();
});

/** Starts a scene against a GPU-free renderer whose fighter artwork is held until released. */
const start = (
  extra: { groundEffects?: GroundEffect[]; assets?: GameAsset[] } = {},
) => {
  const fighterArt = deferred<Texture>();
  vi.spyOn(Assets, "load").mockImplementation(async (input) =>
    JSON.stringify(input).includes("held-fighter") ? fighterArt.promise : Texture.WHITE,
  );
  const user = makeBattleUser("startup-user", {
    isAi: true,
    isOriginal: true,
    avatar: HELD_AVATAR,
    longitude: 6,
    latitude: 5,
  });
  const made = makeCompleteBattle({
    usersState: [user],
    width: 12,
    height: 10,
    background: "ground",
    groundEffects: extra.groundEffects ?? [],
  });
  const battle = {
    ...made,
    extraState: {
      ...made.extraState,
      textureAssets: (extra.assets ?? []).map((asset) => asset.id),
    },
  };
  let snapshot = {
    battle,
    userId: user.userId,
    actions: [],
    timeDiff: 0,
    assets: [],
    requestedIds: new Set(),
    active: true,
    sound: false,
    volume: 0,
    showGridNumbers: false,
    inspect: true,
  } as unknown as CombatSceneSnapshot;
  const height = 390 * hexGridHeightRatio(12, 10);
  const canvas = document.createElement("canvas");
  canvas.getBoundingClientRect = () => new DOMRect(0, 0, 390, height);
  const owned = new Set<() => void>();
  let update: ((frame: GameFrame) => void) | null = null;
  let disposed = false;
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
    setUpdate: (callback: (frame: GameFrame) => void) => {
      update = callback;
    },
    setResize: (callback: (width: number, height: number) => void) =>
      callback(390, height),
    listen: () => {},
    dispose: () => {
      if (disposed) return;
      disposed = true;
      game.stage.destroy({ children: true });
      for (const callback of owned) callback();
    },
  } as unknown as GameRenderer;
  cleanups.push(game.dispose);
  vi.spyOn(runtime, "createGameRenderer").mockResolvedValue(game);
  let resolved = false;
  const scene = createCombatScene({
    mount: document.createElement("div"),
    signal: game.signal,
    onError: vi.fn(),
    getSnapshot: () => snapshot,
    onTap: vi.fn(),
    onHover: vi.fn(),
    onZoom: vi.fn(),
    play() {},
    initialZoom: 1,
    lightLayout: true,
    seed: "startup-seed",
  }).then((instance) => {
    resolved = true;
    cleanups.push(instance.dispose);
    return instance;
  });
  let now = 0;
  const tick = () => {
    now += 1000 / 60;
    update?.({ now, delta: 1 / 60, reducedMotion: false });
  };
  return {
    game,
    scene,
    fighterArt,
    tick,
    isResolved: () => resolved,
    isDrawing: () => update !== null,
    patchSnapshot: (patch: Partial<CombatSceneSnapshot>) => {
      snapshot = { ...snapshot, ...patch };
    },
  };
};

const settle = async () => {
  for (let index = 0; index < 5; index++)
    await new Promise((resolve) => setTimeout(resolve, 0));
};

describe("combat scene startup", () => {
  it("draws the field while fighter artwork loads and resolves once the fighters can be seen", async () => {
    const terrain = vi.spyOn(terrainPrimitive, "createHexTerrain");
    const fixture = start();
    await settle();
    // Terrain draws tinted faces instead of waiting for its images.
    expect(terrain.mock.calls[0]?.[3]).toEqual({ deferTextures: true });
    expect(fixture.isDrawing()).toBe(true);
    expect(fixture.isResolved()).toBe(false);
    fixture.tick();
    const world = fixture.game.stage.children[0] as Container;
    // The first frame positions the camera and shows the fighter's meters before its art.
    expect(world.scale.x).toBeGreaterThan(0);
    expect(world.getChildByLabel("combat-health", true)).not.toBeNull();
    expect(world.getChildByLabel("combat-art", true)?.children).toHaveLength(0);
    fixture.fighterArt.resolve(Texture.WHITE);
    await fixture.scene;
    expect(fixture.isResolved()).toBe(true);
    fixture.tick();
    expect(world.getChildByLabel("combat-art", true)?.children.length).toBeGreaterThan(
      0,
    );
  });

  it("keeps effects present at load from replaying their arrival when their assets arrive after the first frames", async () => {
    const original = combatEffects.createCombatEffects;
    const phases: boolean[] = [];
    vi.spyOn(combatEffects, "createCombatEffects").mockImplementation((...args) => {
      const effects = original(...args);
      const sync = effects.sync;
      effects.sync = (next, initial = false) => {
        phases.push(initial);
        return sync(next, initial);
      };
      return effects;
    });
    const asset = {
      id: "late-art",
      image: "https://example.com/late-art.png",
    } as GameAsset;
    const present = {
      id: "present-at-load",
      type: "visual",
      longitude: 6,
      latitude: 5,
      power: 100,
      appearAnimation: asset.id,
    } as unknown as GroundEffect;
    const fixture = start({ groundEffects: [present], assets: [asset] });
    await settle();
    fixture.tick();
    fixture.tick();
    // Without the battle's asset names the field draws, but effects wait for them.
    expect(phases).toEqual([]);
    // Visible fighters alone do not release autonomous turns before the active effects sync.
    fixture.fighterArt.resolve(Texture.WHITE);
    await settle();
    expect(fixture.isDrawing()).toBe(true);
    expect(fixture.isResolved()).toBe(false);
    fixture.patchSnapshot({ assets: [asset], requestedIds: new Set([asset.id]) });
    fixture.tick();
    expect(phases).toEqual([true]);
    await fixture.scene;
    expect(fixture.isResolved()).toBe(true);
    fixture.patchSnapshot({ revision: 1 });
    fixture.tick();
    expect(phases).toEqual([true, false]);
  });
});
