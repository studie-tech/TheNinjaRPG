import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { Assets, Container, Texture, UniformGroup } from "pixi.js";
import { getBattlefieldHeightRatio } from "@/libs/combat/util";
import * as runtime from "@/libs/rendering/runtime";
import type { GameFrame, GameRenderer } from "@/libs/rendering/runtime";
import { createCombatScene, type CombatSceneSnapshot } from "@/libs/rendering/scenes/combat";
import { makeBattleUser, makeCompleteBattle } from "../combat/helpers/battleScenario";
import { ensureDom } from "../../setup/dom.mjs";

ensureDom();
const cleanups: (() => void)[] = [];
beforeEach(() => {
  vi.spyOn(Assets, "load").mockImplementation(async () => Texture.WHITE);
  vi.spyOn(Assets, "unload").mockResolvedValue(undefined);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => { for (const dispose of cleanups.splice(0)) dispose(); vi.restoreAllMocks(); });

/** Exercise actual scene transforms and gestures without a GPU or network textures. */
const setup = async (zoom = 2) => {
  const user = makeBattleUser("camera-user", { isAi: true, isOriginal: true, longitude: 6, latitude: 5 });
  const battle = makeCompleteBattle({ usersState: [user], width: 12, height: 10 });
  let snapshot = { battle, userId: user.userId, actions: [], timeDiff: 0, assets: [], requestedIds: new Set(), active: true, sound: false, volume: 0, showGridNumbers: false, inspect: true } as unknown as CombatSceneSnapshot;
  const height = 390 * getBattlefieldHeightRatio(12, 10), canvas = document.createElement("canvas");
  canvas.getBoundingClientRect = () => new DOMRect(0, 0, 390, height);
  const listeners = new window.AbortController(), owned = new Set<() => void>();
  let update = (_frame: GameFrame) => {}, resize = (_width: number, _height: number) => {}, disposed = false;
  const game = {
    stage: new Container(), canvas, signal: new AbortController().signal,
    animation: new UniformGroup({ uTime: { value: 0, type: "f32" } }),
    renderer: { width: 390, height }, assets: { texture: async () => Texture.WHITE },
    own: (callback: () => void) => owned.add(callback), disown: (callback: () => void) => owned.delete(callback),
    isDisposed: () => disposed, invalidate() {}, setAnimating() {},
    setUpdate: (callback: typeof update) => { update = callback; },
    setResize: (callback: typeof resize) => { resize = callback; callback(390, height); },
    listen: (type: string, callback: EventListener) => canvas.addEventListener(type, callback, { signal: listeners.signal }),
    dispose: () => { if (disposed) return; disposed = true; listeners.abort(); game.stage.destroy({ children: true }); for (const callback of owned) callback(); },
  } as unknown as GameRenderer;
  vi.spyOn(runtime, "createGameRenderer").mockResolvedValue(game);
  const onTap = vi.fn(), scene = await createCombatScene({ mount: document.createElement("div"), signal: game.signal, onError: vi.fn(), getSnapshot: () => snapshot, onTap, onHover: vi.fn(), onZoom: vi.fn(), play() {}, initialZoom: zoom, lightLayout: true });
  cleanups.push(scene.dispose);
  const world = game.stage.children[0] as Container;
  let now = 0;
  const tick = (count = 1) => { for (let i = 0; i < count; i++) update({ now: now += 1000 / 60, delta: 1 / 60, reducedMotion: false }); };
  const event = (type: string, x: number, y: number) => {
    const pointer = new window.MouseEvent(type, { button: 0, clientX: x, clientY: y });
    Object.defineProperty(pointer, "pointerId", { value: 1 }); canvas.dispatchEvent(pointer);
  };
  const drag = (dx: number, dy: number) => { event("pointerdown", 195, height / 2); event("pointermove", 195 + dx, height / 2 + dy); event("pointerup", 195 + dx, height / 2 + dy); tick(); };
  const refresh = (longitude?: number) => { snapshot = { ...snapshot, battle: { ...snapshot.battle, version: snapshot.battle.version + 1, usersState: snapshot.battle.usersState.map((fighter) => longitude === undefined ? { ...fighter } : { ...fighter, longitude }) } }; scene.refresh(); };
  tick(120);
  return { game, world, scene, user, tick, drag, refresh, onTap, resize: () => resize(390, height) };
};

describe("combat camera gestures", () => {
  it("keeps grid markings below physical actors and their HUD", async () => {
    const { world, user } = await setup();
    const outlines = world.getChildByLabel("combat-grid-outlines", true)!;
    const actors = world.children.find((child) => child.getChildByLabel(user.userId)) as Container;
    const fighter = actors.getChildByLabel(user.userId)!;
    const art = fighter.getChildByLabel("combat-art")!;
    const depth = art.parentRenderLayer!, ground = outlines.parent!;
    expect(depth.parent).toBe(ground);
    expect(ground.getChildIndex(outlines)).toBeLessThan(ground.getChildIndex(depth));
    const hud = fighter.getChildByLabel("combat-health")!;
    expect(world.getChildIndex(hud.parentRenderLayer!)).toBeGreaterThan(world.getChildIndex(ground));
  });
  it("retains a manually panned view across frames, resize and unchanged battle refreshes", async () => {
    const { world, drag, tick, refresh, resize, onTap } = await setup();
    const initial = world.position.clone();
    drag(30, 20);
    const panned = world.position.clone();
    expect(panned.x).toBeCloseTo(initial.x + 30); expect(panned.y).toBeCloseTo(initial.y + 20);
    tick(120); refresh(); tick(120); resize(); tick();
    expect(world.position.x).toBeCloseTo(panned.x); expect(world.position.y).toBeCloseTo(panned.y);
    expect(onTap).not.toHaveBeenCalled();
  });
  it("bounds both drag directions and resets the fit view when zoomed out", async () => {
    const { game, world, drag, tick } = await setup();
    drag(10000, 10000);
    expect(world.x).toBeCloseTo(0); expect(world.y).toBeCloseTo(game.renderer.height * 2);
    drag(-10000, -10000);
    expect(world.x).toBeCloseTo(-game.renderer.width); expect(world.y).toBeCloseTo(game.renderer.height);
    game.canvas.dispatchEvent(new window.WheelEvent("wheel", { deltaY: 10000, cancelable: true })); tick();
    expect(world.scale.x).toBe(1); expect(world.x).toBeCloseTo(0); expect(world.y).toBeCloseTo(game.renderer.height);
    drag(60, 60);
    expect(world.x).toBeCloseTo(0); expect(world.y).toBeCloseTo(game.renderer.height);
  });
  it("resumes tracking the rendered fighter when it moves instead of jumping to its destination", async () => {
    const { world, scene, drag, tick, refresh, user } = await setup();
    drag(40, 20);
    const actors = world.children.find((child) => child.getChildByLabel(user.userId)) as Container, actor = actors.getChildByLabel(user.userId)!;
    const originalX = actor.x;
    const destination = scene.grid.getHex({ col: 10, row: user.latitude })!;
    const originalFocus = originalX + destination.width / 2;
    const destinationFocus = -destination.center.x + destination.width / 2;
    refresh(10); tick(12);
    expect(actor.x).toBeGreaterThan(originalX);
    const cameraX = (195 - world.x) / world.scale.x;
    expect(cameraX).toBeLessThan((originalFocus + destinationFocus) / 2);
    tick(300);
    expect(actor.x).toBeCloseTo(-destination.center.x);
    expect((195 - world.x) / world.scale.x).toBeGreaterThan(cameraX);
  });
});
