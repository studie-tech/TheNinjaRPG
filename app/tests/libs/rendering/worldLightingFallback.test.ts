import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as pixi from "pixi.js";
import { BufferImageSource, Container, Mesh, RenderTexture, Sprite, Texture, UniformGroup } from "pixi.js";
import { resolveSpriteAppearance } from "@/libs/lpc/appearance";
import { WORLD_DAY_BRIGHTNESS, WORLD_DAY_SECONDS, WORLD_NIGHT_BRIGHTNESS } from "@/drizzle/constants";
import type { ReturnedBattle } from "@/libs/combat/types";
import * as sceneAssets from "@/libs/rendering/assets";
import * as maskedTextures from "@/libs/rendering/maskedTextures";
import * as runtime from "@/libs/rendering/runtime";
import { createCombatScene, type CombatSceneSnapshot } from "@/libs/rendering/scenes/combat";
import * as combatTerrain from "@/libs/rendering/scenes/combatTerrain";
import { createSectorPreview } from "@/libs/rendering/scenes/sectorPreview";
import { createTravelScene, type TravelSnapshot } from "@/libs/rendering/scenes/travel";
import * as sectorSprites from "@/libs/rendering/sectorSprites";
import type { WorldSpriteDescription } from "@/libs/rendering/sectorSprites";
import * as worldMaterials from "@/libs/rendering/worldMaterials";
import * as worldOcclusion from "@/libs/rendering/worldOcclusion";
import * as worldShadows from "@/libs/rendering/worldShadows";
import { buildWindowNav } from "@/libs/sector-map/navigation";
import { BUILTIN_TERRAINS_BY_KEY } from "@/libs/sector-map/terrains";
import type { NormalizedSectorMap } from "@/libs/sector-map/types";
import type { SectorUser } from "@/libs/sector-map/world-types";
import type { UserWithRelations } from "@/routers/profile";
import { makeBattleUser, makeCompleteBattle } from "../combat/helpers/battleScenario";

const cleanups: (() => void)[] = [];
const map: NormalizedSectorMap = {
  formatVersion: 1, sector: 90001, name: "Lighting fixture", width: 3, height: 3,
  tiles: Array.from({ length: 9 }, (_, i) => ({
    x: i % 3, y: Math.floor(i / 3), terrain: "ground", walkCost: 1,
    blocked: false, zone: "wilderness", battleBiome: "ground", decoration: false,
  })),
  objects: [], anchors: [], exits: [], metadata: { importedAt: "", source: "tiled" },
};
const scenery: WorldSpriteDescription[] = [
  { id: "fixture-body", kind: "decoration", image: "lighting-fixture.png", size: 30,
    x: 40, y: 40, groundY: 40, anchorY: 1, shadow: 0.18, light: 0.6, shadowCaster: "column" },
  { id: "fixture-pin", kind: "marker", image: "lighting-pin.png", mask: "lighting-pin-mask.png",
    size: 10, x: 40, y: 50, groundY: 40, tint: 0xffcc77 },
];
const flushArtwork = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.spyOn(pixi, "getMaxFragmentPrecision").mockReturnValue("mediump");
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  const texture = new Texture({ source: new BufferImageSource({
    resource: new Uint8Array(2048 * 2048 * 4), width: 2048, height: 2048,
  }) });
  cleanups.push(() => texture.destroy(true));
  vi.spyOn(sceneAssets, "createSceneAssets").mockImplementation(() => ({
    texture: async () => texture, dispose() {},
  }));
  vi.spyOn(maskedTextures, "acquireMaskedTexture").mockImplementation(() => ({
    resource: Promise.resolve(texture), release() {},
  }));
  vi.spyOn(sectorSprites, "sectorSpriteDescriptions").mockImplementation(() => scenery);
  vi.spyOn(worldShadows, "createWorldShadows");
  vi.spyOn(worldMaterials, "acquireWorldMaterial");
  vi.spyOn(worldOcclusion, "createWorldOcclusion");
  vi.spyOn(RenderTexture, "create");
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.restoreAllMocks();
});

/** The real scene, primitives and RenderLayers run with only canvas scheduling and GPU submission replaced. */
const rendererFixture = () => {
  const stage = new Container(), canvas = document.createElement("canvas");
  const owned = new Set<() => void>();
  let update: (frame: runtime.GameFrame) => void = () => {};
  let disposed = false;
  const game = {
    stage, canvas, signal: new AbortController().signal,
    animation: new UniformGroup({ uTime: { value: 0, type: "f32" } }),
    renderer: { width: 800, height: 600, render: vi.fn() },
    assets: sceneAssets.createSceneAssets(),
    own: (cleanup: () => void) => owned.add(cleanup),
    disown: (cleanup: () => void) => owned.delete(cleanup),
    isDisposed: () => disposed, invalidate() {}, setAnimating() {}, setBackground() {}, listen() {},
    setResize: (callback: (width: number, height: number) => void) => callback(800, 600),
    setUpdate: (callback: typeof update) => { update = callback; },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const cleanup of [...owned]) cleanup();
      stage.destroy({ children: true, texture: false, textureSource: false });
    },
  } as unknown as runtime.GameRenderer;
  cleanups.push(game.dispose);
  vi.spyOn(runtime, "createGameRenderer").mockResolvedValue(game);
  return { game, tick: (frame: runtime.GameFrame = { now: 0, delta: 0, reducedMotion: true }) => update(frame) };
};
const expectAmbientOnly = () => {
  expect(worldShadows.createWorldShadows).not.toHaveBeenCalled();
  expect(worldMaterials.acquireWorldMaterial).not.toHaveBeenCalled();
  expect(worldOcclusion.createWorldOcclusion).not.toHaveBeenCalled();
  expect(RenderTexture.create).not.toHaveBeenCalled();
};
const terrainAmbient = (root: Container): number[] => {
  for (const child of root.children) {
    if (child instanceof Mesh && child.shader?.resources.ambient)
      return Array.from(child.shader.resources.ambient.uniforms.uAmbient as Float32Array);
    const found = terrainAmbient(child);
    if (found.length) return found;
  }
  return [];
};
/** Pixi's traversal determines whether terrain would paint over a contact or light pool. */
const drawOrder = (stage: Container) => {
  const drawn: Container[] = [];
  const pipe = { addRenderable: (view: Container) => drawn.push(view) };
  const renderer = { renderPipes: {
    sprite: pipe, mesh: pipe, graphics: pipe, text: pipe,
    blendMode: { pushBlendMode() {}, popBlendMode() {} },
  } };
  stage.collectRenderables(
    {} as Parameters<Container["collectRenderables"]>[0],
    renderer as unknown as Parameters<Container["collectRenderables"]>[1],
    null as unknown as Parameters<Container["collectRenderables"]>[2],
  );
  return drawn;
};
const expectGroundOrder = (stage: Container, sprite: Container) => {
  let owner = sprite.parent;
  while (owner && !owner.getChildByLabel("scenery-shadows")) owner = owner.parent;
  const contact = owner!.getChildByLabel("scenery-shadows")!.children[0]!;
  const glow = owner!.getChildByLabel("scenery-lights")!.children[0]!;
  const drawn = drawOrder(stage);
  const lastTerrain = Math.max(...drawn.flatMap((view, index) => view instanceof Mesh && view.label !== "weather-particles" ? [index] : []));
  expect(drawn.indexOf(contact)).toBeGreaterThan(lastTerrain);
  expect(drawn.indexOf(glow)).toBeGreaterThan(lastTerrain);
  const leaves = drawn.filter((view) => { let node: Container | null = view; while (node) { if (node === sprite) return true; node = node.parent; } return false; });
  const bodyIndex = Math.min(...leaves.map((view) => drawn.indexOf(view)));
  expect(drawn.indexOf(contact)).toBeLessThan(bodyIndex);
  expect(drawn.indexOf(glow)).toBeLessThan(bodyIndex);
  expect(glow.position).toMatchObject({ x: sprite.x, y: sprite.y - (sprite instanceof Sprite ? 0 : sprite.height * 28 / 64) });
  expect(glow.parent!.alpha).toBeGreaterThan(0);
};
const travelSnapshot = (): TravelSnapshot => ({
  sector: map.sector, window: [{ sector: map.sector, dx: 0, dy: 0, map,
    structures: [], villageType: null, globalTileType: 1 }],
  viewer: { userId: "self", sector: map.sector, userQuests: [], questData: [], rank: "JONIN" } as unknown as UserWithRelations,
  users: [{ userId: "self", longitude: 1, latitude: 1, status: "AWAKE", rank: "JONIN",
    spriteAppearance: resolveSpriteAppearance({}), allianceStatus: "NEUTRAL", avatar: "lighting-avatar.png", isNpc: false } as SectorUser],
  actorRevision: 0, nav: null, col: 1, row: 1, enabled: false,
  brightness: WORLD_DAY_BRIGHTNESS, lightDate: null,
  decorations: new Map(), terrains: BUILTIN_TERRAINS_BY_KEY, libraryVersion: "lighting",
  locations: [], mapAssets: [], showUsers: true, minBracket: -1,
  friendlyAttack: false, structureObjectiveIds: new Set(),
});
const startTravel = (snapshot: TravelSnapshot) => createTravelScene({
  mount: document.createElement("div"), signal: new AbortController().signal,
  lightLayout: false, getSnapshot: () => ({ ...snapshot }), onError: vi.fn(), onReady() {},
  onTap() {}, onHover() {}, onZoom() {}, initialZoom: 1,
});

describe("world lighting precision fallback", () => {
  it("draws staff precipitation above scenery but below pins on mediump devices", async () => {
    const fixture = rendererFixture(), snapshot = travelSnapshot();
    snapshot.weather = { kind: "rain", intensity: .8 };
    await startTravel(snapshot);
    fixture.tick({ now: 1000, delta: .016, reducedMotion: false });
    const drawn = drawOrder(fixture.game.stage);
    const weather = fixture.game.stage.getChildByLabel("weather-particles", true)!;
    const body = fixture.game.stage.getChildByLabel("fixture-body", true)!;
    const pin = fixture.game.stage.getChildByLabel("fixture-pin", true)!;
    expect(weather).toBeDefined();
    expect(drawn.indexOf(weather)).toBeGreaterThan(drawn.indexOf(body));
    expect(drawn.indexOf(weather)).toBeLessThan(drawn.indexOf(pin));
    expectAmbientOnly();
    snapshot.weather = { kind: "clear", intensity: 0 };
    fixture.tick({ now: 1016, delta: .016, reducedMotion: false });
    expect(weather.parent?.visible).toBe(false);
  });
  it("keeps outdoor combat weather below pins independently of the lighting preference, while previews stay clear", async () => {
    const fixture = rendererFixture();
    const prepare = combatTerrain.prepareCombatTerrain;
    vi.spyOn(combatTerrain, "prepareCombatTerrain").mockImplementation((...args) => ({ ...prepare(...args), scenery }));
    const battle = makeCompleteBattle({ background: "ground", width: 12, height: 10, usersEffects: [], usersState: [] }) as unknown as ReturnedBattle;
    const snapshot: CombatSceneSnapshot = { battle, userId: "self", actions: [], timeDiff: 0,
      cycleEnabled: false, weatherTime: 180_000, assets: [], requestedIds: new Set(), active: true, sound: false,
      volume: 0, showGridNumbers: false, inspect: false };
    const scene = await createCombatScene({ mount: document.createElement("div"), signal: new AbortController().signal,
      getSnapshot: () => snapshot, onError: vi.fn(), onTap() {}, onHover() {}, onZoom() {}, play() {}, initialZoom: 1, lightLayout: false });
    await scene.renderAt(1000);
    const weather = fixture.game.stage.getChildByLabel("weather-particles", true)!;
    const pin = fixture.game.stage.getChildByLabel("fixture-pin", true)!;
    const drawn = drawOrder(fixture.game.stage);
    expect(drawn.indexOf(weather)).toBeGreaterThanOrEqual(0);
    expect(drawn.indexOf(weather)).toBeLessThan(drawn.indexOf(pin));
    delete snapshot.weatherTime;
    await scene.renderAt(1016);
    expect(weather.parent?.visible).toBe(false);
    expectAmbientOnly();
  });
  it("keeps the selected journey below bodies without a pointer and clears it when interaction is disabled", async () => {
    const fixture = rendererFixture(), snapshot = travelSnapshot();
    snapshot.nav = buildWindowNav([{ dx: 0, dy: 0, map }], 10);
    snapshot.enabled = true;
    snapshot.routeTarget = { sector: map.sector, x: 2, y: 1 };
    const scene = await startTravel(snapshot);
    fixture.tick(); await flushArtwork(); fixture.tick();
    const route = fixture.game.stage.getChildByLabel("travel-path", true)!;
    const ribbon = route.getChildByLabel("travel-path-ribbon")!;
    const actor = (fixture.game.stage.getChildByLabel("user:self", true) ?? fixture.game.stage.getChildByLabel("self", true))!.getChildByLabel("avatar", true)!;
    const drawn = drawOrder(fixture.game.stage);
    expect(route.visible).toBe(true);
    expect(drawn.indexOf(ribbon)).toBeGreaterThan(Math.max(...drawn.flatMap((view, index) => view instanceof Mesh ? [index] : [])));
    expect(drawn.indexOf(ribbon)).toBeLessThan(drawn.findIndex((view) => view.parent === actor));
    scene.clearHighlights();
    expect(route.visible).toBe(false);
    fixture.tick();
    expect(route.visible).toBe(true);
    snapshot.enabled = false;
    fixture.tick();
    expect(route.visible).toBe(false);
  });

  it("cycles travel terrain, scenery and asynchronously loaded actors without tinting identity pins", async () => {
    const fixture = rendererFixture(), snapshot = travelSnapshot();
    const scene = await startTravel(snapshot);
    fixture.tick(); await flushArtwork(); fixture.tick();
    const sector = scene.sectors.get(map.sector)!;
    const body = sector.art.entries[0]!.sprite, pin = sector.art.entries[1]!.sprite;
    const actor = (fixture.game.stage.getChildByLabel("user:self", true) ?? fixture.game.stage.getChildByLabel("self", true))!.getChildByLabel("avatar", true) as Sprite;
    const actorPin = actor.parent!.getChildByLabel("info") as Sprite;
    const pinTint = actorPin.tint;
    expect(terrainAmbient(sector.terrain.container)).toEqual([1, 1, 1]);
    expect(actor.tint).toBe(0xffffff);
    snapshot.brightness = WORLD_NIGHT_BRIGHTNESS;
    fixture.tick();
    expect(terrainAmbient(sector.terrain.container)[0]).toBeLessThan(1);
    expect(body.tint).not.toBe(0xffffff);
    expect(actor.tint).toBe(body.tint);
    expect(pin.tint).toBe(0xffcc77);
    expect(actorPin.tint).toBe(pinTint);
    expectGroundOrder(fixture.game.stage, body as Sprite);
    expectGroundOrder(fixture.game.stage, actor as Sprite);
    snapshot.users.push({ ...snapshot.users[0]!, userId: "arriving", longitude: 2 });
    snapshot.actorRevision++;
    fixture.tick(); await flushArtwork();
    const characters = fixture.game.stage.getChildrenByLabel(/^user:/, true).map((root) => root.getChildByLabel("avatar", true)!);
    expect(characters).toHaveLength(2);
    expect(characters.every((character) => character.tint === body.tint)).toBe(true);
    snapshot.brightness = WORLD_DAY_BRIGHTNESS;
    fixture.tick();
    expect(terrainAmbient(sector.terrain.container)).toEqual([1, 1, 1]);
    expect(body.tint).toBe(0xffffff);
    expect(characters.every((character) => character.tint === 0xffffff)).toBe(true);
    expect(fixture.game.canvas.style.filter).toBe("none");
    expectAmbientOnly();
  });

  it("cycles combat terrain and fighters while contacts and foot lights draw above terrain and HUD pins stay unlit", async () => {
    const fixture = rendererFixture();
    const prepare = combatTerrain.prepareCombatTerrain;
    vi.spyOn(combatTerrain, "prepareCombatTerrain").mockImplementation((...args) => ({ ...prepare(...args), scenery }));
    const battle = makeCompleteBattle({ width: 12, height: 10, usersEffects: [],
      usersState: [makeBattleUser("self", { isAi: false, longitude: 3, latitude: 2, spriteAppearance: resolveSpriteAppearance({}) })],
    }) as unknown as ReturnedBattle;
    const snapshot: CombatSceneSnapshot = { battle, userId: "self", actions: [], timeDiff: 0,
      cycleEnabled: true, assets: [], requestedIds: new Set(), active: true, sound: false,
      volume: 0, showGridNumbers: false, inspect: false };
    const now = vi.spyOn(Date, "now").mockReturnValue(WORLD_DAY_SECONDS * 500);
    const scene = await createCombatScene({ mount: document.createElement("div"),
      signal: new AbortController().signal, getSnapshot: () => snapshot, onError: vi.fn(),
      onTap() {}, onHover() {}, onZoom() {}, play() {}, initialZoom: 1, lightLayout: false,
    });
    await scene.renderAt(0);
    const body = fixture.game.stage.getChildByLabel("fixture-body", true) as Sprite;
    const actor = (fixture.game.stage.getChildByLabel("user:self", true) ?? fixture.game.stage.getChildByLabel("self", true))!.getChildByLabel("avatar", true) as Sprite;
    const pin = fixture.game.stage.getChildByLabel("fixture-pin", true) as Sprite, pinTint = pin.tint;
    expect(terrainAmbient(fixture.game.stage)).toEqual([1, 1, 1]);
    now.mockReturnValue((WORLD_DAY_SECONDS + 10) * 1000);
    await scene.renderAt(0);
    expect(terrainAmbient(fixture.game.stage)[0]).toBeLessThan(1);
    expect(actor.tint).toBe(body.tint);
    expect(actor.tint).not.toBe(0xffffff);
    expect(pin.tint).toBe(pinTint);
    expectGroundOrder(fixture.game.stage, body as Sprite);
    expectGroundOrder(fixture.game.stage, actor as Sprite);
    const actorLight = fixture.game.stage.getChildByLabel("self", true)!.getChildByLabel("scenery-lights")!.children[0]!;
    const fighter = battle.usersState[0]!, health = fighter.curHealth;
    fighter.curHealth = 0;
    battle.version++;
    await scene.renderAt(0);
    expect(actorLight.visible).toBe(false);
    fighter.curHealth = health;
    battle.version++;
    snapshot.cycleEnabled = false;
    await scene.renderAt(0);
    expect(terrainAmbient(fixture.game.stage)).toEqual([1, 1, 1]);
    expect(actor.tint).toBe(0xffffff);
    expectAmbientOnly();
  });

  it("keeps static sector previews at noon without allocating physical lighting or loading material metadata", async () => {
    const fixture = rendererFixture();
    await createSectorPreview({ mount: document.createElement("div"),
      signal: new AbortController().signal, onError: vi.fn(), canMove: () => false, onMove() {},
      data: { map, sector: map.sector, decorationAssets: new Map(), terrainRegistry: BUILTIN_TERRAINS_BY_KEY },
    });
    fixture.tick();
    expect(terrainAmbient(fixture.game.stage)).toEqual([1, 1, 1]);
    expect((fixture.game.stage.getChildByLabel("fixture-body", true) as Sprite).tint).toBe(0xffffff);
    expect((fixture.game.stage.getChildByLabel("fixture-pin", true) as Sprite).tint).toBe(0xffcc77);
    expectAmbientOnly();
  });

  it("retains physical filters, terrain receivers and cycle updates when highp is supported", async () => {
    vi.spyOn(pixi, "getMaxFragmentPrecision").mockReturnValue("highp");
    vi.spyOn(sectorSprites, "sectorSpriteDescriptions").mockReturnValue([]);
    const fixture = rendererFixture(), snapshot = travelSnapshot();
    snapshot.users = [];
    snapshot.brightness = WORLD_NIGHT_BRIGHTNESS;
    snapshot.lightDate = new Date((WORLD_DAY_SECONDS + 10) * 1000);
    const scene = await startTravel(snapshot);
    fixture.tick();
    expect(worldShadows.createWorldShadows).toHaveBeenCalledTimes(1);
    expect(RenderTexture.create).toHaveBeenCalled();
    expect(worldOcclusion.createWorldOcclusion).toHaveBeenCalledTimes(2);
    expect(fixture.game.renderer.render).toHaveBeenCalled();
    const physical = fixture.game.stage.getChildByLabel("physical-world", true)!;
    expect(physical.filters).toHaveLength(1);
    const filter = (physical.filters as pixi.Filter[])[0]!;
    expect(filter.resources.look.uniforms.uDay).toBe(0);
    expect(terrainAmbient(scene.sectors.get(map.sector)!.terrain.container)).toEqual([1, 1, 1]);
  });
});
