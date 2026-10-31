import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { Assets, BufferImageSource, Container, Graphics, RenderLayer, Texture } from "pixi.js";
import { SECTOR_WALK_STEP_MS } from "@/drizzle/constants";
import { resolveSpriteAppearance } from "@/libs/lpc/appearance";
import * as maskedTextures from "@/libs/rendering/maskedTextures";
import * as terrainData from "@/libs/rendering/terrainData";
import * as navigation from "@/libs/sector-map/navigation";
import { BUILTIN_TERRAINS_BY_KEY } from "@/libs/sector-map/terrains";
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
  decorations: new Map([["tree", { key: "tree", filepath: "depth-tree.png", renderScale: 3 } as DecorationAsset]]), terrains: new Map(), libraryVersion: "depth", locations: [], mapAssets: [],
});
/** Keep real scene/actor/artwork geometry and ownership; replace only GPU setup and image decoding. */
const gameFixture = () => {
  const controller = new AbortController();
  const owned = new Set<() => void>();
  const stage = new Container({ isRenderGroup: true });
  const canvas = document.createElement("canvas");
  canvas.getBoundingClientRect = () => new DOMRect(0, 0, 1024, 600);
  const listeners = new window.AbortController();
  let update = (_frame: runtime.GameFrame) => {};
  let disposed = false;
  const game = {
    stage, canvas, signal: controller.signal, renderer: { width: 1024, height: 600 },
    own: (cleanup: () => void) => { owned.add(cleanup); },
    disown: (cleanup: () => void) => { owned.delete(cleanup); },
    isDisposed: () => disposed,
    setResize: () => {}, setBackground: () => {}, invalidate: () => {},
    listen: (type: string, callback: EventListener) => canvas.addEventListener(type, callback, { signal: listeners.signal }),
    setUpdate: (next: typeof update) => { update = next; },
    dispose: () => { if (disposed) return; disposed = true; controller.abort(); listeners.abort(); for (const cleanup of owned) cleanup(); stage.destroy({ children: true, texture: false, textureSource: false }); },
  } as unknown as runtime.GameRenderer;
  cleanups.push(game.dispose);
  vi.spyOn(runtime, "createGameRenderer").mockResolvedValue(game);
  vi.spyOn(terrain, "createHexTerrain").mockImplementation(async (scope) => {
    const container = new Container();
    const dispose = () => { if (!container.destroyed) container.destroy({ children: true }); };
    scope.own(dispose);
    return { container, dispose, isAnimated: false, setLighting: () => {}, setTints: () => {} };
  });
  const event = (type: string, x: number, y: number) => {
    const pointer = new window.MouseEvent(type, { button: 0, clientX: x, clientY: y });
    Object.defineProperty(pointer, "pointerId", { value: 1 }); canvas.dispatchEvent(pointer);
  };
  return { game, stage, event, advance: (next = frame()) => update(next) };
};
const sceneFixture = async (state = snapshotFixture(), initialZoom = 1) => {
  const fixture = gameFixture();
  const onTap = vi.fn();
  const scene = await createTravelScene({ mount: document.createElement("div"), signal: fixture.game.signal, lightLayout: false, getSnapshot: () => ({ ...state }), onError: (error) => { throw error; }, onReady: () => {}, onTap, onHover: () => {}, onZoom: () => {}, initialZoom });
  fixture.advance(); await settle();
  const world = fixture.stage.children[0]!;
  const collect = (node: Container): RenderLayer[] => node.children.flatMap((child) => child instanceof RenderLayer ? [child] : collect(child));
  const layers = collect(world);
  return { ...fixture, scene, state, world, onTap, depth: layers[2]!, overlay: layers[3]! };
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
  it("grounds border walls in neighboring water and refreshes their retained terrain after a layout change", async () => {
    const state=snapshotFixture(),water=state.window[0]!,village=windowEntry(725,1);
    const ocean=(entry:TravelWindowEntry)=>{
      entry.map={...entry.map,objects:[],tiles:Array.from({length:144},(_,i)=>({x:i%12,y:Math.floor(i/12),terrain:"ocean",battleBiome:"ocean",zone:"water",walkCost:1,blocked:false}))};
    };
    ocean(water);ocean(village);
    water.structures=[];village.villageType="VILLAGE";
    village.structures=[{...village.structures[0]!,longitude:6,latitude:0}];
    state.window=[water,village];state.terrains=new Map([["ocean",BUILTIN_TERRAINS_BY_KEY.get("ocean")!]]);
    const {scene}=await sceneFixture(state);
    const bank=()=>scene.sectors.get(724)!.grid.getHex({col:6,row:11})!;
    expect(bank().spec?.isWater).toBe(false);
    expect(bank().spec?.depression).toBe(0);
    await scene.updateWindow();
    const previous=scene.sectors.get(724)!;
    village.structures=[{...village.structures[0]!,longitude:2}];
    await scene.updateWindow();
    expect(scene.sectors.get(724)).not.toBe(previous);
    expect(bank().spec?.isWater).toBe(true);
    expect(scene.sectors.get(724)!.grid.getHex({col:2,row:11})!.spec?.isWater).toBe(false);
    const retained=scene.sectors.get(724)!;
    state.sector=725;state.window=[{...village,dy:0},{...water,dy:-1}];
    await scene.updateWindow();
    expect(scene.sectors.get(724)).toBe(retained);
    village.structures=[];state.window=[{...village,dy:0},{...water,dy:-1}];
    await scene.updateWindow();
    expect(scene.sectors.get(724)!.grid.getHex({col:2,row:11})!.spec?.isWater).toBe(true);
  });

  it.each([false, true])("retains shoreline topology across account refreshes (shared navigation: %s)", async (shared) => {
    const state = snapshotFixture(), entry = state.window[0]!;
    entry.globalTileType = 0;
    state.terrains = new Map([["ocean", BUILTIN_TERRAINS_BY_KEY.get("ocean")!]]);
    if (shared) state.nav = navigation.buildWindowNav(state.window, 10);
    const nav = vi.spyOn(navigation, "buildWindowNav"), shelf = vi.spyOn(terrainData, "createWaterShelf");
    const { scene } = await sceneFixture(state);
    const builds = [nav.mock.calls.length, shelf.mock.calls.length];
    expect(builds[0]).toBe(shared ? 0 : 1); expect(builds[1]).toBeGreaterThan(0);
    state.viewer = { ...state.viewer, latitude: 5 } as UserWithRelations;
    state.locations = [...state.locations];
    await scene.updateWindow(); await scene.updateWindow();
    expect([nav.mock.calls.length, shelf.mock.calls.length]).toEqual(builds);
    entry.map = { ...entry.map, tiles: [{ x: 4, y: 4, terrain: "grass", walkCost: 1, battleBiome: "ground", blocked: false, zone: "safezone" }] };
    if (shared) state.nav = navigation.buildWindowNav(state.window, 10);
    await scene.updateWindow();
    expect(nav.mock.calls.length).toBe(builds[0]! + 1); expect(shelf.mock.calls.length).toBe(builds[1]! + 1);
  });
  it.each(["village", "structure", "landmark"] as const)("draws a same-tile actor behind a %s building and a front-adjacent actor in front", async (kind) => {
    const state = snapshotFixture();
    state.users = [player({ longitude: 8, latitude: 5 })];
    if (kind !== "village") {
      state.window[0]!.structures = [];
      state.window[0]!.map.objects.push({ id: "building", type: kind, x: 8, y: 5, assetKey: "depth-building.png" });
    }
    const { scene, depth, advance } = await sceneFixture(state);
    const sector = scene.sectors.get(724)!;
    const actor = depth.renderLayerChildren.find((child) => child.label === "user:self")!;
    const building = sector.art.entries.find((entry) => entry.description.id === "building")!;
    const tile = sector.grid.getHex({ col: 8, row: 5 })!;
    expect(actor.y).toBeCloseTo(-tile.center.y);
    depth.sortRenderLayerChildren();
    expect(depth.renderLayerChildren.indexOf(actor)).toBeLessThan(depth.renderLayerChildren.indexOf(building.sprite));
    const placement = { x: building.sprite.x, y: building.sprite.y, width: building.sprite.width, height: building.sprite.height };
    state.users = [player({ longitude: 8, latitude: 4 })]; state.actorRevision++;
    advance();
    expect(actor.y).toBeCloseTo(-sector.grid.getHex({ col: 8, row: 4 })!.center.y);
    depth.sortRenderLayerChildren();
    expect(depth.renderLayerChildren.indexOf(actor)).toBeGreaterThan(depth.renderLayerChildren.indexOf(building.sprite));
    expect(building.sprite).toMatchObject(placement);
  });

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
    expect(actor.zIndex).toBeCloseTo(-(actor.y + height * (0.1 + 1.8 * 0.7 * 4 / 64) + sector.position.y));
    expect(stage.renderGroup!.structureDidChange).toBe(true);
    for (let tick = 0; tick < 8; tick++) advance(frame(1200 + tick));
    expect(depth.renderLayerChildren.find((child) => child.label === "user:self")).toBe(actor);
    depth.sortRenderLayerChildren();
    for (const entry of [tree, building]) expect(depth.renderLayerChildren.indexOf(actor)).toBeLessThan(depth.renderLayerChildren.indexOf(entry.sprite));
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
    expect(actor.zIndex).toBeCloseTo(-(actor.y + tile.height * (0.1 + 1.8 * 0.7 * 4 / 64) + neighbor.position.y));
    // Moving the retained center far enough triggers the production rebase branch.
    neighbor.position = { x: 100_000, y: 100_000 };
    await scene.updateWindow(); advance();
    expect(neighbor.position).toEqual({ x: 0, y: 0 });
    expect(neighborArt.sprite.zIndex).toBeCloseTo(-neighborArt.description.groundY);
    expect(art.sprite.zIndex).toBeCloseTo(-(art.description.groundY + original.position.y));
    expect(actor.zIndex).toBeCloseTo(-(actor.y + tile.height * (0.1 + 1.8 * 0.7 * 4 / 64)));
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

  it("keeps compact travel LPC art and shadows at a shared foot contact", async () => {
    const { scene, depth } = await sceneFixture();
    const actor = depth.renderLayerChildren.find((child) => child.label === "user:self")!;
    const tile = scene.sectors.get(724)!.grid.getHex({ col: 4, row: 4 })!;
    const shadow = actor.children[0] as Graphics;
    const character = actor.children[1]!.children.find((child) => child.label === "avatar")!;
    expect(character.scale.x).toBeCloseTo(tile.height * 1.8 * 0.7);
    expect(character.y - character.scale.x / 2).toBeCloseTo(tile.height * 0.1);
    const bounds = shadow.getLocalBounds();
    expect(bounds.width).toBeCloseTo(tile.height * (0.35 * 2 * 0.7 + 0.015));
    expect(bounds.height).toBeCloseTo(tile.height * (0.12 * 2 * 0.7 + 0.015));
    expect(bounds.y + bounds.height / 2).toBeCloseTo(tile.height * (0.1 + 1.8 * 0.7 * 4 / 64));
    expect(actor.zIndex).toBeCloseTo(-(actor.y + bounds.y + bounds.height / 2));
  });

  it("picks overlapping NPC controls in overlay paint order while their bodies orbit", async () => {
    const { scene, game, world, depth, overlay } = await sceneFixture();
    const grid = scene.sectors.get(724)!.grid;
    const actors = createTravelActors(game, { depth, overlay }); world.addChild(actors.container);
    const users = ["first", "second"].map((userId) => player({ userId, isNpc: true, npcPlacementId: userId, npcInteractionType: "FRIENDLY" }));
    actors.sync({ ...snapshotFixture(), grid, users }); await settle();
    const roots = users.map((user) => actors.container.children.find((child) => child.label === `npc:${user.npcPlacementId}`)!);
    const controls = roots.map((root) => root.children.at(-1)!.children.find((child) => child.label === "talk")!);
    const canvas = game.canvas;
    let initialBodyOrder: Container[] = [];
    for (const now of [1000, 3000]) {
      actors.animate(frame(now, false));
      if (now === 1000) initialBodyOrder = [...actors.container.children];
      else expect(actors.container.children).toEqual([...initialBodyOrder].reverse());
      expect(game.canvas).toBe(canvas);
      for (let index = 0; index < roots.length; index++) {
        expect(actors.container.children).toContain(roots[index]!);
        expect(controls[index]!.parent?.parent).toBe(roots[index]!);
        expect(controls[index]!.parentRenderLayer).toBe(overlay);
        expect(controls[index]!.visible).toBe(true);
      }
      const bounds = controls.map((control) => control.getBounds());
      const minX = Math.max(...bounds.map((bound) => bound.minX)), maxX = Math.min(...bounds.map((bound) => bound.maxX));
      const minY = Math.max(...bounds.map((bound) => bound.minY)), maxY = Math.min(...bounds.map((bound) => bound.maxY));
      expect(maxX).toBeGreaterThan(minX); expect(maxY).toBeGreaterThan(minY);
      const x = (minX + maxX) / 2, y = (minY + maxY) / 2;
      const top = overlay.renderLayerChildren.filter((child) => controls.includes(child)).at(-1)!;
      const index = controls.indexOf(top);
      expect(actors.hit(x, y)).toMatchObject({ type: "talk", npcPlacementId: users[index]!.npcPlacementId });
      roots[index]!.visible = false;
      expect(actors.hit(x, y)).toMatchObject({ type: "talk", npcPlacementId: users[1 - index]!.npcPlacementId });
      roots[index]!.visible = true;
      top.visible = false;
      expect(actors.hit(x, y)).toMatchObject({ type: "talk", npcPlacementId: users[1 - index]!.npcPlacementId });
      top.visible = true;
    }
  });

  it.each(["battle", "quest"] as const)("picks a visible %s marker above an overlapping NPC body", async (kind) => {
    const { scene, game, world, depth, overlay } = await sceneFixture();
    const grid = scene.sectors.get(724)!.grid;
    const actors = createTravelActors(game, { depth, overlay }); world.addChild(actors.container);
    const npc = player({ userId: "npc", isNpc: true, npcPlacementId: "npc", npcInteractionType: "FRIENDLY" });
    const questViewer = { ...viewer, userQuests: [{ quest: { id: "quest", content: { objectives: [{ id: "goal", task: "move_to_location", sector: 724, longitude: 4, latitude: 4, image: "depth-quest.png" }] } } }], questData: [{ id: "quest", goals: [{ id: "goal", done: false }] }] } as unknown as UserWithRelations;
    actors.sync({ ...snapshotFixture(), grid, viewer: kind === "quest" ? questViewer : viewer, users: kind === "battle" ? [npc, player({ userId: "fighter", status: "BATTLE", battleId: "battle" })] : [npc] });
    actors.animate(frame()); await settle();
    const root = actors.container.children.find((child) => child.label === (kind === "battle" ? "battle:battle" : "quest:goal"))!;
    const npcRoot = actors.container.children.find((child) => child.label === "npc:npc")!;
    const body = npcRoot.children.at(-1)!.children.find((child) => child.label === "avatar")!;
    const talk = npcRoot.children.at(-1)!.children.find((child) => child.label === "talk")!;
    const tile = grid.getHex({ col: 4, row: 4 })!;
    const point = root.toGlobal({ x: tile.width * 0.5 - tile.height * 0.1, y: tile.height * 1.05 });
    expect(actors.container.getChildIndex(root)).toBeLessThan(actors.container.getChildIndex(npcRoot));
    expect(overlay.renderLayerChildren.indexOf(root)).toBeLessThan(overlay.renderLayerChildren.indexOf(talk));
    expect(root.children.at(-1)!.children.some((child) => child.getBounds().containsPoint(point.x, point.y))).toBe(true);
    expect(body.getBounds().containsPoint(point.x, point.y)).toBe(true);
    expect(talk.getBounds().containsPoint(point.x, point.y)).toBe(false);
    expect(actors.hit(point.x, point.y)).toMatchObject({ key: root.label, type: `${kind}Marker`, longitude: 4, latitude: 4 });
    root.visible = false;
    expect(actors.hit(point.x, point.y)).toMatchObject({ type: "avatar", npcPlacementId: "npc" });
  });

  it("keeps controls and encounter/count markers above scenery and prioritizes visible controls over nearer bodies", async () => {
    const { scene, game, world, depth, overlay } = await sceneFixture();
    expect(world.getChildIndex(depth.parent!)).toBeLessThan(world.getChildIndex(overlay));
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
    expect(physical.every((child) => Math.abs(child.zIndex + child.y + grid.getHex({ col: 4, row: 4 })!.height * (0.1 + 1.8 * 0.7 * 4 / 64)) < 0.0001)).toBe(true);
    actors.setViewport({ minX: -100_000, maxX: -99_999, minY: -100_000, maxY: -99_999 });
    expect(counter.destroyed).toBe(true);
    expect(overlay.renderLayerChildren).not.toContain(counter);
    expect(physical.every((child) => child.destroyed && !depth.renderLayerChildren.includes(child))).toBe(true);
  });
});


describe("travel camera follow and inspection", () => {
  it("damps tracking without replaying the final edge after its motion clock is removed", async () => {
    const { scene, state, world, depth, advance } = await sceneFixture();
    const actor = depth.renderLayerChildren.find((child) => child.label === "user:self")!;
    const start = { x: world.x, y: world.y };
    state.users = [player({ latitude: 6 })]; state.row = 6; state.actorRevision++;
    state.motionSteps = new Map([["self", { from: { sector: 724, x: 4, y: 4 }, to: { sector: 724, x: 4, y: 6 }, startedAt: 1000, direction: "south", facing: 1 }]]);
    advance(frame(1000 + SECTOR_WALK_STEP_MS, false));
    const destination = scene.sectors.get(724)!.grid.getHex({ col: 4, row: 6 })!;
    const finalY = Math.round(300 + (-destination.center.y + destination.height / 2));
    expect(actor.y).toBeCloseTo(-destination.center.y);
    expect(Math.abs(world.y - start.y)).toBeLessThan(Math.abs(finalY - start.y));
    expect(world.y).not.toBe(start.y);
    state.motionSteps = undefined;
    let previous = Math.abs(finalY - world.y);
    for (let tick = 0; tick < 120; tick++) {
      advance(frame(1100 + tick * 1000 / 60, false));
      expect(actor.y).toBeCloseTo(-destination.center.y);
      const distance = Math.abs(finalY - world.y);
      expect(distance).toBeLessThanOrEqual(previous);
      previous = distance;
    }
    expect(world.y).toBe(finalY);
  });

  it("pans without walking, retains inspection across refreshes, and resumes follow on demand", async () => {
    const { scene, state, world, event, advance, onTap } = await sceneFixture(undefined, 2);
    const initial = { x: world.x, y: world.y };
    event("pointerdown", 512, 300); event("pointermove", 542, 320);
    advance(frame(1016, false));
    expect(world.x).toBeCloseTo(initial.x + 30); expect(world.y).toBeCloseTo(initial.y + 20);
    expect(scene.sectors.get(724)!.art.container.visible).toBe(true);
    event("pointerup", 542, 320);
    expect(onTap).not.toHaveBeenCalled();
    const panned = { x: world.x, y: world.y };
    state.users = [player({ latitude: 5 })]; state.row = 5; state.actorRevision++;
    for (let tick = 0; tick < 30; tick++) advance(frame(1100 + tick * 16, false));
    expect(world.position).toMatchObject(panned);
    scene.recenter(); advance(frame(1600, false));
    const destination = scene.sectors.get(724)!.grid.getHex({ col: 4, row: 5 })!;
    const targetY = 300 + world.scale.x * (-destination.center.y + destination.height / 2);
    expect(Math.abs(targetY - world.y)).toBeLessThan(Math.abs(targetY - panned.y));
    expect(world.y).not.toBe(Math.round(targetY));
    advance(frame(1700, true));
    expect(world.y).toBe(Math.round(targetY));
    event("pointerdown", 512, 300); event("pointerup", 514, 302);
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it("has the same follow response at 30 and 60 frames per second", async () => {
    const positions: number[] = [];
    for (const fps of [30, 60]) {
      const { state, world, advance } = await sceneFixture();
      state.row = 8;
      for (let tick = 1; tick <= fps / 2; tick++) advance({ now: 1000 + tick * 1000 / fps, delta: 1 / fps, reducedMotion: false });
      positions.push(world.y);
    }
    expect(positions[0]).toBe(positions[1]);
  });

  it("bounds manual panning to the rendered window and ignores dragging while interaction is disabled", async () => {
    const { game, state, world, event, advance } = await sceneFixture();
    event("pointerdown", 512, 300); event("pointermove", 100_512, 100_300); event("pointerup", 100_512, 100_300);
    advance(frame(1016, false));
    expect(world.x).toBe(0);
    const panned = { x: world.x, y: world.y };
    state.enabled = false;
    event("pointerdown", 512, 300); event("pointermove", -10_000, -10_000); event("pointerup", -10_000, -10_000);
    advance(frame(1032, false));
    expect(world.position).toMatchObject(panned);
    expect(game.canvas.style.cursor).toBe("default");
  });
});
