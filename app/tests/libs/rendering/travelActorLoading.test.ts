import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { Assets, BufferImageSource, Container, Graphics, RenderLayer, Texture } from "pixi.js";
import { getBattleGrid } from "@/libs/combat/util";
import { anonymousSpriteAppearance, resolveSpriteAppearance } from "@/libs/lpc/appearance";
import * as maskedTextures from "@/libs/rendering/maskedTextures";
import * as characters from "@/libs/rendering/primitives/character";
import type { GameRenderer } from "@/libs/rendering/runtime";
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
const fixture = () => {
  const controller = new AbortController();
  const owned = new Set<() => void>();
  const stage = new Container({ isRenderGroup: true });
  const depth = new RenderLayer(), overlay = new RenderLayer();
  const game = {
    signal: controller.signal, isDisposed: () => controller.signal.aborted,
    own: (cleanup: () => void) => owned.add(cleanup), disown: (cleanup: () => void) => owned.delete(cleanup),
  } as unknown as GameRenderer;
  const actors = createTravelActors(game, { depth, overlay });
  stage.addChild(actors.container, depth, overlay);
  const grid = getBattleGrid(40, { width: 12, height: 12, biome: "ground" } as never, { x: 0, y: 0 });
  const snapshot = (users: SectorUser[]): TravelActorsSnapshot => ({ grid, users, viewer, sector: 724, minBracket: -1, showUsers: true, friendlyAttack: false, structureObjectiveIds: new Set() });
  const dispose = () => { if (controller.signal.aborted) return; controller.abort(); for (const cleanup of owned) cleanup(); stage.destroy({ children: true, texture: false, textureSource: false }); };
  cleanups.push(dispose);
  return { actors, grid, stage, depth, overlay, snapshot, dispose };
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

  it("keeps 100 pending actors visible and pickable at their own body positions", async () => {
    const pending = holdCharacters();
    const { actors, grid, depth, snapshot } = fixture();
    actors.sync(snapshot(Array.from({ length: 100 }, (_, index) => player(index))));
    expect(pending.create).toHaveBeenCalledTimes(100);
    expect(actors.container.children).toHaveLength(100);
    for (const root of actors.container.children) {
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

  it("atomically replaces the placeholder at the retained foot, scale and current position", async () => {
    const pending = holdCharacters();
    const { actors, grid, snapshot } = fixture();
    actors.container.position.set(90, -70);
    actors.sync(snapshot([player(0)]));
    const root = actors.container.children[0]!;
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
