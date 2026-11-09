import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import {
  Assets,
  BufferImageSource,
  Container,
  Graphics,
  RenderLayer,
  Texture,
} from "pixi.js";
import { SECTOR_WALK_STEP_MS } from "@/drizzle/constants";
import { resolveSpriteAppearance } from "@/libs/lpc/appearance";
import * as bakedLighting from "@/libs/rendering/bakedVillageLighting";
import * as maskedTextures from "@/libs/rendering/maskedTextures";
import * as terrain from "@/libs/rendering/primitives/terrain";
import * as runtime from "@/libs/rendering/runtime";
import {
  createTravelScene,
  type TravelSnapshot,
  type TravelWindowEntry,
} from "@/libs/rendering/scenes/travel";
import { createTravelActors } from "@/libs/rendering/scenes/travelActors";
import * as terrainElevation from "@/libs/rendering/terrainElevation";
import { WORLD_STRUCTURE_ART } from "@/libs/rendering/worldStructures";
import type { DecorationAsset } from "@/libs/sector-map/decorations";
import * as navigation from "@/libs/sector-map/navigation";
import { BUILTIN_TERRAINS_BY_KEY } from "@/libs/sector-map/terrains";
import type { SectorUser } from "@/libs/sector-map/world-types";
import { DEFAULT_VISUAL_EFFECTS } from "@/libs/visualEffects";
import type { UserWithRelations } from "@/routers/profile";
import { deferred } from "../../setup/deferred";
import { lpcCatalog } from "../../setup/lpc";

const cleanups: (() => void)[] = [];
const frame = (now = 1000, reducedMotion = true): runtime.GameFrame => ({
  now,
  delta: 1 / 60,
  reducedMotion,
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const appearance = resolveSpriteAppearance({});
const player = (patch: Partial<SectorUser> = {}) =>
  ({
    userId: "self",
    longitude: 4,
    latitude: 4,
    status: "AWAKE",
    rank: "JONIN",
    allianceStatus: "NEUTRAL",
    experience: 0,
    spriteAppearance: appearance,
    curHealth: 1,
    maxHealth: 100,
    ...patch,
  }) as SectorUser;
const viewer = {
  userId: "self",
  sector: 724,
  rank: "JONIN",
  userQuests: [],
  questData: [],
} as unknown as NonNullable<UserWithRelations>;
const windowEntry = (sector = 724, dy = 0): TravelWindowEntry => ({
  sector,
  dx: 0,
  dy,
  villageType: null,
  globalTileType: 1,
  map: {
    formatVersion: 1,
    sector,
    name: "Depth test",
    width: 12,
    height: 12,
    tiles: [],
    anchors: [],
    exits: [],
    metadata: { importedAt: "", source: "tiled" },
    objects: [{ id: "tree", type: "decoration", assetKey: "tree", x: 4, y: 5 }],
  },
  structures: [
    {
      id: "building",
      longitude: 8,
      latitude: 5,
      image: "depth-building.png",
      hasPage: 1,
    },
  ] as TravelWindowEntry["structures"],
});
const snapshotFixture = (): TravelSnapshot => ({
  sector: 724,
  actorRevision: 0,
  viewer,
  users: [player()],
  minBracket: -1,
  showUsers: true,
  friendlyAttack: false,
  structureObjectiveIds: new Set(),
  window: [windowEntry()],
  nav: null,
  col: 4,
  row: 4,
  enabled: true,
  brightness: 1,
  decorations: new Map([
    [
      "tree",
      { key: "tree", filepath: "depth-tree.png", renderScale: 3 } as DecorationAsset,
    ],
  ]),
  terrains: new Map(),
  libraryVersion: "depth",
  locations: [],
  mapAssets: [],
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
    lpcCatalog,
    visualEffects: { ...DEFAULT_VISUAL_EFFECTS },
    stage,
    canvas,
    signal: controller.signal,
    renderer: { width: 1024, height: 600 },
    own: (cleanup: () => void) => {
      owned.add(cleanup);
    },
    disown: (cleanup: () => void) => {
      owned.delete(cleanup);
    },
    isDisposed: () => disposed,
    setResize: () => {},
    setBackground: () => {},
    invalidate: vi.fn(),
    setAnimating: vi.fn(),
    compileShaders: vi.fn(),
    listen: (type: string, callback: EventListener) =>
      canvas.addEventListener(type, callback, { signal: listeners.signal }),
    setUpdate: (next: typeof update) => {
      update = next;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      controller.abort();
      listeners.abort();
      for (const cleanup of owned) cleanup();
      stage.destroy({ children: true, texture: false, textureSource: false });
    },
  } as unknown as runtime.GameRenderer;
  cleanups.push(game.dispose);
  vi.spyOn(runtime, "createGameRenderer").mockResolvedValue(game);
  vi.spyOn(terrain, "createHexTerrain").mockImplementation(async (scope) => {
    const container = new Container();
    const dispose = () => {
      if (!container.destroyed) container.destroy({ children: true });
    };
    scope.own(dispose);
    return {
      container,
      dispose,
      isAnimated: false,
      setLighting: () => {},
      setTints: () => {},
      setOrigin: () => {},
      setDepthBias: () => {},
      setRain: () => {},
    };
  });
  const event = (type: string, x: number, y: number) => {
    const pointer = new window.MouseEvent(type, { button: 0, clientX: x, clientY: y });
    Object.defineProperty(pointer, "pointerId", { value: 1 });
    canvas.dispatchEvent(pointer);
  };
  return { game, stage, event, advance: (next = frame()) => update(next) };
};
const sceneFixture = async (state = snapshotFixture(), initialZoom = 1) => {
  const fixture = gameFixture();
  const onTap = vi.fn();
  const scene = await createTravelScene({
    mount: document.createElement("div"),
    signal: fixture.game.signal,
    lightLayout: false,
    getSnapshot: () => ({ ...state }),
    onError: (error) => {
      throw error;
    },
    onReady: () => {},
    onTap,
    onHover: () => {},
    onZoom: () => {},
    initialZoom,
  });
  fixture.advance();
  await settle();
  const world = fixture.stage.children[0]!;
  const collect = (node: Container): RenderLayer[] =>
    node.children.flatMap((child) =>
      child instanceof RenderLayer ? [child] : collect(child),
    );
  const layers = collect(world);
  return {
    ...fixture,
    scene,
    state,
    world,
    onTap,
    depth: layers.find((layer) => layer.label === "travel-depth")!,
    overlay: layers.find((layer) => layer.label === "travel-overlay")!,
  };
};
beforeEach(() => {
  const texture = new Texture({
    source: new BufferImageSource({
      resource: new Uint8Array(4),
      width: 4096,
      height: 4096,
    }),
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(Assets, "load").mockImplementation(async () => texture);
  vi.spyOn(Assets, "unload").mockResolvedValue(undefined);
  vi.spyOn(maskedTextures, "acquireMaskedTexture").mockImplementation(() => ({
    resource: Promise.resolve(texture),
    release: () => {},
  }));
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.restoreAllMocks();
});
const standingOffsetFor = (tile: { height: number }, terrace: number) =>
  terrace * terrainElevation.LAND_STEP * tile.height;

describe("still travel rendering", () => {
  it("makes terrain ready while a published light-field request is still pending", async () => {
    const original = bakedLighting.createBakedVillageLighting;
    const { promise: held, resolve: release } = deferred<void>();
    vi.spyOn(bakedLighting, "createBakedVillageLighting").mockImplementation(
      (...args) => ({ ...original(...args), preloadField: () => held }),
    );
    let ready = false;
    const pending = sceneFixture().then((scene) => {
      ready = true;
      return scene;
    });
    try {
      for (let i = 0; i < 5; i++) await settle();
      expect(ready).toBe(true);
    } finally {
      release();
      await pending;
    }
  });

  it("keeps rain moving without sprite animation and sleeps only when every active category is off", async () => {
    const { game, world, state, advance } = await sceneFixture();
    state.weather = { kind: "rain", intensity: 1 };
    Object.assign(
      game.visualEffects,
      Object.fromEntries(
        Object.keys(DEFAULT_VISUAL_EFFECTS).map((key) => [key, false]),
      ),
    );
    advance(frame(1000, false));
    expect(game.setAnimating).toHaveBeenLastCalledWith(false);
    for (const effect of [
      "weather",
      "wind",
      "sunlight",
      "dayNight",
      "localLights",
      "spriteAnimations",
    ] as const) {
      game.visualEffects[effect] = true;
      advance(frame(1100, false));
      expect(game.setAnimating).toHaveBeenLastCalledWith(true);
      if (effect === "weather")
        expect(world.getChildByLabel("world-weather")!.visible).toBe(true);
      game.visualEffects[effect] = false;
      advance(frame(1200, false));
      expect(game.setAnimating).toHaveBeenLastCalledWith(false);
    }
  });
  it("sleeps after effects are disabled, wakes for ref updates and resumes after toggling", async () => {
    let poll = () => {};
    vi.spyOn(globalThis, "setInterval").mockImplementation(((
      callback: Parameters<typeof setInterval>[0],
    ) => {
      poll = callback as () => void;
      return 1;
    }) as unknown as typeof setInterval);
    const clear = vi.spyOn(globalThis, "clearInterval").mockImplementation(() => {});
    const { game, scene, state, advance } = await sceneFixture();
    const invalidate = game.invalidate as ReturnType<typeof vi.fn>;
    Object.assign(
      game.visualEffects,
      Object.fromEntries(
        Object.keys(DEFAULT_VISUAL_EFFECTS).map((key) => [key, false]),
      ),
    );
    advance(frame());
    expect(game.setAnimating).toHaveBeenLastCalledWith(false);
    invalidate.mockClear();
    poll();
    expect(invalidate).not.toHaveBeenCalled();
    state.users = [...state.users, player({ userId: "arrival", longitude: 5 })];
    state.actorRevision++;
    poll();
    expect(invalidate).toHaveBeenCalledTimes(1);
    advance(frame());
    await settle();
    invalidate.mockClear();
    poll();
    expect(invalidate).not.toHaveBeenCalled();
    state.col = 5;
    poll();
    expect(invalidate).toHaveBeenCalledTimes(1);
    advance(frame());
    Object.assign(game.visualEffects, DEFAULT_VISUAL_EFFECTS);
    advance(frame(1100, false));
    expect(game.setAnimating).toHaveBeenLastCalledWith(true);
    Object.assign(
      game.visualEffects,
      Object.fromEntries(
        Object.keys(DEFAULT_VISUAL_EFFECTS).map((key) => [key, false]),
      ),
    );
    advance(frame(1200));
    expect(game.setAnimating).toHaveBeenLastCalledWith(false);
    invalidate.mockClear();
    poll();
    expect(invalidate).not.toHaveBeenCalled();
    scene.clearHighlights();
    expect(invalidate).toHaveBeenCalledTimes(1);
    scene.dispose();
    expect(clear).toHaveBeenCalledWith(1);
    invalidate.mockClear();
    state.actorRevision++;
    poll();
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe("travel scene ground depth", () => {
  it("prepares destination scenery during travel and resumes the same scene on arrival", async () => {
    const state = snapshotFixture();
    state.viewer = { ...viewer, status: "TRAVEL" };
    state.enabled = false;
    const { scene, game, advance, event, onTap, world } = await sceneFixture(state);
    const sector = scene.sectors.get(state.sector)!;
    expect(sector.art.entries.length).toBeGreaterThan(0);
    expect(game.setAnimating).toHaveBeenLastCalledWith(false);
    const actors = world.children.at(-1)!;
    expect(actors.children).toHaveLength(0);
    event("pointerdown", 400, 300);
    event("pointerup", 400, 300);
    expect(onTap).not.toHaveBeenCalled();
    const builds = (runtime.createGameRenderer as ReturnType<typeof vi.fn>).mock.calls
      .length;
    state.viewer = { ...viewer, status: "AWAKE" };
    state.enabled = true;
    scene.recenter();
    expect(game.invalidate).toHaveBeenCalled();
    advance();
    await settle();
    expect(game.setAnimating).toHaveBeenLastCalledWith(true);
    expect(scene.sectors.get(state.sector)).toBe(sector);
    expect(
      (runtime.createGameRenderer as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(builds);
    expect(actors.children.length).toBeGreaterThan(0);
  });

  it.each([false, true])(
    "allows walking and live actors during scenery loading and owns cancellation (%s)",
    async (cancel) => {
      const state = snapshotFixture();
      state.window[0]!.structures[0]!.image = `pending-building-${cancel}.png`;
      const texture = new Texture({
        source: new BufferImageSource({
          resource: new Uint8Array(4),
          width: 4096,
          height: 4096,
        }),
      });
      const { promise: pending, resolve: release } = deferred<Texture>();
      vi.spyOn(Assets, "load").mockImplementation(async (input) =>
        JSON.stringify(input).includes(`pending-building-${cancel}`)
          ? pending
          : texture,
      );
      const fixture = gameFixture(),
        onReady = vi.fn(),
        onTap = vi.fn();
      const scene = await createTravelScene({
        mount: document.createElement("div"),
        signal: fixture.game.signal,
        lightLayout: false,
        getSnapshot: () => state,
        onError: (error) => {
          throw error;
        },
        onReady,
        onTap,
        onHover: () => {},
        onZoom: () => {},
        initialZoom: 1,
      });
      fixture.advance();
      await settle();
      const world = fixture.stage.children[0]!,
        ground = world.children[0]!.children[0]!;
      expect(ground).toBeDefined();
      expect(scene.sectors.get(724)!.art.entries).toHaveLength(0);
      expect(onReady).toHaveBeenCalledTimes(1);
      expect(
        world.children.at(-1)!.children.some((child) => child.label === "user:self"),
      ).toBe(true);
      const camera = { x: world.x, y: world.y };
      fixture.event("pointerdown", 400, 300);
      fixture.event("pointerup", 400, 300);
      expect(onTap).toHaveBeenCalledTimes(1);
      if (cancel) fixture.game.dispose();
      release(texture);
      await settle();
      if (cancel) {
        expect(ground.destroyed).toBe(true);
        expect(fixture.game.isDisposed()).toBe(true);
        expect(world.destroyed).toBe(true);
      } else {
        expect(scene.sectors.get(724)!.terrain.container).toBe(ground);
        expect(world.children[1]!.children).toHaveLength(1);
        expect(
          scene.sectors
            .get(724)!
            .art.entries.some((entry) => entry.description.id === "building"),
        ).toBe(true);
        expect(onReady).toHaveBeenCalledTimes(1);
        fixture.advance();
        expect({ x: world.x, y: world.y }).toEqual(camera);
      }
    },
  );

  it.each([false, true])(
    "prioritizes occupied artwork across repeated window updates and cancellation (%s)",
    async (cancel) => {
      const state = snapshotFixture(),
        neighbor = windowEntry(725, 1);
      state.window.push(neighbor);
      state.window[0]!.structures[0]!.image = "priority-current.png";
      neighbor.structures[0]!.image = "priority-neighbor.png";
      const { promise: pending, resolve: release } = deferred<Texture>();
      const load = vi
        .spyOn(Assets, "load")
        .mockImplementation(async (input) =>
          JSON.stringify(input).includes("priority-current") ? pending : Texture.WHITE,
        );
      const fixture = gameFixture(),
        ready = vi.fn();
      const scene = await createTravelScene({
        mount: document.createElement("div"),
        signal: fixture.game.signal,
        lightLayout: false,
        getSnapshot: () => state,
        onReady: ready,
        onError: (error) => {
          throw error;
        },
        onTap() {},
        onHover() {},
        onZoom() {},
        initialZoom: 1,
      });
      await scene.updateWindow();
      await settle();
      expect(scene.sectors.size).toBe(2);
      expect(ready).toHaveBeenCalled();
      expect(
        load.mock.calls.some(([input]) =>
          JSON.stringify(input).includes("priority-neighbor"),
        ),
      ).toBe(false);
      if (cancel) scene.dispose();
      release(Texture.WHITE);
      await settle();
      await settle();
      expect(
        load.mock.calls.some(([input]) =>
          JSON.stringify(input).includes("priority-neighbor"),
        ),
      ).toBe(!cancel);
      if (!cancel)
        expect(
          scene.sectors
            .get(725)!
            .art.entries.some((entry) => entry.description.id === "building"),
        ).toBe(true);
    },
  );

  it.each([false, true])(
    "promotes retained artwork on crossing once and owns cancellation (%s)",
    async (cancel) => {
      const state = snapshotFixture(),
        neighbor = windowEntry(725, 1);
      state.window.push(neighbor);
      state.window[0]!.structures[0]!.image = `crossing-old-${cancel}.png`;
      neighbor.structures[0]!.image = `crossing-new-${cancel}.png`;
      const { promise: pending, resolve: release } = deferred<Texture>();
      const load = vi
        .spyOn(Assets, "load")
        .mockImplementation(async (input) =>
          JSON.stringify(input).includes(`crossing-old-${cancel}`)
            ? pending
            : Texture.WHITE,
        );
      const { scene, advance } = await sceneFixture(state);
      await scene.updateWindow();
      await settle();
      const retained = scene.sectors.get(725)!;
      const newRequests = () =>
        load.mock.calls.filter(([input]) =>
          JSON.stringify(input).includes(`crossing-new-${cancel}`),
        ).length;
      expect(newRequests()).toBe(0);
      state.sector = 725;
      state.viewer = { ...state.viewer!, sector: 725 };
      state.actorRevision++;
      state.window = [
        { ...neighbor, dy: 0 },
        { ...state.window[0]!, dy: -1 },
      ];
      if (cancel) scene.dispose();
      else {
        await scene.updateWindow();
        advance();
        await settle();
        expect(scene.sectors.get(725)).toBe(retained);
        expect(
          retained.art.entries.some((entry) => entry.description.id === "building"),
        ).toBe(true);
        expect(newRequests()).toBe(1);
      }
      const art = retained.art;
      release(Texture.WHITE);
      await settle();
      await settle();
      if (!cancel) {
        await scene.updateWindow();
        await settle();
      }
      expect(newRequests()).toBe(cancel ? 0 : 1);
      expect(retained.art).toBe(art);
      if (cancel) expect(retained.scope.isDisposed()).toBe(true);
    },
  );

  it("grounds border walls in neighboring water and refreshes their retained terrain after a layout change", async () => {
    const state = snapshotFixture(),
      water = state.window[0]!,
      village = windowEntry(725, 1);
    const ocean = (entry: TravelWindowEntry) => {
      entry.map = {
        ...entry.map,
        objects: [],
        tiles: Array.from({ length: 144 }, (_, i) => ({
          x: i % 12,
          y: Math.floor(i / 12),
          terrain: "ocean",
          battleBiome: "ocean",
          zone: "water",
          walkCost: 1,
          blocked: false,
        })),
      };
    };
    ocean(water);
    ocean(village);
    water.structures = [];
    village.villageType = "VILLAGE";
    village.structures = [{ ...village.structures[0]!, longitude: 6, latitude: 0 }];
    state.window = [water, village];
    state.terrains = new Map([["ocean", BUILTIN_TERRAINS_BY_KEY.get("ocean")!]]);
    const { scene } = await sceneFixture(state);
    const bank = () => scene.sectors.get(724)!.grid.getHex({ col: 6, row: 11 })!;
    expect(bank().spec?.isWater).toBe(false);
    expect(bank().spec?.depression).toBe(0);
    await scene.updateWindow();
    const previous = scene.sectors.get(724)!;
    village.structures = [{ ...village.structures[0]!, longitude: 2 }];
    await scene.updateWindow();
    expect(scene.sectors.get(724)).not.toBe(previous);
    expect(bank().spec?.isWater).toBe(true);
    expect(
      scene.sectors.get(724)!.grid.getHex({ col: 2, row: 11 })!.spec?.isWater,
    ).toBe(false);
    const retained = scene.sectors.get(724)!;
    state.sector = 725;
    state.window = [
      { ...village, dy: 0 },
      { ...water, dy: -1 },
    ];
    await scene.updateWindow();
    expect(scene.sectors.get(724)).toBe(retained);
    village.structures = [];
    state.window = [
      { ...village, dy: 0 },
      { ...water, dy: -1 },
    ];
    await scene.updateWindow();
    expect(
      scene.sectors.get(724)!.grid.getHex({ col: 2, row: 11 })!.spec?.isWater,
    ).toBe(true);
  });

  it.each([false, true])(
    "retains shoreline topology across account refreshes (shared navigation: %s)",
    async (shared) => {
      const state = snapshotFixture(),
        entry = state.window[0]!;
      entry.globalTileType = 0;
      state.terrains = new Map([["ocean", BUILTIN_TERRAINS_BY_KEY.get("ocean")!]]);
      if (shared) state.nav = navigation.buildWindowNav(state.window, 10);
      const nav = vi.spyOn(navigation, "buildWindowNav"),
        shelf = vi.spyOn(terrainElevation, "createTerrainField");
      const { scene } = await sceneFixture(state);
      const builds = [nav.mock.calls.length, shelf.mock.calls.length];
      expect(builds[0]).toBe(shared ? 0 : 1);
      expect(builds[1]).toBeGreaterThan(0);
      state.viewer = { ...state.viewer, latitude: 5 } as UserWithRelations;
      state.locations = [...state.locations];
      await scene.updateWindow();
      await scene.updateWindow();
      expect([nav.mock.calls.length, shelf.mock.calls.length]).toEqual(builds);
      entry.map = {
        ...entry.map,
        tiles: [
          {
            x: 4,
            y: 4,
            terrain: "grass",
            walkCost: 1,
            battleBiome: "ground",
            blocked: false,
            zone: "safezone",
          },
        ],
      };
      if (shared) state.nav = navigation.buildWindowNav(state.window, 10);
      await scene.updateWindow();
      expect(nav.mock.calls.length).toBe(builds[0]! + 1);
      expect(shelf.mock.calls.length).toBe(builds[1]! + 1);
    },
  );
  it.each(["village", "structure", "landmark"] as const)(
    "draws a same-tile actor behind a %s building and a front-adjacent actor in front",
    async (kind) => {
      const state = snapshotFixture();
      state.users = [player({ longitude: 8, latitude: 5 })];
      if (kind !== "village") {
        state.window[0]!.structures = [];
        state.window[0]!.map.objects.push({
          id: "building",
          type: kind,
          x: 8,
          y: 5,
          assetKey: "depth-building.png",
        });
      }
      const { scene, depth, advance } = await sceneFixture(state);
      const sector = scene.sectors.get(724)!;
      const actor = depth.renderLayerChildren.find(
        (child) => child.label === "user:self",
      )!;
      const building = sector.art.entries.find(
        (entry) => entry.description.id === "building",
      )!;
      const tile = sector.grid.getHex({ col: 8, row: 5 })!;
      expect(actor.y).toBeCloseTo(-tile.center.y);
      depth.sortRenderLayerChildren();
      expect(depth.renderLayerChildren.indexOf(actor)).toBeLessThan(
        depth.renderLayerChildren.indexOf(building.sprite),
      );
      const placement = {
        x: building.sprite.x,
        y: building.sprite.y,
        width: building.sprite.width,
        height: building.sprite.height,
      };
      state.users = [player({ longitude: 8, latitude: 4 })];
      state.actorRevision++;
      advance();
      expect(actor.y).toBeCloseTo(-sector.grid.getHex({ col: 8, row: 4 })!.center.y);
      depth.sortRenderLayerChildren();
      expect(depth.renderLayerChildren.indexOf(actor)).toBeGreaterThan(
        depth.renderLayerChildren.indexOf(building.sprite),
      );
      expect(building.sprite).toMatchObject(placement);
    },
  );

  it("stands roaming herds on the terrace beneath them", async () => {
    const herdYs = async (terrace: number) => {
      const state = snapshotFixture(),
        entry = state.window[0]!;
      entry.map = { ...entry.map, objects: [] };
      entry.structures = [];
      const real = terrainElevation.createTerrainField;
      const field = vi
        .spyOn(terrainElevation, "createTerrainField")
        .mockImplementation((...args) => ({ ...real(...args), level: () => terrace }));
      const deer = (member: number) =>
        player({
          userId: "deer",
          isNpc: true,
          npcPlacementId: "herd",
          npcCopy: 0,
          npcMember: member,
          npcInteractionType: "AMBIENT",
          longitude: 6,
          latitude: 5,
          npcWander: {
            seed: "herd:hill",
            anchor: { x: 6, y: 5 },
            radius: 0,
            wildOnly: true,
          },
        });
      state.users = [
        player(),
        ...Array.from({ length: 4 }, (_, member) => deer(member)),
      ];
      const { scene, depth, advance } = await sceneFixture(state);
      advance();
      await settle();
      advance();
      field.mockRestore();
      const tile = scene.sectors.get(724)!.grid.getHex({ col: 6, row: 5 })!;
      return {
        tile,
        ys: depth.renderLayerChildren
          .filter((child) => child.label.startsWith("npc:herd"))
          .map((child) => child.y),
      };
    };
    const level = await herdYs(0),
      raised = await herdYs(2);
    expect(raised.ys).toHaveLength(4);
    raised.ys.forEach((y, index) =>
      expect(y - level.ys[index]!).toBeCloseTo(standingOffsetFor(raised.tile, 2)),
    );
  });

  it("keeps every member of a shore herd on land, pulling offsets in from the water", async () => {
    const state = snapshotFixture(),
      entry = state.window[0]!;
    entry.map = {
      ...entry.map,
      objects: [],
      tiles: Array.from({ length: 144 }, (_, index) => {
        const x = index % 12,
          y = Math.floor(index / 12);
        return {
          x,
          y,
          terrain: x >= 7 ? "ocean" : "ground",
          walkCost: 1,
          blocked: false,
          zone: "wilderness" as const,
          battleBiome: x >= 7 ? ("ocean" as const) : ("ground" as const),
        };
      }),
    };
    entry.structures = [];
    state.terrains = new Map([["ocean", BUILTIN_TERRAINS_BY_KEY.get("ocean")!]]);
    const deer = (member: number) =>
      player({
        userId: "deer",
        isNpc: true,
        npcPlacementId: "herd",
        npcCopy: 0,
        npcMember: member,
        npcInteractionType: "AMBIENT",
        longitude: 6,
        latitude: 5,
        npcWander: {
          seed: "herd:shore",
          anchor: { x: 6, y: 5 },
          radius: 0,
          wildOnly: true,
        },
      });
    state.users = [player(), ...Array.from({ length: 6 }, (_, member) => deer(member))];
    const { scene, depth, advance } = await sceneFixture(state);
    advance();
    await settle();
    advance();
    const grid = scene.sectors.get(724)!.grid,
      anchor = grid.getHex({ col: 6, row: 5 })!;
    const herd = depth.renderLayerChildren.filter((child) =>
      child.label.startsWith("npc:herd"),
    );
    expect(herd).toHaveLength(6);
    for (const member of herd) {
      const under = grid.pointToHex(
        {
          x: anchor.x + anchor.center.x + member.x,
          y: anchor.y + anchor.center.y + member.y,
        },
        { allowOutside: false },
      );
      expect(under?.spec?.isWater).toBe(false);
    }
  });

  it("interleaves the same moving actor with trees and buildings at their ground baselines", async () => {
    const { scene, state, depth, advance } = await sceneFixture();
    const sector = scene.sectors.get(724)!;
    const actor = depth.renderLayerChildren.find(
      (child) => child.label === "user:self",
    )!;
    const tree = sector.art.entries.find((entry) => entry.description.id === "tree")!;
    const building = sector.art.entries.find(
      (entry) => entry.description.id === "building",
    )!;
    expect(actor.parentRenderLayer).toBe(tree.sprite.parentRenderLayer);
    expect(actor.parentRenderLayer).toBe(building.sprite.parentRenderLayer);
    expect(actor.parent).not.toBe(tree.sprite.parent);
    depth.sortRenderLayerChildren();
    for (const entry of [tree, building])
      expect(depth.renderLayerChildren.indexOf(actor)).toBeGreaterThan(
        depth.renderLayerChildren.indexOf(entry.sprite),
      );
    const before = actor.y;
    state.users = [player({ latitude: 6 })];
    state.actorRevision++;
    depth.parentRenderGroup!.structureDidChange = false;
    advance(frame(1100, false));
    expect(actor.y).not.toBe(before);
    // Painter keys can stay between unchanged contact constraints during interpolation.
    expect(depth.renderLayerChildren.includes(actor)).toBe(true);
    for (let tick = 0; tick < 8; tick++) advance(frame(1200 + tick));
    expect(depth.renderLayerChildren.find((child) => child.label === "user:self")).toBe(
      actor,
    );
    depth.sortRenderLayerChildren();
    for (const entry of [tree, building])
      expect(depth.renderLayerChildren.indexOf(actor)).toBeLessThan(
        depth.renderLayerChildren.indexOf(entry.sprite),
      );
  });

  it("fades scenery that paints over the viewer and restores it once the viewer stands clear", async () => {
    const { scene, state, depth, advance } = await sceneFixture();
    const sector = scene.sectors.get(724)!;
    const tree = sector.art.entries.find((entry) => entry.description.id === "tree")!;
    const building = sector.art.entries.find(
      (entry) => entry.description.id === "building",
    )!;
    const walk = (latitude: number) => {
      state.users = [player({ latitude })];
      state.row = latitude;
      state.actorRevision++;
      for (let tick = 0; tick < 8; tick++) advance(frame(1200 + tick));
    };
    walk(4);
    expect(tree.sprite.alpha).toBe(1);
    walk(6);
    depth.sortRenderLayerChildren();
    const actor = depth.renderLayerChildren.find(
      (child) => child.label === "user:self",
    )!;
    expect(depth.renderLayerChildren.indexOf(tree.sprite)).toBeGreaterThan(
      depth.renderLayerChildren.indexOf(actor),
    );
    expect(tree.sprite.alpha).toBeCloseTo(0.45);
    expect(building.sprite.alpha).toBe(1);
    // Live frames ease back rather than popping.
    state.users = [player({ latitude: 4 })];
    state.row = 4;
    state.actorRevision++;
    const alphas: number[] = [];
    for (let tick = 0; tick < 120; tick++) {
      advance(frame(1300 + tick * 16, false));
      alphas.push(tree.sprite.alpha);
    }
    expect(alphas.some((alpha) => alpha > 0.5 && alpha < 0.95)).toBe(true);
    for (let index = 1; index < alphas.length; index++)
      expect(alphas[index]!).toBeGreaterThanOrEqual(alphas[index - 1]!);
    expect(alphas.at(-1)).toBe(1);
  });

  it("rebuilds only the terrain of a retained sector whose edge gains a neighbour, matching a full build", async () => {
    const { scene, state } = await sceneFixture();
    state.window.push(windowEntry(725, 1));
    await scene.updateWindow();
    const retained = scene.sectors.get(725)!;
    const { art, terrain, scope } = retained;
    state.window.push({ ...windowEntry(726, 1), dx: 1 });
    await scene.updateWindow();
    expect(scene.sectors.get(725)).toBe(retained);
    expect(retained.art).toBe(art);
    expect(retained.scope).toBe(scope);
    expect(retained.terrain).not.toBe(terrain);
    expect(terrain.container.destroyed).toBe(true);
    // A fresh scene over the same window (new library version, so no cached build) agrees.
    const fresh = snapshotFixture();
    fresh.libraryVersion = "fresh-build";
    fresh.window = [...state.window];
    const reference = await sceneFixture(fresh);
    await reference.scene.updateWindow();
    const built = reference.scene.sectors.get(725)!;
    expect(built.sourceKey).not.toBe(retained.sourceKey);
    expect(retained.data.segments).toEqual(built.data.segments);
    expect(retained.data.surface).toEqual(built.data.surface);
  });

  it("settles an edge-only rebuild cancelled by disposal without rejecting the window update", async () => {
    const { scene, state } = await sceneFixture();
    state.window.push(windowEntry(725, 1));
    await scene.updateWindow();
    const retained = scene.sectors.get(725)!;
    (
      terrain.createHexTerrain as unknown as ReturnType<typeof vi.fn>
    ).mockImplementationOnce(async () => {
      scene.dispose();
      throw new DOMException("Scene disposed", "AbortError");
    });
    state.window.push({ ...windowEntry(726, 1), dx: 1 });
    await expect(scene.updateWindow()).resolves.toBeUndefined();
    expect(retained.scope.isDisposed()).toBe(true);
  });

  it("frees sectors leaving the window in their own tasks", async () => {
    const { scene, state } = await sceneFixture();
    state.window.push(windowEntry(725, 1), { ...windowEntry(726, 1), dx: 1 });
    await scene.updateWindow();
    const disposals = [scene.sectors.get(725)!, scene.sectors.get(726)!].map((sector) =>
      vi.spyOn(sector.scope, "dispose"),
    );
    state.window = [windowEntry(724)];
    await scene.updateWindow();
    expect(scene.sectors.has(725) || scene.sectors.has(726)).toBe(false);
    await settle();
    await settle();
    await settle();
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("reconciles window requests that arrive together once", async () => {
    const { scene, state } = await sceneFixture();
    const field = vi.spyOn(terrainElevation, "createTerrainField");
    state.window.push(windowEntry(725, 1));
    const requests = [scene.updateWindow(), scene.updateWindow(), scene.updateWindow()];
    expect(new Set(requests).size).toBe(1);
    await Promise.all(requests);
    expect(field).toHaveBeenCalledTimes(1);
    expect(scene.sectors.has(725)).toBe(true);
  });

  it("leaves retained sectors in place when the window is reconciled without changes", async () => {
    const { scene, state } = await sceneFixture();
    state.window.push(windowEntry(725, 1));
    await scene.updateWindow();
    const sectors = [...scene.sectors.values()];
    const attaches = sectors.map((sector) => vi.spyOn(sector.art, "attachLayers"));
    const terrains = sectors.map((sector) => sector.terrain);
    await scene.updateWindow();
    await scene.updateWindow();
    for (const attach of attaches) expect(attach).not.toHaveBeenCalled();
    expect([...scene.sectors.values()].map((sector) => sector.terrain)).toEqual(
      terrains,
    );
  });

  it("reorders a retained sector's terrain by its new row when the window recentres", async () => {
    const { scene, state, advance } = await sceneFixture();
    state.window.push(windowEntry(725, 1));
    await scene.updateWindow();
    const original = scene.sectors.get(724)!,
      neighbor = scene.sectors.get(725)!;
    const biases = [
      vi.spyOn(original.terrain, "setDepthBias"),
      vi.spyOn(neighbor.terrain, "setDepthBias"),
    ];
    state.sector = 725;
    state.window = [windowEntry(725), windowEntry(724, -1)];
    await scene.updateWindow();
    advance();
    await settle();
    expect(scene.sectors.get(724)).toBe(original);
    expect(biases[0]).toHaveBeenLastCalledWith(0.001);
    expect(biases[1]!.mock.lastCall?.[0]).toBeCloseTo(0);
  });

  it("refreshes retained scenery and actor depths on sector offsets and world rebasing, and detaches disposed sectors", async () => {
    const { scene, state, depth, advance } = await sceneFixture();
    state.window.push(windowEntry(725, 1));
    await scene.updateWindow();
    const original = scene.sectors.get(724)!;
    const neighbor = scene.sectors.get(725)!;
    const art = original.art.entries[0]!;
    const neighborArt = neighbor.art.entries[0]!;
    expect(neighborArt.sprite.zIndex).toBeCloseTo(
      -(neighborArt.description.groundY + neighbor.position.y),
    );
    state.sector = 725;
    state.window = [windowEntry(725), windowEntry(724, -1)];
    await scene.updateWindow();
    advance();
    await settle();
    expect(scene.sectors.get(724)).toBe(original);
    const actor = depth.renderLayerChildren.find(
      (child) => child.label === "user:self",
    )!;
    const tile = neighbor.grid.getHex({ col: 4, row: 4 })!;
    expect(actor.zIndex).toBeCloseTo(
      -(actor.y + tile.height * (0.1 + (1.8 * 0.7 * 4) / 64) + neighbor.position.y),
    );
    // Moving the retained center far enough triggers the production rebase branch.
    neighbor.position = { x: 100_000, y: 100_000 };
    await scene.updateWindow();
    advance();
    expect(neighbor.position).toEqual({ x: 0, y: 0 });
    expect(neighborArt.sprite.zIndex).toBeCloseTo(-neighborArt.description.groundY);
    expect(art.sprite.zIndex).toBeCloseTo(
      -(art.description.groundY + original.position.y),
    );
    expect(actor.zIndex).toBeCloseTo(
      -(actor.y + tile.height * (0.1 + (1.8 * 0.7 * 4) / 64)),
    );
    neighbor.art.setViewport(
      { minX: 100_000, maxX: 100_001, minY: 100_000, maxY: 100_001 },
      0,
    );
    expect(neighborArt.sprite.renderable).toBe(false);
    expect(neighborArt.sprite.parentRenderLayer).toBeNull();
    expect(depth.renderLayerChildren.includes(neighborArt.sprite)).toBe(false);
    state.window = [windowEntry(725)];
    await scene.updateWindow();
    // A sector leaving the window is freed in its own task.
    await settle();
    expect(art.sprite.destroyed).toBe(true);
    expect(depth.renderLayerChildren).not.toContain(art.sprite);
    scene.dispose();
    expect(actor.destroyed).toBe(true);
    expect(neighborArt.sprite.destroyed).toBe(true);
  });

  it("keeps compact travel LPC art and shadows at a shared foot contact", async () => {
    const { scene, depth } = await sceneFixture();
    const actor = depth.renderLayerChildren.find(
      (child) => child.label === "user:self",
    )!;
    const tile = scene.sectors.get(724)!.grid.getHex({ col: 4, row: 4 })!;
    const shadow = actor.children[0] as Graphics;
    const character = actor.children[1]!.children.find(
      (child) => child.label === "avatar",
    )!;
    expect(character.scale.x).toBeCloseTo(tile.height * 1.8 * 0.7);
    expect(character.y - character.scale.x / 2).toBeCloseTo(tile.height * 0.1);
    const bounds = shadow.getLocalBounds();
    expect(bounds.width).toBeCloseTo(tile.height * (0.35 * 2 * 0.7 + 0.015));
    expect(bounds.height).toBeCloseTo(tile.height * (0.12 * 2 * 0.7 + 0.015));
    expect(bounds.y + bounds.height / 2).toBeCloseTo(
      tile.height * (0.1 + (1.8 * 0.7 * 4) / 64),
    );
    expect(actor.zIndex).toBeCloseTo(-(actor.y + bounds.y + bounds.height / 2));
  });

  it("picks overlapping NPC controls in overlay paint order while their bodies orbit", async () => {
    const { scene, game, world, depth, overlay } = await sceneFixture();
    const grid = scene.sectors.get(724)!.grid;
    const actors = createTravelActors(game, { depth, overlay });
    world.addChild(actors.container);
    const users = ["first", "second"].map((userId) =>
      player({
        userId,
        isNpc: true,
        npcPlacementId: userId,
        npcInteractionType: "FRIENDLY",
      }),
    );
    actors.sync({ ...snapshotFixture(), grid, users });
    await settle();
    const roots = users.map(
      (user) =>
        actors.container.children.find(
          (child) => child.label === `npc:${user.npcPlacementId}:0:0`,
        )!,
    );
    const controls = roots.map(
      (root) => root.children.at(-1)!.children.find((child) => child.label === "talk")!,
    );
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
      const minX = Math.max(...bounds.map((bound) => bound.minX)),
        maxX = Math.min(...bounds.map((bound) => bound.maxX));
      const minY = Math.max(...bounds.map((bound) => bound.minY)),
        maxY = Math.min(...bounds.map((bound) => bound.maxY));
      expect(maxX).toBeGreaterThan(minX);
      expect(maxY).toBeGreaterThan(minY);
      const x = (minX + maxX) / 2,
        y = (minY + maxY) / 2;
      const top = overlay.renderLayerChildren
        .filter((child) => controls.includes(child))
        .at(-1)!;
      const index = controls.indexOf(top);
      expect(actors.hit(x, y)).toMatchObject({
        type: "talk",
        npcPlacementId: users[index]!.npcPlacementId,
      });
      roots[index]!.visible = false;
      expect(actors.hit(x, y)).toMatchObject({
        type: "talk",
        npcPlacementId: users[1 - index]!.npcPlacementId,
      });
      roots[index]!.visible = true;
      top.visible = false;
      expect(actors.hit(x, y)).toMatchObject({
        type: "talk",
        npcPlacementId: users[1 - index]!.npcPlacementId,
      });
      top.visible = true;
    }
  });

  it.each(["battle", "quest"] as const)(
    "picks a visible %s marker above an overlapping NPC body",
    async (kind) => {
      const { scene, game, world, depth, overlay } = await sceneFixture();
      const grid = scene.sectors.get(724)!.grid;
      const actors = createTravelActors(game, { depth, overlay });
      world.addChild(actors.container);
      const npc = player({
        userId: "npc",
        isNpc: true,
        npcPlacementId: "npc",
        npcInteractionType: "FRIENDLY",
      });
      const questViewer = {
        ...viewer,
        userQuests: [
          {
            quest: {
              id: "quest",
              content: {
                objectives: [
                  {
                    id: "goal",
                    task: "move_to_location",
                    sector: 724,
                    longitude: 4,
                    latitude: 4,
                    image: "depth-quest.png",
                  },
                ],
              },
            },
          },
        ],
        questData: [{ id: "quest", goals: [{ id: "goal", done: false }] }],
      } as unknown as UserWithRelations;
      actors.sync({
        ...snapshotFixture(),
        grid,
        viewer: kind === "quest" ? questViewer : viewer,
        users:
          kind === "battle"
            ? [npc, player({ userId: "fighter", status: "BATTLE", battleId: "battle" })]
            : [npc],
      });
      actors.animate(frame());
      await settle();
      const root = actors.container.children.find(
        (child) => child.label === (kind === "battle" ? "battle:battle" : "quest:goal"),
      )!;
      const npcRoot = actors.container.children.find(
        (child) => child.label === "npc:npc:0:0",
      )!;
      const body = npcRoot.children
        .at(-1)!
        .children.find((child) => child.label === "avatar")!;
      const talk = npcRoot.children
        .at(-1)!
        .children.find((child) => child.label === "talk")!;
      const tile = grid.getHex({ col: 4, row: 4 })!;
      const point = root.toGlobal({
        x: tile.width * 0.5 - tile.height * 0.1,
        y: tile.height * 1.05,
      });
      expect(actors.container.getChildIndex(root)).toBeLessThan(
        actors.container.getChildIndex(npcRoot),
      );
      expect(overlay.renderLayerChildren.indexOf(root)).toBeLessThan(
        overlay.renderLayerChildren.indexOf(talk),
      );
      expect(
        root.children
          .at(-1)!
          .children.some((child) => child.getBounds().containsPoint(point.x, point.y)),
      ).toBe(true);
      expect(body.getBounds().containsPoint(point.x, point.y)).toBe(true);
      expect(talk.getBounds().containsPoint(point.x, point.y)).toBe(false);
      expect(actors.hit(point.x, point.y)).toMatchObject({
        key: root.label,
        type: `${kind}Marker`,
        longitude: 4,
        latitude: 4,
      });
      root.visible = false;
      expect(actors.hit(point.x, point.y)).toMatchObject({
        type: "avatar",
        npcPlacementId: "npc",
      });
    },
  );

  it("keeps controls and encounter/count markers above scenery and prioritizes visible controls over nearer bodies", async () => {
    const { scene, game, world, depth, overlay } = await sceneFixture();
    expect(world.getChildIndex(depth.parent!)).toBeLessThan(
      world.getChildIndex(overlay),
    );
    const grid = scene.sectors.get(724)!.grid;
    const actors = createTravelActors(game, { depth, overlay });
    world.addChild(actors.container);
    const users = [
      player({ userId: "other" }),
      player({ userId: "nearer", longitude: 6, latitude: 3 }),
      player({
        userId: "npc",
        isNpc: true,
        npcPlacementId: "npc",
        npcInteractionType: "FRIENDLY",
      }),
      player({
        userId: "fighter",
        longitude: 10,
        latitude: 10,
        status: "BATTLE",
        battleId: "battle",
      }),
    ];
    const questViewer = {
      ...viewer,
      userQuests: [
        {
          quest: {
            id: "quest",
            content: {
              objectives: [
                {
                  id: "goal",
                  task: "move_to_location",
                  sector: 724,
                  longitude: 7,
                  latitude: 7,
                  image: "depth-quest.png",
                },
              ],
            },
          },
        },
      ],
      questData: [{ id: "quest", goals: [{ id: "goal", done: false }] }],
    } as unknown as UserWithRelations;
    const snapshot = { ...snapshotFixture(), grid, users, viewer: questViewer };
    actors.sync(snapshot);
    actors.animate(frame());
    await settle();
    const other = actors.container.children.find(
      (child) => child.label === "user:other",
    )!;
    const nearer = actors.container.children.find(
      (child) => child.label === "user:nearer",
    )!;
    const control = other.children
      .at(-1)!
      .children.find((child) => child.label === "info")!;
    actors.hover("user:other");
    expect(control.visible).toBe(true);
    expect(control.parentRenderLayer).toBe(overlay);
    for (const kind of ["attack", "heal", "info"])
      expect(
        other.children.at(-1)!.children.find((child) => child.label === kind)!
          .parentRenderLayer,
      ).toBe(overlay);
    expect(control.parent?.parent).toBe(other);
    expect(
      actors.container.children.find((child) => child.label === "battle:battle")!
        .parentRenderLayer,
    ).toBe(overlay);
    expect(
      actors.container.children.find((child) => child.label === "quest:goal")!
        .parentRenderLayer,
    ).toBe(overlay);
    const talk = actors.container.children
      .find((child) => child.label === "npc:npc:0:0")!
      .children.at(-1)!
      .children.find((child) => child.label === "talk")!;
    expect(talk.parentRenderLayer).toBe(overlay);
    const point = control.getGlobalPosition();
    point.y += control.getBounds().height * 0.4;
    // A foreground actor's upper body overlaps the lower edge of the profile control.
    const body = nearer.children
      .at(-1)!
      .children.find((child) => child.label === "avatar")!;
    const bodyPoint = body.getGlobalPosition();
    nearer.x += (point.x - bodyPoint.x) / world.scale.x;
    nearer.y = other.y - grid.getHex({ col: 4, row: 4 })!.height * 0.05;
    expect(actors.container.getChildIndex(nearer)).toBeGreaterThan(
      actors.container.getChildIndex(other),
    );
    expect(body.getBounds().containsPoint(point.x, point.y)).toBe(true);
    expect(actors.hit(point.x, point.y)).toMatchObject({
      userId: "other",
      type: "info",
    });
    other.visible = false;
    expect(actors.hit(point.x, point.y)?.userId).not.toBe("other");
    other.visible = true;
    actors.hover(null);
    expect(control.visible).toBe(false);
    snapshot.users = [
      player({ userId: "one" }),
      player({ userId: "two" }),
      player({ userId: "three" }),
    ];
    actors.sync(snapshot);
    actors.animate(frame());
    await settle();
    const counter = actors.container.children.find((child) =>
      child.label.startsWith("count:"),
    )!;
    expect(counter.parentRenderLayer).toBe(overlay);
    const physical = actors.container.children.filter((child) =>
      child.label.startsWith("user:"),
    );
    expect(physical.every((child) => child.parentRenderLayer === depth)).toBe(true);
    expect(
      physical.every(
        (child) =>
          Math.abs(
            child.zIndex +
              child.y +
              grid.getHex({ col: 4, row: 4 })!.height * (0.1 + (1.8 * 0.7 * 4) / 64),
          ) < 0.0001,
      ),
    ).toBe(true);
    actors.setViewport({
      minX: -100_000,
      maxX: -99_999,
      minY: -100_000,
      maxY: -99_999,
    });
    expect(counter.destroyed).toBe(true);
    expect(overlay.renderLayerChildren).not.toContain(counter);
    expect(
      physical.every(
        (child) => child.destroyed && !depth.renderLayerChildren.includes(child),
      ),
    ).toBe(true);
  });
});

describe("travel scene window updates", () => {
  it("invalidates each installed neighbor while later scenery is still loading", async () => {
    const state = snapshotFixture();
    state.users = [];
    const { scene, game } = await sceneFixture(state);
    const ready = windowEntry(725, 1),
      held = windowEntry(726, 2);
    ready.structures[0]!.image = "ready-still-neighbor.png";
    held.structures[0]!.image = "held-still-neighbor.png";
    const { promise: pending, resolve: release } = deferred<Texture>();
    vi.spyOn(Assets, "load").mockImplementation(async (input) =>
      JSON.stringify(input).includes("held-still-neighbor") ? pending : Texture.WHITE,
    );
    const invalidate = game.invalidate as ReturnType<typeof vi.fn>;
    invalidate.mockClear();
    state.window.push(ready, held);
    const updating = scene.updateWindow();
    // Window requests are coalesced briefly before the first neighbor is built.
    for (let i = 0; i < 40 && !scene.sectors.has(725); i++)
      await new Promise((resolve) => setTimeout(resolve, 5));
    expect(scene.sectors.has(725)).toBe(true);
    await updating;
    expect(scene.sectors.has(726)).toBe(true);
    expect(scene.sectors.get(726)!.art.entries).toHaveLength(0);
    expect(invalidate).toHaveBeenCalled();
    release(Texture.WHITE);
    await updating;
    await settle();
    expect(scene.sectors.get(726)!.art.entries.length).toBeGreaterThan(0);
  });

  it.each(["worldArt", "route"] as const)(
    "rebuilds cached terrain and scenery after a structure %s edit",
    async (field) => {
      const state = snapshotFixture();
      state.libraryVersion = `structure-edit-${field}`;
      const structure = state.window[0]!.structures[0]!;
      structure.route = "/bank";
      structure.worldArt = {
        ...Object.values(WORLD_STRUCTURE_ART)[0]!,
        route: structure.route,
        sourceImage: structure.image,
        height: 4,
      };
      const first = await sceneFixture(state);
      const original = first.scene.sectors.get(724)!;
      const originalBuilding = original.art.entries.find(
        (entry) => entry.description.id === structure.id,
      )!.description;
      first.scene.dispose();
      if (field === "worldArt")
        structure.worldArt = { ...structure.worldArt, height: 5 };
      else structure.route = "/hospital";
      const second = await sceneFixture(state);
      const revised = second.scene.sectors.get(724)!;
      expect(revised.data).not.toBe(original.data);
      const revisedBuilding = revised.art.entries.find(
        (entry) => entry.description.id === structure.id,
      )!.description;
      expect(revisedBuilding.size).not.toBe(originalBuilding.size);
      if (field === "route") expect(revisedBuilding.frame).toBeUndefined();
    },
  );

  it("ignores late scenery after a sector replacement", async () => {
    const state = snapshotFixture();
    state.window[0]!.structures[0]!.image = "replaced-pending-building.png";
    const { promise: pending, resolve: release } = deferred<Texture>();
    vi.spyOn(Assets, "load").mockImplementation(async (input) =>
      JSON.stringify(input).includes("replaced-pending-building")
        ? pending
        : Texture.WHITE,
    );
    const { scene } = await sceneFixture(state);
    const previous = scene.sectors.get(724)!;
    expect(previous.art.entries).toHaveLength(0);
    state.window[0]!.structures = [
      { ...state.window[0]!.structures[0]!, image: "replacement-building.png" },
    ];
    await scene.updateWindow();
    await settle();
    const replacement = scene.sectors.get(724)!;
    expect(previous.scope.isDisposed()).toBe(true);
    release(Texture.WHITE);
    await settle();
    expect(scene.sectors.get(724)).toBe(replacement);
    expect(
      replacement.art.entries.find((entry) => entry.description.id === "building")!
        .description.image,
    ).toBe("replacement-building.png");
  });

  it("reuses terrain across navigation while creating fresh scenery and actors", async () => {
    const state = snapshotFixture();
    state.libraryVersion = "navigation-cache";
    const first = await sceneFixture(state);
    const original = first.scene.sectors.get(724)!;
    first.scene.dispose();
    state.users = [player({ userId: "new-arrival" })];
    const second = await sceneFixture(state);
    const restored = second.scene.sectors.get(724)!;
    expect(restored.grid).toBe(original.grid);
    expect(restored.data).toBe(original.data);
    expect(original.terrain.container.destroyed).toBe(true);
    expect(restored.terrain).not.toBe(original.terrain);
    expect(restored.art).not.toBe(original.art);
    expect(
      second.depth.renderLayerChildren.some(
        (child) => child.label === "user:new-arrival",
      ),
    ).toBe(true);
    expect(
      second.depth.renderLayerChildren.some((child) => child.label === "user:self"),
    ).toBe(false);
    second.scene.dispose();
    state.libraryVersion = "edited-navigation-cache";
    const edited = await sceneFixture(state);
    expect(edited.scene.sectors.get(724)!.data).not.toBe(original.data);
  });

  it("evicts terrain outside the bounded nine-sector cache", async () => {
    const state = snapshotFixture();
    state.libraryVersion = "bounded-navigation-cache";
    const first = await sceneFixture(state);
    const data = first.scene.sectors.get(724)!.data;
    first.scene.dispose();
    for (let sector = 1000; sector < 1009; sector++) {
      const next = { ...state, sector, window: [windowEntry(sector)] };
      const loaded = await sceneFixture(next);
      loaded.scene.dispose();
    }
    const restored = await sceneFixture(state);
    expect(restored.scene.sectors.get(724)!.data).not.toBe(data);
  });

  it("keeps a sector installed just before a newer window update interrupts it", async () => {
    const fixture = gameFixture();
    const state = snapshotFixture();
    let scene: Awaited<ReturnType<typeof createTravelScene>> | undefined;
    let interrupted: Promise<void> | undefined;
    scene = await createTravelScene({
      mount: document.createElement("div"),
      signal: fixture.game.signal,
      lightLayout: false,
      getSnapshot: () => ({ ...state }),
      onError: (error) => {
        throw error;
      },
      // An auto travel requests a new window while the previous update yields after installing a sector.
      onReady: () => {
        if (scene?.sectors.has(725) && !interrupted) interrupted = scene.updateWindow();
      },
      onTap: () => {},
      onHover: () => {},
      onZoom: () => {},
      initialZoom: 1,
    });
    fixture.advance();
    await settle();
    state.window.push(windowEntry(725, 1));
    await scene.updateWindow();
    await interrupted;
    const neighbor = scene.sectors.get(725)!;
    expect(neighbor.terrain.container.destroyed).toBe(false);
    await scene.updateWindow();
    expect(scene.sectors.get(725)).toBe(neighbor);
  });
});

describe("travel camera follow and inspection", () => {
  it("damps tracking without replaying the final edge after its motion clock is removed", async () => {
    const { scene, state, world, depth, advance } = await sceneFixture();
    const actor = depth.renderLayerChildren.find(
      (child) => child.label === "user:self",
    )!;
    const start = { x: world.x, y: world.y };
    state.users = [player({ latitude: 6 })];
    state.row = 6;
    state.actorRevision++;
    state.motionSteps = new Map([
      [
        "self",
        {
          from: { sector: 724, x: 4, y: 4 },
          to: { sector: 724, x: 4, y: 6 },
          startedAt: 1000,
          direction: "south",
          facing: 1,
        },
      ],
    ]);
    advance(frame(1000 + SECTOR_WALK_STEP_MS, false));
    const destination = scene.sectors.get(724)!.grid.getHex({ col: 4, row: 6 })!;
    const finalY = Math.round(300 + (-destination.center.y + destination.height / 2));
    expect(actor.y).toBeCloseTo(-destination.center.y);
    expect(Math.abs(world.y - start.y)).toBeLessThan(Math.abs(finalY - start.y));
    expect(world.y).not.toBe(start.y);
    state.motionSteps = undefined;
    let previous = Math.abs(finalY - world.y);
    for (let tick = 0; tick < 120; tick++) {
      advance(frame(1100 + (tick * 1000) / 60, false));
      expect(actor.y).toBeCloseTo(-destination.center.y);
      const distance = Math.abs(finalY - world.y);
      expect(distance).toBeLessThanOrEqual(previous);
      previous = distance;
    }
    expect(world.y).toBe(finalY);
  });

  it("pans without walking, retains inspection across refreshes, and resumes follow on demand", async () => {
    const { scene, state, world, event, advance, onTap } = await sceneFixture(
      undefined,
      2,
    );
    const initial = { x: world.x, y: world.y };
    event("pointerdown", 512, 300);
    event("pointermove", 542, 320);
    advance(frame(1016, false));
    expect(world.x).toBeCloseTo(initial.x + 30);
    expect(world.y).toBeCloseTo(initial.y + 20);
    expect(scene.sectors.get(724)!.art.container.visible).toBe(true);
    event("pointerup", 542, 320);
    expect(onTap).not.toHaveBeenCalled();
    const panned = { x: world.x, y: world.y };
    state.users = [player({ latitude: 5 })];
    state.row = 5;
    state.actorRevision++;
    for (let tick = 0; tick < 30; tick++) advance(frame(1100 + tick * 16, false));
    expect(world.position).toMatchObject(panned);
    scene.recenter();
    advance(frame(1600, false));
    const destination = scene.sectors.get(724)!.grid.getHex({ col: 4, row: 5 })!;
    const targetY =
      300 + world.scale.x * (-destination.center.y + destination.height / 2);
    expect(Math.abs(targetY - world.y)).toBeLessThan(Math.abs(targetY - panned.y));
    expect(world.y).not.toBe(Math.round(targetY));
    advance(frame(1700, true));
    expect(world.y).toBe(Math.round(targetY));
    event("pointerdown", 512, 300);
    event("pointerup", 514, 302);
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it("has the same follow response at 30 and 60 frames per second", async () => {
    const positions: number[] = [];
    for (const fps of [30, 60]) {
      const { state, world, advance } = await sceneFixture();
      state.row = 8;
      for (let tick = 1; tick <= fps / 2; tick++)
        advance({
          now: 1000 + (tick * 1000) / fps,
          delta: 1 / fps,
          reducedMotion: false,
        });
      positions.push(world.y);
    }
    expect(positions[0]).toBe(positions[1]);
  });

  it("bounds manual panning to the rendered window and ignores dragging while interaction is disabled", async () => {
    const { game, state, world, event, advance } = await sceneFixture();
    event("pointerdown", 512, 300);
    event("pointermove", 100_512, 100_300);
    event("pointerup", 100_512, 100_300);
    advance(frame(1016, false));
    expect(world.x).toBe(0);
    const panned = { x: world.x, y: world.y };
    state.enabled = false;
    event("pointerdown", 512, 300);
    event("pointermove", -10_000, -10_000);
    event("pointerup", -10_000, -10_000);
    advance(frame(1032, false));
    expect(world.position).toMatchObject(panned);
    expect(game.canvas.style.cursor).toBe("default");
  });
});
