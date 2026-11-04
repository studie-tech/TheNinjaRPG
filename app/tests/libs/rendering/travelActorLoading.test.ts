import { lpcCatalog } from "../../setup/lpc";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { Assets, BufferImageSource, Container, Graphics, RenderLayer, type Sprite, Text, Texture } from "pixi.js";
import { getBattleGrid } from "@/libs/combat/util";
import { anonymousSpriteAppearance, resolveSpriteAppearance } from "@/libs/lpc/appearance";
import * as maskedTextures from "@/libs/rendering/maskedTextures";
import * as characters from "@/libs/rendering/primitives/character";
import type { GameRenderer } from "@/libs/rendering/runtime";
import type { WorldBounds } from "@/libs/rendering/visibility";
import { createTravelActors, type TravelActorMovement, type TravelActorsSnapshot } from "@/libs/rendering/scenes/travelActors";
import type { SectorUser } from "@/libs/sector-map/world-types";
import type { UserWithRelations } from "@/routers/profile";

const cleanups: (() => void)[] = [];
const originalCreate = characters.createLpcCharacter;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const frame = { now: 1000, delta: 1 / 60, reducedMotion: true };
const viewer = { userId: "viewer", rank: "JONIN", userQuests: [], questData: [] } as unknown as UserWithRelations;
const player = (index = 0, patch: Partial<SectorUser> = {}) => ({
  userId: `loading-${index}`, longitude: index % 10, latitude: Math.floor(index / 10), status: "AWAKE", rank: "JONIN", allianceStatus: "NEUTRAL", experience: 0, curHealth: 1, maxHealth: 100,
  spriteAppearance: resolveSpriteAppearance({}), avatarLight: `loading-portrait-${index}.png`, ...patch,
}) as SectorUser;
/** Real actor/sprite geometry and scopes; only image decoding is replaced. */
const fixture = (sceneryBounds?: WeakMap<Container, WorldBounds>) => {
  const controller = new AbortController();
  const owned = new Set<() => void>();
  const stage = new Container({ isRenderGroup: true });
  const depth = new RenderLayer(), overlay = new RenderLayer(), ground = new RenderLayer();
  const game = {
    lpcCatalog,
    invalidate: vi.fn(),
    signal: controller.signal, isDisposed: () => controller.signal.aborted,
    own: (cleanup: () => void) => owned.add(cleanup), disown: (cleanup: () => void) => owned.delete(cleanup),
  } as unknown as GameRenderer;
  const actors = createTravelActors(game, { depth, overlay, ground }, undefined, sceneryBounds);
  stage.addChild(actors.container, ground, depth, overlay);
  const grid = getBattleGrid(40, { width: 12, height: 12, biome: "ground" } as never, { x: 0, y: 0 });
  const snapshot = (users: SectorUser[]): TravelActorsSnapshot => ({ grid, users, viewer, sector: 724, minBracket: -1, showUsers: true, friendlyAttack: false, structureObjectiveIds: new Set() });
  const dispose = () => { if (controller.signal.aborted) return; controller.abort(); for (const cleanup of owned) cleanup(); stage.destroy({ children: true, texture: false, textureSource: false }); };
  cleanups.push(dispose);
  return { game, actors, grid, stage, depth, overlay, ground, snapshot, dispose };
};
const holdCharacters = () => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  cleanups.push(release);
  const create = vi.spyOn(characters, "createLpcCharacter").mockImplementation(async (...args) => { await gate; return originalCreate(...args); });
  return { release, create };
};
const bodyPoint = (root: Container, tile: { width: number; height: number }) => root.toGlobal({ x: tile.width / 2, y: tile.height * (0.1 + 1.8 * 0.7 / 2) });
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  const texture = new Texture({ source: new BufferImageSource({ resource: new Uint8Array(4), width: 4096, height: 4096 }) });
  vi.spyOn(Assets, "load").mockImplementation(async () => texture);
  vi.spyOn(Assets, "unload").mockResolvedValue(undefined);
  vi.spyOn(maskedTextures, "acquireMaskedTexture").mockImplementation(() => ({ resource: Promise.resolve(texture), release: () => {} }));
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => { for (const cleanup of cleanups.splice(0)) cleanup(); await settle(); vi.restoreAllMocks(); });

describe("travel actor artwork loading", () => {
  it("keeps moving contact effects on the ground and batches emitter pools together", async () => {
    const { actors, snapshot, ground } = fixture();
    actors.sync(snapshot([player(0), player(1)]));
    await settle();
    const effects = ground.renderLayerChildren;
    expect(effects.map(effect => effect.label)).toEqual(["scenery-shadows", "scenery-shadows", "scenery-lights", "scenery-lights"]);
    const light = effects[2]!;
    const root = light.parent!.parent!;
    const before = light.toGlobal({ x: 0, y: 0 });
    root.x += 12;
    expect(light.toGlobal({ x: 0, y: 0 }).x - before.x).toBeCloseTo(12);
    actors.sync(snapshot([player(0)]));
    expect(ground.renderLayerChildren).toHaveLength(2);
    expect(ground.renderLayerChildren.every(effect => !effect.destroyed)).toBe(true);
  });
  it("resolves visibility once per occupied tile while retaining the entire crowd count", () => {
    holdCharacters();const {actors,grid,snapshot}=fixture();
    const users=Array.from({length:264},(_,i)=>player(i,{longitude:4,latitude:4}));
    const tile=grid.getHex({col:4,row:4})!;
    actors.setViewport({minX:-tile.center.x,maxX:-tile.center.x+100,minY:-tile.center.y,maxY:-tile.center.y+100});
    const lookup=vi.spyOn(grid,"getHex");actors.sync(snapshot(users));
    expect(lookup.mock.calls.length).toBeLessThan(10);expect(actors.container.children.filter(root=>root.label.startsWith("user:"))).toHaveLength(20);
    const badge=actors.container.getChildByLabel("count:4,4")!;
    expect((badge.children[0]!.children.find(child=>child instanceof Text) as Text).text).toBe("264");
  });

  it("keeps hover eligibility current after occupancy and health updates",async()=>{
    const {actors,snapshot}=fixture();const target=player(0,{longitude:4,latitude:4}),neighbor=player(1,{longitude:5,latitude:4});
    actors.sync(snapshot([target,neighbor]));await settle();const root=actors.container.getChildByLabel("user:loading-0")!;
    const info=root.getChildByLabel("info",true)!,heal=root.getChildByLabel("heal",true)!;
    expect(info.visible).toBe(false);actors.hover("user:loading-0");expect(info.visible).toBe(true);expect(heal.visible).toBe(true);
    actors.sync(snapshot([target,{...neighbor,longitude:4}]));expect(info.visible).toBe(false);expect(heal.visible).toBe(false);
    actors.sync(snapshot([{...target,curHealth:target.maxHealth},neighbor]));expect(info.visible).toBe(true);expect(heal.visible).toBe(false);
    actors.hover(null);expect(info.visible).toBe(false);
  });

  it("retains a crowd badge and loaded actors when its count changes", async () => {
    holdCharacters();
    const { actors, snapshot } = fixture();
    const users = Array.from({ length: 4 }, (_, i) => player(i, { longitude: 4, latitude: 4 }));
    actors.sync(snapshot(users));
    const badge = actors.container.getChildByLabel("count:4,4")!;
    const labels: Text[] = [];
    const visit = (root: Container) => { if (root instanceof Text) labels.push(root); for (const child of root.children) visit(child); };
    visit(badge);
    const label = labels[0]!;
    expect(label.text).toBe("4");
    const bodies = actors.container.children.filter(root => root.label?.startsWith("user:"));
    actors.sync(snapshot(users.slice(0, 3)));
    expect(actors.container.getChildByLabel("count:4,4")).toBe(badge);
    expect(label.destroyed).toBe(false);
    expect(label.text).toBe("3");
    expect(actors.container.children.filter(root => root.label?.startsWith("user:"))).toEqual(bodies.slice(0, 3));
    actors.sync(snapshot(users.slice(0, 2)));
    expect(badge.destroyed).toBe(true);
  });
  it("holds keys across disjoint planes and checks nonadjacent artwork when moving sideways into overlap", () => {
    holdCharacters(); const bounds = new WeakMap<Container, WorldBounds>();
    const { actors, grid, stage, depth, snapshot } = fixture(bounds);
    const user = player(0, { longitude: 4, latitude: 4 }); actors.sync(snapshot([user]));
    const root = actors.container.children[0]!, key = root.zIndex, x = root.x, y = root.y;
    const scenery = [-20, -10, 200].map((offset, i) => {
      const object = new Graphics().rect(-20, -200, 40, 400).fill(0xffffff);
      object.position.set(x + (i + 1) * 2000, y); object.zIndex = key + offset;
      bounds.set(object, { minX: object.x - 20, maxX: object.x + 20, minY: y - 200, maxY: y + 200 });
      stage.addChild(object); depth.attach(object); return object;
    });
    depth.sortRenderLayerChildren(); stage.renderGroup!.structureDidChange = false;
    const move = (nextX: number, nextY: number) => actors.animate(frame, new Map([[user.userId, { x: nextX, y: nextY, direction: null, facing: 1 }]]));
    move(x, y + 30);
    expect(root.zIndex).toBe(key);
    expect(stage.renderGroup!.structureDidChange).toBe(false);
    expect(depth.renderLayerChildren).toEqual([scenery[0]!, scenery[1]!, root, scenery[2]!]);
    move(x + 2000, y + 30);
    const tile = grid.getHex({ col: 4, row: 4 })!;
    expect(root.zIndex).toBeCloseTo(-(root.y + tile.height * (0.1 + 1.8 * 0.7 * 4 / 64)));
    expect(depth.renderLayerChildren[0]).toBe(root);
  });
  it("retains parallel actors without scanning beyond their correct depth neighbours", () => {
    holdCharacters(); const bounds = new WeakMap<Container, WorldBounds>();
    const { actors, stage, depth, snapshot } = fixture(bounds);
    const users = Array.from({ length: 80 }, (_, i) => player(i, { longitude: i % 10, latitude: Math.floor(i / 10) }));
    actors.sync(snapshot(users));
    const roots = actors.container.children.filter(root => root.label?.startsWith("user:"));
    expect(roots).toHaveLength(20);
    const move = (offset: number) => actors.animate(frame, new Map(roots.map((root, i) => [root.label.slice("user:".length), { x: i * 100, y: i * 40 + offset, direction: null, facing: 1 }])));
    move(0); const keys = roots.map(root => root.zIndex);
    stage.renderGroup!.structureDidChange = false;
    move(1);
    expect(roots.map(root => root.zIndex)).toEqual(keys);
    expect(stage.renderGroup!.structureDidChange).toBe(false);
  });
  it("refreshes held ordering for expanded actor artwork and unknown scenery", () => {
    holdCharacters(); const bounds = new WeakMap<Container, WorldBounds>();
    const { actors, stage, depth, snapshot } = fixture(bounds);
    const user = player(0, { longitude: 4, latitude: 4 }); actors.sync(snapshot([user]));
    const root = actors.container.children[0]!, key = root.zIndex, x = root.x, y = root.y;
    const object = new Graphics().rect(-10, -100, 20, 200).fill(0xffffff);
    object.position.set(x + 150, y); object.zIndex = key - 10; stage.addChild(object); depth.attach(object);
    bounds.set(object, { minX: object.x - 10, maxX: object.x + 10, minY: y - 100, maxY: y + 100 });
    depth.sortRenderLayerChildren();
    const move = (dy: number) => actors.animate(frame, new Map([[user.userId, { x, y: y + dy, direction: null, facing: 1 }]]));
    move(20); expect(root.zIndex).toBe(key);
    root.addChild(new Graphics().rect(0, -100, 192, 100).fill(0xffffff));
    move(20); expect(root.zIndex).toBeCloseTo(key - 20);
    move(0); expect(root.zIndex).toBeCloseTo(key);
    bounds.delete(object); move(20); expect(root.zIndex).toBeCloseTo(key - 20);
    actors.container.y += 500; move(20); expect(root.zIndex).toBeCloseTo(key - 520);
  });
  it("retains painter keys between contact-order crossings and updates them across scenery", () => {
    holdCharacters();
    const { actors, grid, stage, depth, snapshot } = fixture();
    const user = player(0, { longitude: 4, latitude: 4 }); actors.sync(snapshot([user]));
    const root = actors.container.children[0]!, key = root.zIndex, tile = grid.getHex({ col: 4, row: 4 })!;
    const scenery = [-20, 20].map(offset => { const sprite = new Container(); sprite.zIndex = key + offset; stage.addChild(sprite); depth.attach(sprite); return sprite; });
    const move = (y: number) => actors.animate(frame, new Map([[user.userId, { x: root.x, y, direction: null, facing: 1 }]]));
    move(root.y); stage.renderGroup!.structureDidChange = false;
    const y = root.y; move(y + 1);
    expect(root.zIndex).toBe(key); expect(root.y).toBe(y + 1);
    expect(stage.renderGroup!.structureDidChange).toBe(false);
    expect(depth.renderLayerChildren).toEqual([scenery[0]!, root, scenery[1]!]);
    move(y + 30);
    expect(root.zIndex).toBeCloseTo(-(root.y + tile.height * (0.1 + 1.8 * 0.7 * 4 / 64)));
    expect(depth.renderLayerChildren).toEqual([root, ...scenery]);
  });
  it.each([false, true])("orders crossing actors and inserted scenery by live contact planes (bounds: %s)", (spatial) => {
    holdCharacters();
    const { actors, grid, stage, depth, snapshot } = fixture(spatial ? new WeakMap() : undefined);
    let users = [player(0, { longitude: 4, latitude: 4 }), player(1, { longitude: 5, latitude: 5 })]; actors.sync(snapshot(users));
    const offset = grid.getHex({ col: 4, row: 4 })!.height * (0.1 + 1.8 * 0.7 * 4 / 64);
    const fixed = new Container(); fixed.zIndex = -100; stage.addChild(fixed); depth.attach(fixed);
    const check = (a: number, b: number) => {
      actors.animate(frame, new Map(users.map((user, index) => [user.userId, { x: 100 + index * 10, y: -(index ? b : a) - offset - actors.container.y, direction: null, facing: 1 }])));
      const contact = (root: Container) => root === fixed ? root.zIndex : -(root.y + offset + actors.container.y);
      for (let i = 1; i < depth.renderLayerChildren.length; i++) expect(contact(depth.renderLayerChildren[i - 1]!)).toBeLessThanOrEqual(contact(depth.renderLayerChildren[i]!));
    };
    for (let i = 0; i < 100; i++) check(-100 + 35 * Math.sin(i * 0.7), -100 + 35 * Math.cos(i * 0.4));
    check(20, 25); check(28, 29);
    fixed.zIndex = 27; check(28, 29);
    users = [users[0]!, player(2, { longitude: 5, latitude: 5 })]; actors.sync(snapshot(users)); check(-120, -90);
    actors.container.y += 500; check(-85, -115);
  });
  it("preserves a roaming NPC's rectangular artwork proportions", async () => {
    const texture = new Texture({ source: new BufferImageSource({ resource: new Uint8Array(4 * 8 * 4), width: 4, height: 8 }) });
    vi.spyOn(Assets, "load").mockImplementation(async () => texture);
    cleanups.push(() => texture.destroy(true));
    const { actors, snapshot } = fixture();
    actors.sync(snapshot([player(0, { isNpc: true, spriteAppearance: undefined, avatar: "rectangular-npc.png" })]));
    await settle();
    const figure = actors.container.children[0]!.getChildByLabel("avatar", true) as Sprite;
    expect(Math.abs(figure.scale.x)).toBeCloseTo(Math.abs(figure.scale.y));
    expect(figure.width / figure.height).toBeCloseTo(0.5);
  });
  it("reaches a multi-tile presence update in one still frame without replaying its path", async () => {
    const { actors, grid, snapshot } = fixture();
    const user = player(0, { longitude: 4, latitude: 4 });
    actors.sync(snapshot([user])); await settle();
    const root = actors.container.children[0]!;
    actors.sync(snapshot([{ ...user, latitude: 8 }]));
    actors.animate({ ...frame, reducedMotion: true });
    const tile = grid.getHex({ col: 4, row: 8 })!;
    expect(root.position).toMatchObject({ x: -tile.center.x, y: -tile.center.y });
    actors.animate({ ...frame, now: 1200, reducedMotion: false });
    expect(root.position).toMatchObject({ x: -tile.center.x, y: -tile.center.y });
  });

  it("does not replay queued network waypoints after a timed walk finishes", async () => {
    const { actors, grid, snapshot } = fixture();
    const user = player(0, { longitude: 4, latitude: 4 });
    actors.sync(snapshot([user])); await settle();
    const root = actors.container.children[0]!;
    for (const latitude of [5, 6]) {
      actors.sync(snapshot([{ ...user, latitude }]));
      const tile = grid.getHex({ col: 4, row: latitude })!;
      const movements = new Map<string, TravelActorMovement>([[user.userId, {
        x: -tile.center.x, y: -tile.center.y, direction: null, facing: 1,
      }]]);
      actors.animate({ ...frame, reducedMotion: false }, movements);
      expect(root.position).toMatchObject({ x: -tile.center.x, y: -tile.center.y });
    }
    const arrived = { x: root.x, y: root.y };
    // The published edge is removed once its clock ends, before the server confirmation can refetch.
    for (let tick = 0; tick < 12; tick++) {
      actors.animate({ ...frame, now: 1200 + tick * 16, reducedMotion: false });
      expect(root.position).toMatchObject(arrived);
    }
    actors.sync(snapshot([{ ...user, latitude: 6 }]));
    actors.animate({ ...frame, reducedMotion: false });
    expect(root.position).toMatchObject(arrived);
    // A later authoritative update still uses ordinary remote-actor interpolation.
    actors.sync(snapshot([{ ...user, latitude: 7 }]));
    actors.animate({ ...frame, reducedMotion: false });
    expect(root.y).not.toBe(arrived.y);
  });

  it("caps pending characters at twenty and keeps their bodies pickable without adding singleton badges", async () => {
    const pending = holdCharacters();
    const { actors, grid, depth, snapshot } = fixture();
    actors.sync(snapshot(Array.from({ length: 100 }, (_, index) => player(index))));
    expect(pending.create).toHaveBeenCalledTimes(20);
    expect(actors.container.children).toHaveLength(20);
    const bodies = actors.container.children.filter(root => root.label.startsWith("user:"));
    expect(bodies).toHaveLength(20);
    expect(actors.container.children.filter(root => root.label.startsWith("count:"))).toHaveLength(0);
    for (const root of bodies) {
      const index = Number(root.label.slice("user:loading-".length));
      const tile = grid.getHex({ col: index % 10, row: Math.floor(index / 10) })!;
      const body = root.children.find((child) => child.label === "avatar");
      expect(body).toBeInstanceOf(Graphics);
      expect(body?.visible).toBe(true);
      expect(root.parentRenderLayer).toBe(depth);
      expect(root.zIndex).toBeCloseTo(-(root.y + tile.height * (0.1 + 1.8 * 0.7 * 4 / 64)));
      const point = bodyPoint(root, tile);
      expect(actors.hit(point.x, point.y)).toMatchObject({ type: "avatar", userId: `loading-${index}` });
    }
    pending.release(); await settle();
    expect(actors.container.children.every((root) => !root.children.some((child) => child.label === "avatar"))).toBe(true);
  });

  it("retains the viewer, promotes real movement, ignores activity-only updates and preserves full crowd totals", () => {
    holdCharacters();
    const { actors, snapshot } = fixture();
    let users = Array.from({ length: 30 }, (_, i) => player(i, { longitude: 4, latitude: 4, updatedAt: new Date(i) }));
    users.push(player(99, { userId: "viewer", longitude: 4, latitude: 4, updatedAt: new Date(0) }));
    actors.sync(snapshot(users));
    const bodies = () => actors.container.children.filter(root => root.label.startsWith("user:"));
    expect(bodies()).toHaveLength(20);
    expect(bodies().some(root => root.label === "user:viewer")).toBe(true);
    expect(bodies().some(root => root.label === "user:loading-0")).toBe(false);
    const original = bodies();
    users = users.map(user => user.userId === "loading-0" ? { ...user, updatedAt: new Date(999999), curHealth: 10 } : user);
    actors.sync(snapshot(users));
    expect(bodies()).toEqual(original);
    users = users.map(user => user.userId === "loading-0" ? { ...user, latitude: 5 } : user);
    actors.sync(snapshot(users));
    expect(bodies()).toHaveLength(20);
    expect(bodies().some(root => root.label === "user:loading-0")).toBe(true);
    expect(bodies().some(root => root.label === "user:viewer")).toBe(true);
    const totals: string[] = [];
    const visit = (root: Container) => { if (root instanceof Text) totals.push(root.text); for (const child of root.children) visit(child); };
    for (const root of actors.container.children) if (root.label.startsWith("count:")) visit(root);
    expect(totals).toEqual(["30"]);
  });

  it("fills the screen from its own crowd instead of reserving slots for recently active offscreen users", () => {
    holdCharacters();
    const { actors, grid, snapshot } = fixture();
    const users = Array.from({ length: 40 }, (_, i) => player(i, {
      longitude: i < 20 ? 1 : 8, latitude: i < 20 ? 1 : 8, updatedAt: new Date(i),
    }));
    const tile = grid.getHex({ col: 1, row: 1 })!;
    actors.setViewport({ minX: -tile.center.x, maxX: -tile.center.x + 1, minY: -tile.center.y, maxY: -tile.center.y + 1 });
    actors.sync(snapshot(users));
    let bodies = actors.container.children.filter(root => root.label.startsWith("user:"));
    expect(bodies).toHaveLength(20);
    expect(bodies.every(root => Number(root.label.slice("user:loading-".length)) < 20)).toBe(true);
    const next = grid.getHex({ col: 8, row: 8 })!;
    actors.setViewport({ minX: -next.center.x, maxX: -next.center.x + 1, minY: -next.center.y, maxY: -next.center.y + 1 });
    bodies = actors.container.children.filter(root => root.label.startsWith("user:"));
    expect(bodies).toHaveLength(20);
    expect(bodies.every(root => Number(root.label.slice("user:loading-".length)) >= 20)).toBe(true);
  });

  it("reuses viewport membership between exact visibility boundaries and refreshes it after source changes", () => {
    holdCharacters();
    const { actors, grid, snapshot } = fixture();
    const users = Array.from({ length: 30 }, (_, i) => player(i, { longitude: i < 20 ? 1 : 8, latitude: i < 20 ? 1 : 8 }));
    const tile = grid.getHex({ col: 1, row: 1 })!;
    const bounds = { minX: -tile.center.x + .371, maxX: -tile.center.x + 1.371, minY: -tile.center.y + .371, maxY: -tile.center.y + 1.371 };
    actors.setViewport(bounds); actors.sync(snapshot(users));
    const lookup = vi.spyOn(grid, "getHex");
    try {
      actors.setViewport({ ...bounds });
      actors.setViewport({ minX: bounds.minX + .00001, maxX: bounds.maxX + .00001, minY: bounds.minY + .00001, maxY: bounds.maxY + .00001 });
      expect(lookup).not.toHaveBeenCalled();
      const next = grid.getHex({ col: 8, row: 8 })!; lookup.mockClear();
      const reused = { minX: -next.center.x, maxX: -next.center.x + 1, minY: -next.center.y, maxY: -next.center.y + 1 };
      actors.setViewport(reused);
      expect(lookup).toHaveBeenCalled();
      lookup.mockClear(); Object.assign(reused, bounds); actors.setViewport(reused);
      expect(lookup).toHaveBeenCalled();
      lookup.mockClear(); actors.sync(snapshot(users.map(user => ({ ...user, latitude: 2 }))));
      expect(lookup).toHaveBeenCalled();
    } finally { lookup.mockRestore(); }
  });

  it("orders a batch of movement edges by their published clock instead of the source array", () => {
    holdCharacters();
    const { actors, snapshot } = fixture();
    const users = Array.from({ length: 30 }, (_, i) => player(i, { longitude: 4, latitude: 5 }));
    users.push(player(99, { userId: "viewer", longitude: 4, latitude: 5 }));
    const source = snapshot(users);
    source.motionSteps = new Map(users.slice(0, 21).map((user, i) => [user.userId, {
      from: { sector: 724, x: 4, y: 4 }, to: { sector: 724, x: 4, y: 5 },
      startedAt: 100 - i, direction: "north" as const, facing: 1 as const,
    }]));
    actors.sync(source);
    const ids = actors.container.children.filter(root => root.label.startsWith("user:")).map(root => root.label);
    expect(ids).toHaveLength(20);
    expect(ids).toContain("user:viewer");
    for (let i = 0; i < 19; i++) expect(ids).toContain(`user:loading-${i}`);
  });

  it("atomically replaces the placeholder at the retained foot, scale and current position", async () => {
    const pending = holdCharacters();
    const { game, actors, grid, snapshot, stage, depth } = fixture();
    actors.container.position.set(90, -70);
    actors.sync(snapshot([player(0)]));
    const root = actors.container.children[0]!;
    const scenery = new Container(); scenery.zIndex = root.zIndex - 5; stage.addChild(scenery); depth.attach(scenery);
    const fallback = root.children.find((child) => child.label === "avatar")!;
    const tile = grid.getHex({ col: 0, row: 0 })!;
    expect(fallback.scale.x).toBeCloseTo(tile.height * 1.8 * 0.7);
    expect(fallback.scale.y).toBeCloseTo(-tile.height * 1.8 * 0.7);
    expect(fallback.y - fallback.scale.x / 2).toBeCloseTo(tile.height * 0.1);
    const shadow = (root.children[0] as Graphics).getLocalBounds();
    expect(shadow.width).toBeCloseTo(tile.height * (0.35 * 2 * 0.7 + 0.015));
    expect(shadow.height).toBeCloseTo(tile.height * (0.12 * 2 * 0.7 + 0.015));
    expect(shadow.y + shadow.height / 2).toBeCloseTo(tile.height * (0.1 + 1.8 * 0.7 * 4 / 64));
    actors.sync(snapshot([player(0, { longitude: 1 })])); actors.animate(frame);
    const expectedBounds = fallback.getBounds();
    const expectedPosition = root.position.clone();
    pending.release(); await settle();
    expect(game.invalidate).toHaveBeenCalled();
    const body = root.children.at(-1)!.children.find((child) => child.label === "avatar")!;
    expect(actors.container.children[0]).toBe(root);
    expect(root.position).toMatchObject(expectedPosition);
    expect(fallback.destroyed).toBe(true);
    const bounds = body.getBounds();
    for (const key of ["minX", "maxX", "minY", "maxY"] as const) expect(bounds[key]).toBeCloseTo(expectedBounds[key]);
    expect(root.zIndex).toBeCloseTo(-(root.y + tile.height * (0.1 + 1.8 * 0.7 * 4 / 64) + actors.container.y));
    const point = body.getGlobalPosition();
    expect(actors.hit(point.x, point.y)).toMatchObject({ type: "avatar", userId: "loading-0" });
  });

  it("keeps the neutral body when both character atlases and the portrait fail", async () => {
    vi.spyOn(characters, "createLpcCharacter").mockRejectedValue(new Error("atlas failed"));
    vi.spyOn(Assets, "load").mockRejectedValue(new Error("portrait failed"));
    const { actors, grid, snapshot } = fixture();
    actors.sync(snapshot([player(0)])); actors.animate(frame); await settle();
    const root = actors.container.children[0]!;
    const tile = grid.getHex({ col: 0, row: 0 })!;
    const body = root.children.find((child) => child.label === "avatar");
    expect(body).toBeInstanceOf(Graphics);
    const point = bodyPoint(root, tile);
    expect(actors.hit(point.x, point.y)).toMatchObject({ type: "avatar", userId: "loading-0" });
    root.visible = false;
    expect(actors.hit(point.x, point.y)).toBeNull();
    root.visible = true; actors.container.visible = false;
    expect(actors.hit(point.x, point.y)).toBeNull();
  });

  it.each(["remove", "replace", "dispose"] as const)("ignores late artwork after actor %s", async (action) => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    cleanups.push(release);
    const loaded: Container[] = [];
    vi.spyOn(characters, "createLpcCharacter").mockImplementation(async (...args) => {
      const character = await originalCreate(...args);
      loaded.push(character.sprite);
      await gate;
      return character;
    });
    const { actors, overlay, snapshot, dispose } = fixture();
    actors.sync(snapshot([player(0)])); await settle();
    const root = actors.container.children[0]!;
    const fallback = root.children.find((child) => child.label === "avatar")!;
    expect(loaded).toHaveLength(1);
    if (action === "dispose") dispose();
    else actors.sync(snapshot(action === "remove" ? [] : [player(0, { allianceStatus: "ENEMY" })]));
    expect(root.destroyed).toBe(true);
    expect(fallback.destroyed).toBe(true);
    expect(loaded[0]?.destroyed).toBe(true);
    release(); await settle();
    expect(overlay.renderLayerChildren.every((control) => control.parent?.parent !== root)).toBe(true);
    if (action === "remove") expect(actors.container.children).toHaveLength(0);
    if (action === "replace") {
      expect(actors.container.children).toHaveLength(1);
      expect(actors.container.children[0]).not.toBe(root);
    }
  });

  it.each([false, true])("upgrades anonymous uniforms without selecting personal art (ANBU: %s)", async (anbu) => {
    const pending = holdCharacters();
    const { actors, snapshot } = fixture();
    const appearance = anonymousSpriteAppearance(anbu);
    actors.sync(snapshot([player(0, { isMasked: true, spriteAppearance: appearance, avatarLight: "personal-art.png" })]));
    const root = actors.container.children[0]!;
    const fallback = root.children.find((child) => child.label === "avatar") as Graphics;
    expect(fallback.context.fillStyle.color).toBe(0x89929e);
    expect(pending.create.mock.calls[0]?.[1]).toEqual(appearance);
    pending.release(); await settle();
    expect(fallback.destroyed).toBe(true);
    expect(Assets.load).not.toHaveBeenCalledWith(expect.objectContaining({ src: expect.stringContaining("personal-art") }));
  });

  it("prioritizes visible overlay controls over retained fallback bodies", async () => {
    vi.spyOn(characters, "createLpcCharacter").mockRejectedValue(new Error("atlas failed"));
    vi.spyOn(Assets, "load").mockImplementation(async (input) => {
      if ((input as { src: string }).src.includes("loading-portrait")) throw new Error("portrait failed");
      return Texture.WHITE;
    });
    const { actors, overlay, snapshot } = fixture();
    actors.sync(snapshot([player(0), player(1)])); await settle(); actors.hover("user:loading-0");
    const root = actors.container.children.find((child) => child.label === "user:loading-0")!;
    const nearer = actors.container.children.find((child) => child !== root)!;
    const body = nearer.children.find((child) => child.label === "avatar")!;
    const control = root.children.at(-1)!.children.find((child) => child.label === "info")!;
    expect(control.parentRenderLayer).toBe(overlay);
    const point = control.getGlobalPosition();
    const bodyPosition = body.getGlobalPosition();
    nearer.x += point.x - bodyPosition.x; nearer.y += point.y - bodyPosition.y;
    expect(body.getBounds().containsPoint(point.x, point.y)).toBe(true);
    expect(actors.hit(point.x, point.y)).toMatchObject({ type: "info", userId: "loading-0" });
    control.visible = false;
    expect(actors.hit(point.x, point.y)).toMatchObject({ type: "avatar", userId: "loading-1" });
  });

  it("prioritizes an encounter marker over a pending fallback body", async () => {
    holdCharacters();
    const { actors, grid, snapshot } = fixture();
    actors.sync(snapshot([player(0), player(0, { userId: "fighter", status: "BATTLE", battleId: "pending-battle" })]));
    await settle();
    const root = actors.container.children.find((child) => child.label === "user:loading-0")!;
    const marker = actors.container.children.find((child) => child.label === "battle:pending-battle")!;
    const tile = grid.getHex({ col: 0, row: 0 })!;
    const point = root.toGlobal({ x: tile.width / 2 - tile.height * 0.1, y: tile.height * 1.05 });
    expect(actors.hit(point.x, point.y)).toMatchObject({ type: "battleMarker", battleId: "pending-battle" });
    marker.visible = false;
    expect(actors.hit(point.x, point.y)).toMatchObject({ type: "avatar", userId: "loading-0" });
  });
});
