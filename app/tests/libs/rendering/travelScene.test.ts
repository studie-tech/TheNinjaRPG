import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { Assets, BufferImageSource, Container, Graphics, RenderLayer, Texture } from "pixi.js";
import { resolveSpriteAppearance } from "@/libs/lpc/appearance";
import * as maskedTextures from "@/libs/rendering/maskedTextures";
import * as terrain from "@/libs/rendering/primitives/terrain";
import * as runtime from "@/libs/rendering/runtime";
import { createTravelScene, type TravelSnapshot, type TravelWindowEntry } from "@/libs/rendering/scenes/travel";
import { createTravelActors } from "@/libs/rendering/scenes/travelActors";
import type { DecorationAsset } from "@/libs/sector-map/decorations";
import type { SectorUser } from "@/libs/sector-map/world-types";
import type { UserWithRelations } from "@/routers/profile";

const cleanups: (() => void)[] = [];
const frame = (now = 1000, reducedMotion = true): runtime.GameFrame => ({ now, delta: 1 / 60, reducedMotion });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const appearance = resolveSpriteAppearance({});
const player = (patch: Partial<SectorUser> = {}) => ({ userId: "self", longitude: 4, latitude: 4, status: "AWAKE", rank: "JONIN", allianceStatus: "NEUTRAL", experience: 0, spriteAppearance: appearance, curHealth: 1, maxHealth: 100, ...patch }) as SectorUser;
const viewer = { userId: "self", sector: 724, rank: "JONIN", userQuests: [], questData: [] } as unknown as UserWithRelations;
const windowEntry = (sector = 724, dy = 0): TravelWindowEntry => ({
  sector, dx: 0, dy, villageType: null, globalTileType: 1,
  map: { formatVersion: 1, sector, name: "Depth test", width: 12, height: 12, tiles: [], anchors: [], exits: [], metadata: { importedAt: "", source: "tiled" }, objects: [{ id: "tree", type: "decoration", assetKey: "tree", x: 4, y: 5 }] },
  structures: [{ id: "building", longitude: 8, latitude: 5, image: "depth-building.png", hasPage: 1 }] as TravelWindowEntry["structures"],
});
const snapshotFixture = (): TravelSnapshot => ({
  sector: 724, actorRevision: 0, viewer, users: [player()], minBracket: -1, showUsers: true, friendlyAttack: false, structureObjectiveIds: new Set(), window: [windowEntry()], nav: null, col: 4, row: 4, enabled: true, brightness: 1,
  decorations: new Map([["tree", { filepath: "depth-tree.png", renderScale: 3 } as DecorationAsset]]), terrains: new Map(), libraryVersion: "depth", locations: [], mapAssets: [],
});
/** Keep real scene/actor/artwork geometry and ownership; replace only GPU setup and image decoding. */
const gameFixture = () => {
  const controller = new AbortController();
  const owned = new Set<() => void>();
  const stage = new Container({ isRenderGroup: true });
  const canvas = document.createElement("canvas");
  let update = (_frame: runtime.GameFrame) => {};
  let disposed = false;
  const game = {
    stage, canvas, signal: controller.signal, renderer: { width: 1024, height: 600 },
    own: (cleanup: () => void) => { owned.add(cleanup); },
    disown: (cleanup: () => void) => { owned.delete(cleanup); },
    isDisposed: () => disposed,
    setResize: () => {}, setBackground: () => {}, listen: () => {},
    setUpdate: (next: typeof update) => { update = next; },
    dispose: () => { if (disposed) return; disposed = true; controller.abort(); for (const cleanup of owned) cleanup(); stage.destroy({ children: true, texture: false, textureSource: false }); },
  } as unknown as runtime.GameRenderer;
  cleanups.push(game.dispose);
  vi.spyOn(runtime, "createGameRenderer").mockResolvedValue(game);
  vi.spyOn(terrain, "createHexTerrain").mockImplementation(async (scope) => {
    const container = new Container();
    const dispose = () => { if (!container.destroyed) container.destroy({ children: true }); };
    scope.own(dispose);
    return { container, dispose, isAnimated: false, setTints: () => {} };
  });
  return { game, stage, advance: (next = frame()) => update(next) };
};
const sceneFixture = async () => {
  const state = snapshotFixture();
  const fixture = gameFixture();
  const scene = await createTravelScene({ mount: document.createElement("div"), signal: fixture.game.signal, lightLayout: false, getSnapshot: () => ({ ...state }), onError: (error) => { throw error; }, onReady: () => {}, onTap: () => {}, onHover: () => {}, onZoom: () => {}, initialZoom: 1 });
  fixture.advance(); await settle();
  const world = fixture.stage.children[0]!;
  const layers = world.children.filter((child) => child instanceof RenderLayer);
  return { ...fixture, scene, state, world, depth: layers[1]!, overlay: layers[2]! };
};
beforeEach(() => {
  const texture = new Texture({ source: new BufferImageSource({ resource: new Uint8Array(4), width: 4096, height: 4096 }) });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(Assets, "load").mockImplementation(async () => texture);
  vi.spyOn(Assets, "unload").mockResolvedValue(undefined);
  vi.spyOn(maskedTextures, "acquireMaskedTexture").mockImplementation(() => ({ resource: Promise.resolve(texture), release: () => {} }));
});
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.restoreAllMocks(); });

describe("travel scene ground depth", () => {
  it("interleaves the same moving actor with trees and buildings at their ground baselines", async () => {
    const { scene, state, depth, stage, advance } = await sceneFixture();
    const sector = scene.sectors.get(724)!;
    const actor = depth.renderLayerChildren.find((child) => child.label === "user:self")!;
    const tree = sector.art.entries.find((entry) => entry.description.id === "tree")!;
    const building = sector.art.entries.find((entry) => entry.description.id === "building")!;
    expect(actor.parentRenderLayer).toBe(tree.sprite.parentRenderLayer);
    expect(actor.parentRenderLayer).toBe(building.sprite.parentRenderLayer);
    expect(actor.parent).not.toBe(tree.sprite.parent);
    depth.sortRenderLayerChildren();
    for (const entry of [tree, building]) expect(depth.renderLayerChildren.indexOf(actor)).toBeGreaterThan(depth.renderLayerChildren.indexOf(entry.sprite));
    const before = actor.y;
    state.users = [player({ latitude: 6 })]; state.actorRevision++;
    stage.renderGroup!.structureDidChange = false;
    advance(frame(1100, false));
    const height = sector.grid.getHex({ col: 4, row: 4 })!.height;
    expect(actor.y).not.toBe(before);
    expect(actor.zIndex).toBeCloseTo(-(actor.y + height * 0.2 + sector.position.y));
    expect(stage.renderGroup!.structureDidChange).toBe(true);
    for (let tick = 0; tick < 8; tick++) advance(frame(1200 + tick));
    expect(depth.renderLayerChildren.find((child) => child.label === "user:self")).toBe(actor);
    depth.sortRenderLayerChildren();
    for (const entry of [tree, building]) expect(depth.renderLayerChildren.indexOf(actor)).toBeLessThan(depth.renderLayerChildren.indexOf(entry.sprite));
    const sorted = [...depth.renderLayerChildren]; depth.sortRenderLayerChildren();
    expect(depth.renderLayerChildren).toEqual(sorted);
  });

  it("refreshes retained scenery and actor depths on sector offsets and world rebasing, and detaches disposed sectors", async () => {
    const { scene, state, depth, advance } = await sceneFixture();
    state.window.push(windowEntry(725, 1)); await scene.updateWindow();
    const original = scene.sectors.get(724)!;
    const neighbor = scene.sectors.get(725)!;
    const art = original.art.entries[0]!;
    const neighborArt = neighbor.art.entries[0]!;
    expect(neighborArt.sprite.zIndex).toBeCloseTo(-(neighborArt.description.groundY + neighbor.position.y));
    state.sector = 725;
    state.window = [windowEntry(725), windowEntry(724, -1)];
    await scene.updateWindow(); advance(); await settle();
    expect(scene.sectors.get(724)).toBe(original);
    const actor = depth.renderLayerChildren.find((child) => child.label === "user:self")!;
    const tile = neighbor.grid.getHex({ col: 4, row: 4 })!;
    expect(actor.zIndex).toBeCloseTo(-(actor.y + tile.height * 0.2 + neighbor.position.y));
    // Moving the retained center far enough triggers the production rebase branch.
    neighbor.position = { x: 100_000, y: 100_000 };
    await scene.updateWindow(); advance();
    expect(neighbor.position).toEqual({ x: 0, y: 0 });
    expect(neighborArt.sprite.zIndex).toBeCloseTo(-neighborArt.description.groundY);
    expect(art.sprite.zIndex).toBeCloseTo(-(art.description.groundY + original.position.y));
    expect(actor.zIndex).toBeCloseTo(-(actor.y + tile.height * 0.2));
    neighbor.art.setViewport({ minX: 100_000, maxX: 100_001, minY: 100_000, maxY: 100_001 }, 0);
    expect(neighborArt.sprite.renderable).toBe(false);
    expect(neighborArt.sprite.parentRenderLayer).toBe(depth);
    state.window = [windowEntry(725)]; await scene.updateWindow();
    expect(art.sprite.destroyed).toBe(true);
    expect(depth.renderLayerChildren).not.toContain(art.sprite);
    scene.dispose();
    expect(actor.destroyed).toBe(true);
    expect(neighborArt.sprite.destroyed).toBe(true);
  });

  it("shrinks travel LPC art and shadows to 70% with a stable foot and shadow contact", async () => {
    const { scene, depth } = await sceneFixture();
    const actor = depth.renderLayerChildren.find((child) => child.label === "user:self")!;
    const tile = scene.sectors.get(724)!.grid.getHex({ col: 4, row: 4 })!;
    const shadow = actor.children[0] as Graphics;
    const character = actor.children[1]!.children.find((child) => child.label === "avatar")!;
    expect(character.scale.x).toBeCloseTo(tile.height * 1.8 * 0.7);
    expect(character.y - character.scale.x / 2).toBeCloseTo(tile.height * 0.1);
    const bounds = shadow.getLocalBounds();
    expect(bounds.width).toBeCloseTo(tile.height * 0.35 * 2 * 0.7);
    expect(bounds.height).toBeCloseTo(tile.height * 0.12 * 2 * 0.7);
    expect(bounds.y + bounds.height / 2).toBeCloseTo(tile.height * 0.2);
    expect(actor.zIndex).toBeCloseTo(-(actor.y + bounds.y + bounds.height / 2));
  });

  it("keeps controls and encounter/count markers above scenery and prioritizes visible controls over nearer bodies", async () => {
    const { scene, game, world, depth, overlay } = await sceneFixture();
    expect(world.getChildIndex(depth)).toBeLessThan(world.getChildIndex(overlay));
    const grid = scene.sectors.get(724)!.grid;
    const actors = createTravelActors(game, { depth, overlay }); world.addChild(actors.container);
    const users = [player({ userId: "other" }), player({ userId: "nearer", longitude: 6, latitude: 3 }), player({ userId: "npc", isNpc: true, npcPlacementId: "npc", npcInteractionType: "FRIENDLY" }), player({ userId: "fighter", longitude: 10, latitude: 10, status: "BATTLE", battleId: "battle" })];
    const questViewer = { ...viewer, userQuests: [{ quest: { id: "quest", content: { objectives: [{ id: "goal", task: "move_to_location", sector: 724, longitude: 7, latitude: 7, image: "depth-quest.png" }] } } }], questData: [{ id: "quest", goals: [{ id: "goal", done: false }] }] } as unknown as UserWithRelations;
    const snapshot = { ...snapshotFixture(), grid, users, viewer: questViewer };
    actors.sync(snapshot); actors.animate(frame()); await settle();
    const other = actors.container.children.find((child) => child.label === "user:other")!;
    const nearer = actors.container.children.find((child) => child.label === "user:nearer")!;
    const control = other.children.at(-1)!.children.find((child) => child.label === "info")!;
    actors.hover("user:other");
    expect(control.visible).toBe(true);
    expect(control.parentRenderLayer).toBe(overlay);
    for (const kind of ["attack", "heal", "info"])
      expect(other.children.at(-1)!.children.find((child) => child.label === kind)!.parentRenderLayer).toBe(overlay);
    expect(control.parent?.parent).toBe(other);
    expect(actors.container.children.find((child) => child.label === "battle:battle")!.parentRenderLayer).toBe(overlay);
    expect(actors.container.children.find((child) => child.label === "quest:goal")!.parentRenderLayer).toBe(overlay);
    const talk = actors.container.children.find((child) => child.label === "npc:npc")!.children.at(-1)!.children.find((child) => child.label === "talk")!;
    expect(talk.parentRenderLayer).toBe(overlay);
    const point = control.getGlobalPosition();
    point.y += control.getBounds().height * 0.4;
    // A foreground actor's upper body overlaps the lower edge of the profile control.
    const body = nearer.children.at(-1)!.children.find((child) => child.label === "avatar")!;
    const bodyPoint = body.getGlobalPosition();
    nearer.x += (point.x - bodyPoint.x) / world.scale.x;
    nearer.y = other.y - grid.getHex({ col: 4, row: 4 })!.height * 0.05;
    expect(actors.container.getChildIndex(nearer)).toBeGreaterThan(actors.container.getChildIndex(other));
    expect(body.getBounds().containsPoint(point.x, point.y)).toBe(true);
    expect(actors.hit(point.x, point.y)).toMatchObject({ userId: "other", type: "info" });
    other.visible = false;
    expect(actors.hit(point.x, point.y)?.userId).not.toBe("other");
    other.visible = true;
    actors.hover(null);
    expect(control.visible).toBe(false);
    snapshot.users = [player({ userId: "one" }), player({ userId: "two" }), player({ userId: "three" })];
    actors.sync(snapshot); actors.animate(frame()); await settle();
    const counter = actors.container.children.find((child) => child.label.startsWith("count:"))!;
    expect(counter.parentRenderLayer).toBe(overlay);
    const physical = actors.container.children.filter((child) => child.label.startsWith("user:"));
    expect(physical.every((child) => child.parentRenderLayer === depth)).toBe(true);
    expect(physical.every((child) => Math.abs(child.zIndex + child.y + grid.getHex({ col: 4, row: 4 })!.height * 0.2) < 0.0001)).toBe(true);
    actors.setViewport({ minX: -100_000, maxX: -99_999, minY: -100_000, maxY: -99_999 });
    expect(counter.destroyed).toBe(true);
    expect(overlay.renderLayerChildren).not.toContain(counter);
    expect(physical.every((child) => child.destroyed && !depth.renderLayerChildren.includes(child))).toBe(true);
  });
});
