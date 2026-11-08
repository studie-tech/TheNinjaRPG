import alea from "alea";
import type { Grid } from "honeycomb-grid";
import { Container, RenderLayer } from "pixi.js";
import { SECTOR_WALK_STEP_MS } from "@/drizzle/constants";
import type { MapAsset, VillageStructure } from "@/drizzle/schema";
import type { TerrainHex } from "@/libs/hexgrid";
import { hexGridHeightRatio } from "@/libs/hexgrid";
import type { LpcCatalog } from "@/libs/lpc/catalog";
import { type WanderTile, wanderPose, wanderSpots } from "@/libs/overworldWander";
import { createBakedVillageLighting } from "@/libs/rendering/bakedVillageLighting";
import { getBackgroundColor } from "@/libs/rendering/biomes";
import { createMapControls } from "@/libs/rendering/mapControls";
import { createWorldSprites } from "@/libs/rendering/primitives/sprites";
import { createHexTerrain } from "@/libs/rendering/primitives/terrain";
import { createProjectedWorldLighting } from "@/libs/rendering/projectedWorldLighting";
import { createGameRenderer, type GameRenderer } from "@/libs/rendering/runtime";
import {
  createTravelActors,
  type TravelActorHit,
  type TravelActorMovement,
  type TravelActorsSnapshot,
  travelActorKey,
} from "@/libs/rendering/scenes/travelActors";
import { travelSectorKey } from "@/libs/rendering/scenes/travelData";
import { createTravelPath } from "@/libs/rendering/scenes/travelPath";
import { createRenderScope } from "@/libs/rendering/scope";
import { buildSectorTerrainData } from "@/libs/rendering/sectorData";
import {
  sectorSpriteDescriptions,
  type WorldSpriteDescription,
} from "@/libs/rendering/sectorSprites";
import {
  createWaterShelf,
  type HexTerrainData,
  hexTerrainAt,
} from "@/libs/rendering/terrainData";
import { planVillageLandscape } from "@/libs/rendering/villageLandscape";
import { boundsOverlap, type WorldBounds } from "@/libs/rendering/visibility";
import { hasWorldWaterDepth } from "@/libs/rendering/worldArt";
import { worldSunlight } from "@/libs/rendering/worldSunlight";
import {
  createWorldWeather,
  getWorldWeather,
  type WorldWeather,
} from "@/libs/rendering/worldWeather";
import {
  MAX_SMALL_WORLD_WIND,
  MAX_WORLD_WIND,
  sampleWorldWind,
} from "@/libs/rendering/worldWind";
import type { DecorationAsset } from "@/libs/sector-map/decorations";
import { WORLD_LANDMARKS } from "@/libs/sector-map/landmarks";
import { buildWindowNav, type WindowNav } from "@/libs/sector-map/navigation";
import { prepareSectorGrid } from "@/libs/sector-map/sector-grid";
import type { TerrainSpec } from "@/libs/sector-map/terrains";
import type { NormalizedSectorMap } from "@/libs/sector-map/types";
import { planVillageWallWindow } from "@/libs/sector-map/village-walls";
import { getBiomeFromTileType } from "@/libs/travel";
import { clamp } from "@/utils/math";
import type { MapLocation } from "@/validators/mapLocation";

/** Scene-owned providers change only at the authored-village boundary, so other crossings retain their window. */
export const travelLightingMode = (sector: number) =>
  sector === WORLD_LANDMARKS.find((village) => village.name === "Akikaze")?.sector
    ? "baked"
    : "projected";

/**
 * Owns retained sector scopes. Initialization awaits the current sector's terrain;
 * scenery loads independently. updateWindow reconciles the remaining sectors and edits.
 */
export const createTravelScene = async (options: {
  lpcCatalog?: LpcCatalog;
  mount: HTMLElement;
  signal: AbortSignal;
  lightLayout: boolean;
  getSnapshot: () => TravelSnapshot;
  onError: (error: unknown) => void;
  /** Runs when sector terrain is usable, possibly before scenery or this factory finishes. */
  onReady: () => void;
  /** Client coordinates let DOM overlays open beside the tapped artwork. */
  onTap: (hit: TravelPick, client: { x: number; y: number }) => void;
  onHover: (structureId: string | null, locationId: string | null) => void;
  onZoom: (zoom: number) => void;
  initialZoom: number;
  resolution?: number;
}) => {
  const logicalWidth = 1024;
  const displayRatio = () => {
    const map = options.getSnapshot().window[0]?.map;
    return map ? hexGridHeightRatio(map.width, map.height) : 0.7;
  };
  const game = await createGameRenderer({
    ...options,
    surface: "travel",
    backgroundAlpha: 0.5,
    height: (width) =>
      options.mount.closest('[data-world-expanded="true"]')
        ? window.innerHeight
        : Math.max(width * displayRatio(), Math.min(window.innerHeight * 0.6, 600)),
  });
  const resolution = game.renderer.resolution ?? options.resolution ?? 1;
  game.canvas.style.filter = "none";
  try {
    // The camera moves this group without repacking unchanged descendant transforms.
    const world = new Container({ isRenderGroup: true }),
      terrainLayer = new Container(),
      terrainDrawLayer = new RenderLayer(),
      artLayer = new Container(),
      groundArtLayer = new RenderLayer(),
      actorGroundLayer = new RenderLayer(),
      depthLayer = new RenderLayer(),
      uiLayer = new RenderLayer();
    terrainDrawLayer.label = "travel-terrain";
    groundArtLayer.label = "travel-ground-art";
    actorGroundLayer.label = "travel-actor-ground";
    depthLayer.label = "travel-depth";
    uiLayer.label = "travel-overlay";
    const bakedVillage = travelLightingMode(options.getSnapshot().sector) === "baked";
    const bakedLighting = bakedVillage
      ? createBakedVillageLighting(game, world)
      : undefined;
    const shadows = bakedLighting ?? createProjectedWorldLighting(game, world);
    const lightingLayer = shadows.container;
    const weather = createWorldWeather(game, options.lightLayout);
    const sceneryBounds = new WeakMap<Container, WorldBounds>();
    const route = createTravelPath(),
      actors = createTravelActors(
        game,
        { ground: actorGroundLayer, depth: depthLayer, overlay: uiLayer },
        shadows,
        sceneryBounds,
      );
    game.own(route.dispose);
    // Sector scopes own artwork while terrain, scenery and actors share one lit world.
    lightingLayer.addChild(
      terrainDrawLayer,
      groundArtLayer,
      actorGroundLayer,
      route.container,
      depthLayer,
    );
    world.addChild(
      terrainLayer,
      artLayer,
      lightingLayer,
      weather.container,
      uiLayer,
      actors.container,
    );
    game.stage.addChild(world);
    const sectors = new Map<number, TravelSector>();
    const movements = new Map<string, TravelActorMovement>();
    let sceneryScale = Number.NaN;
    /** Keep draw order global while retained sector scopes continue owning their sprites. */
    const placeArt = (art: TravelSector["art"], position: { x: number; y: number }) => {
      sceneryScale = Number.NaN;
      art.attachLayers(
        { ground: groundArtLayer, world: depthLayer, ui: uiLayer },
        position.y,
      );
      for (const { sprite, bounds, description, character } of art.entries) {
        if (description.motion || character || description.shadowCaster === "character")
          continue;
        const wind =
          description.wind == null
            ? 0
            : description.small
              ? MAX_SMALL_WORLD_WIND
              : MAX_WORLD_WIND;
        // Fixed poses share the culling envelope, translated with their sector and swept by every gust.
        sceneryBounds.set(sprite, {
          minX: bounds.minX + position.x - wind,
          maxX: bounds.maxX + position.x + wind,
          minY: bounds.minY + position.y,
          maxY: bounds.maxY + position.y,
        });
      }
    };
    const pending = new Set<GameRenderer>();
    let currentSceneryReady: Promise<void> = Promise.resolve();
    let generation = 0,
      disposed = false,
      zoom = options.initialZoom;
    let camera: { x: number; y: number } | null = null;
    let hasManualCamera = false;
    let actorsDirty = true,
      lastPath: string | null = null,
      hover = "";
    let lastActorSnapshot: TravelSnapshot | null = null;
    let lastShowAmbient: boolean | undefined;
    const wanderSpotCache = new Map<string, WanderTile[]>();
    let wanderSpotsSector: number | null = null;
    let isStill = false;
    let lastFrameInputs: ReturnType<typeof travelFrameInputs> | null = null;
    let zoomTimer: ReturnType<typeof setTimeout> | null = null;
    const scale = () => (game.renderer.width / logicalWidth) * zoom;
    const transform = (constrain = false) => {
      const s = scale();
      if (constrain && hasManualCamera && camera && sectors.size) {
        const entries = [...sectors.values()];
        const minX = Math.min(...entries.map((entry) => entry.position.x)),
          maxX = Math.max(...entries.map((entry) => entry.position.x + logicalWidth)),
          minY = Math.min(...entries.map((entry) => entry.position.y)),
          maxY = Math.max(...entries.map((entry) => entry.position.y + entry.height));
        const halfWidth = Math.min(game.renderer.width / (2 * s), (maxX - minX) / 2),
          halfHeight = Math.min(game.renderer.height / (2 * s), (maxY - minY) / 2);
        camera.x = clamp(camera.x, minX + halfWidth, maxX - halfWidth);
        camera.y = clamp(camera.y, minY + halfHeight, maxY - halfHeight);
      }
      world.scale.set(s, -s);
      // Move the whole map on backing pixels so nearest-sampled wall joints stay stable.
      world.position.set(
        Math.round((game.renderer.width / 2 - (camera?.x ?? 0) * s) * resolution) /
          resolution,
        Math.round((game.renderer.height / 2 + (camera?.y ?? 0) * s) * resolution) /
          resolution,
      );
    };
    game.setResize(() => transform(true));
    const pick = (x: number, y: number): TravelPick => {
      const snapshot = options.getSnapshot(),
        s = scale();
      const wx = (x - world.position.x) / s;
      const wy = (world.position.y - y) / s;
      let tile: TravelPick["tile"] = null;
      for (const [sector, entry] of sectors) {
        const hit = hexTerrainAt(
          entry.grid,
          entry.data.faceOffsets,
          wx - entry.position.x,
          wy - entry.position.y,
        );
        if (hit) {
          tile = { sector, hex: hit };
          break;
        }
      }
      let structureId: string | null = null,
        locationId: string | null = null;
      const current = sectors.get(snapshot.sector);
      const entries = current?.art.entries ?? [];
      for (let index = entries.length - 1; index >= 0; index--) {
        const entry = entries[index];
        if (!entry?.description.structureId && !entry?.description.locationId) continue;
        if (entry.sprite.getBounds().containsPoint(x, y)) {
          structureId ??= entry.description.structureId ?? null;
          locationId ??= entry.description.locationId ?? null;
        }
      }
      return { tile, structureId, locationId, actor: actors.hit(x, y) };
    };
    const controls = createMapControls(game, {
      enabled: () => {
        const snapshot = options.getSnapshot();
        return snapshot.enabled && sectors.has(snapshot.sector);
      },
      tap: (x, y, client) => options.onTap(pick(x, y), client),
      pan: (dx, dy) => {
        if (!camera) return;
        hasManualCamera = true;
        camera.x -= dx / scale();
        camera.y += dy / scale();
        transform(true);
      },
      zoom: (factor) => {
        zoom = Math.max(0.8, Math.min(3, zoom * factor));
        transform(true);
        if (zoomTimer !== null) clearTimeout(zoomTimer);
        zoomTimer = setTimeout(() => options.onZoom(zoom), 300);
      },
    });
    const setBackground = (map: NormalizedSectorMap) => {
      game.setBackground(
        getBackgroundColor(map.tiles[0]?.battleBiome ?? "ground").color,
      );
    };
    // Account refreshes do not change water topology; retain its grid and per-sector signatures together.
    let shoreline: {
      key: string;
      nav: ReturnType<typeof buildWindowNav>;
      coast: Map<TerrainHex, { isWater: boolean }>;
      shelf: ReturnType<typeof createWaterShelf> | null;
      keys: Map<number, string>;
    } | null = null;
    /** Latest request wins; completed sectors remain usable until departure or successful replacement. */
    const updateWindow = async (initial = false) => {
      for (const scope of pending) scope.dispose();
      pending.clear();
      const token = ++generation,
        snapshot = options.getSnapshot();
      const center = snapshot.window.find((entry) => entry.dx === 0 && entry.dy === 0);
      if (!center) return;
      const first = sectors.get(center.sector);
      if (!first && sectors.size > 0) {
        camera = null;
        hasManualCamera = false;
      }
      const mapWidth = center.map.width,
        mapHeight = center.map.height;
      const hexWidth = logicalWidth / (mapWidth - 0.25 * (mapWidth - 1));
      const spanX = mapWidth * hexWidth * 0.75,
        spanY = mapHeight * hexWidth * 0.5;
      const anchor = first?.position ?? { x: 0, y: 0 };
      // Bound coordinate growth after long journeys; shift the camera with the world.
      const rebase = Math.abs(anchor.x) > spanX * 60 || Math.abs(anchor.y) > spanY * 60;
      if (rebase && camera) {
        camera.x -= anchor.x;
        camera.y -= anchor.y;
      }
      const origin = rebase ? { x: 0, y: 0 } : anchor;
      const wanted = new Map(snapshot.window.map((entry) => [entry.sector, entry]));
      for (const [id, entry] of sectors)
        if (!wanted.has(id)) {
          entry.scope.dispose();
          sectors.delete(id);
        }
      // Load the current sector first, then neighbors. Each completed sector is immediately usable.
      const ordered = snapshot.window
        .filter((entry) => !initial || entry.sector === snapshot.sector)
        .sort(
          (a, b) =>
            Number(b.sector === snapshot.sector) - Number(a.sector === snapshot.sector),
        );
      const wallPlans = planVillageWallWindow(snapshot.window);
      // A shared shoreline field spans the same aligned grid as travel, without changing its navigation.
      const hasWaterShelf =
        !options.lightLayout &&
        hasWorldWaterDepth(snapshot.terrains.get("ocean")) &&
        snapshot.window.some(
          (entry) =>
            entry.globalTileType === 0 ||
            entry.map.tiles.some((tile) => tile.terrain === "ocean"),
        );
      const prepared = new Map<
        number,
        {
          sourceKey: string;
          grid: Grid<TerrainHex>;
          villageWallPlan: ReturnType<typeof prepareSectorGrid>["villageWallPlan"];
          prng?: () => number;
        }
      >(
        (hasWaterShelf ? snapshot.window : ordered).map((entry) => {
          const sourceKey = travelSectorKey(
            entry,
            snapshot.libraryVersion,
            options.lightLayout,
            snapshot.locations.filter((location) => location.sector === entry.sector),
            wallPlans.get(entry.sector)?.foundationKeys,
          );
          const cached =
            sectors.get(entry.sector) ?? cachedSectorData.get(entry.sector);
          if (cached?.sourceKey === sourceKey)
            return [
              entry.sector,
              { sourceKey, grid: cached.grid, villageWallPlan: null, prng: undefined },
            ] as const;
          const prng = alea(entry.sector + 1);
          return [
            entry.sector,
            {
              sourceKey,
              prng,
              ...prepareSectorGrid(
                logicalWidth,
                prng,
                entry.globalTileType,
                entry.structures,
                entry.map,
                snapshot.terrains,
                entry.villageType,
                wallPlans.get(entry.sector) ?? null,
              ),
            },
          ] as const;
        }),
      );
      const shorelineKey = JSON.stringify([
        hasWaterShelf,
        snapshot.window.map((entry) => [
          entry.sector,
          entry.dx,
          entry.dy,
          prepared.get(entry.sector)?.sourceKey,
        ]),
      ]);
      if (!shoreline || shoreline.key !== shorelineKey) {
        const nav = hasWaterShelf
          ? (snapshot.nav ?? buildWindowNav(snapshot.window, 10))
          : null;
        const coast = new Map<TerrainHex, { isWater: boolean }>();
        if (nav)
          for (const entry of snapshot.window)
            for (const tile of prepared.get(entry.sector)?.grid ?? []) {
              const unified = nav.toUnified(entry.dx, entry.dy, tile.col, tile.row);
              if (unified) coast.set(unified, { isWater: !!tile.spec?.isWater });
            }
        const shelf = nav ? createWaterShelf(nav.pathFinder.grid, coast) : null;
        shoreline = { key: shorelineKey, nav, coast, shelf, keys: new Map() };
      }
      const { nav, coast, shelf } = shoreline;
      for (const entry of ordered) {
        if (disposed || token !== generation) return;
        const locations = snapshot.locations.filter(
          (location) => location.sector === entry.sector,
        );
        const preparedSector = prepared.get(entry.sector);
        if (!preparedSector) continue;
        let { grid, villageWallPlan, prng } = preparedSector;
        const unifiedOrigin = nav?.toUnified(entry.dx, entry.dy, 0, 0),
          localOrigin = grid.getHex({ col: 0, row: 0 });
        // Only nearby dry cells affect a retained sector's shelf; distant window changes keep its artwork cached.
        const shoreKey =
          shoreline.keys.get(entry.sector) ??
          (shelf && unifiedOrigin
            ? [...coast]
                .filter(
                  ([tile, material]) =>
                    !material.isWater &&
                    tile.col >= unifiedOrigin.col - 4 &&
                    tile.col < unifiedOrigin.col + entry.map.width + 4 &&
                    tile.row >= unifiedOrigin.row - 4 &&
                    tile.row < unifiedOrigin.row + entry.map.height + 4,
                )
                .map(
                  ([tile]) =>
                    `${tile.col - unifiedOrigin.col},${tile.row - unifiedOrigin.row}`,
                )
                .sort()
                .join(";")
            : "");
        shoreline.keys.set(entry.sector, shoreKey);
        const key = preparedSector.sourceKey + (shelf ? `water:${shoreKey}` : "");
        const position = {
          x: origin.x + entry.dx * spanX,
          y: origin.y + entry.dy * spanY,
        };
        if (entry.sector === snapshot.sector)
          void bakedLighting?.preloadField(preparedSector.sourceKey, position);
        if (disposed || token !== generation) return;
        const existing = sectors.get(entry.sector);
        if (existing?.key === key) {
          existing.position = position;
          existing.terrain.container.position.copyFrom(position);
          existing.art.container.position.copyFrom(position);
          placeArt(existing.art, position);
          // A retained neighbor may become occupied before the previous sector finishes its artwork.
          if (entry.sector === snapshot.sector)
            currentSceneryReady = existing.startScenery();
          continue;
        }
        const scope = createRenderScope(game);
        pending.add(scope);
        try {
          const cached = cachedSectorData.get(entry.sector);
          let descriptions: WorldSpriteDescription[];
          let data: HexTerrainData;
          if (cached?.key === key) {
            descriptions = cached.descriptions;
            data = cached.data;
          } else {
            if (!prng) {
              prng = alea(entry.sector + 1);
              ({ grid, villageWallPlan } = prepareSectorGrid(
                logicalWidth,
                prng,
                entry.globalTileType,
                entry.structures,
                entry.map,
                snapshot.terrains,
                entry.villageType,
                wallPlans.get(entry.sector) ?? null,
              ));
            }
            const roads = planVillageLandscape(grid, entry.structures, villageWallPlan);
            descriptions = sectorSpriteDescriptions({
              map: entry.map,
              grid,
              structures: entry.structures,
              decorations: snapshot.decorations,
              wall: villageWallPlan,
              lightLayout: options.lightLayout,
              locations,
              mapAssets: snapshot.mapAssets,
              roads,
            });
            data = buildSectorTerrainData(grid, prng, options.lightLayout, {
              sector: entry.sector,
              sprites: descriptions,
              wall: villageWallPlan,
              roads,
              waterDepthAt:
                shelf && unifiedOrigin && localOrigin
                  ? (point) =>
                      shelf({
                        x:
                          unifiedOrigin.x +
                          ((point.x - localOrigin.x) * unifiedOrigin.width) /
                            localOrigin.width,
                        y:
                          unifiedOrigin.y +
                          ((point.y - localOrigin.y) * unifiedOrigin.height) /
                            localOrigin.height,
                      })
                  : undefined,
            });
          }
          // Retain only CPU scenery data across navigation; each scene owns its GPU resources.
          cachedSectorData.delete(entry.sector);
          cachedSectorData.set(entry.sector, {
            key,
            sourceKey: preparedSector.sourceKey,
            grid,
            data,
            descriptions,
          });
          while (cachedSectorData.size > 9) {
            const oldest = cachedSectorData.keys().next().value;
            if (oldest === undefined) break;
            cachedSectorData.delete(oldest);
          }
          // Artwork and material maps must not hold walking or live actors behind a loading screen.
          const loadScenery = () => {
            if (scope.isDisposed())
              return Promise.resolve({
                error: new DOMException("Scenery cancelled", "AbortError"),
              });
            return createWorldSprites(scope, descriptions, shadows, true).then(
              (art) => ({ art }),
              (error: unknown) => ({ error }),
            );
          };
          // One promise races priority completion with occupation, so promotion cannot install art twice.
          let promoteScenery!: () => void;
          const promoted = new Promise<void>((resolve) => {
            promoteScenery = resolve;
          });
          // The occupied sector's artwork gets bandwidth and decoding time before the surrounding window.
          const scenery =
            entry.sector === snapshot.sector
              ? loadScenery()
              : Promise.race([currentSceneryReady, promoted]).then(loadScenery);
          const startScenery = () => {
            promoteScenery();
            return scenery.then(() => {});
          };
          if (entry.sector === snapshot.sector)
            currentSceneryReady = scenery.then(() => {});
          const [terrain, art] = await Promise.all([
            createHexTerrain(scope, data),
            createWorldSprites(scope, [], shadows, true),
          ]);
          if (disposed || token !== generation) {
            scope.dispose();
            return;
          }
          if (!sectors.size && entry.sector === snapshot.sector) {
            const tile = grid.getHex({ col: snapshot.col, row: snapshot.row });
            if (tile)
              camera = {
                x: -tile.center.x + tile.width / 2 + position.x,
                y: -tile.center.y + tile.height / 2 + position.y,
              };
            transform();
            setBackground(entry.map);
          }
          // The lit world supplies ambient color to neutral terrain and scenery together.
          terrain.setLighting(1);
          scope.own(shadows.registerTerrain(terrain.container, data));
          terrain.container.position.copyFrom(position);
          art.container.position.copyFrom(position);
          terrainLayer.addChild(terrain.container);
          // Interleave sector depths while retaining each sector's transform and ownership.
          terrainDrawLayer.attach(...terrain.container.children);
          terrainDrawLayer.sortRenderLayerChildren();
          artLayer.addChild(art.container);
          placeArt(art, position);
          existing?.scope.dispose();
          const installed = {
            key,
            sourceKey: preparedSector.sourceKey,
            scope,
            grid,
            data,
            terrain,
            art,
            startScenery,
            position,
            height:
              logicalWidth * hexGridHeightRatio(entry.map.width, entry.map.height),
            margin: (grid.toArray()[0]?.width ?? 50) * 3,
          };
          sectors.set(entry.sector, installed);
          void scenery
            .then((result) => {
              // Artwork may finish after navigation or a replacement of this sector.
              if (scope.isDisposed() || sectors.get(entry.sector) !== installed) return;
              if ("error" in result) {
                // Terrain and live actors remain usable; the next scene retries the artwork.
                console.warn("Travel scenery unavailable", result.error);
                return;
              }
              installed.art.dispose();
              installed.art = result.art;
              result.art.container.position.copyFrom(installed.position);
              artLayer.addChild(result.art.container);
              placeArt(result.art, installed.position);
              game.invalidate();
            })
            .catch((error: unknown) => {
              if (!scope.isDisposed()) options.onError(error);
            });
          // A ready callback may reconcile immediately; cancellation must only dispose uninstalled scopes.
          pending.delete(scope);
          actorsDirty = true;
          lastPath = null;
          game.invalidate();
          options.onReady();
          // Yield between sectors so input and already-loaded scenery can render.
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        } catch (error) {
          scope.dispose();
          if (!disposed && token === generation) throw error;
        } finally {
          pending.delete(scope);
        }
      }
      const activeMap = options
        .getSnapshot()
        .window.find((entry) => entry.sector === options.getSnapshot().sector)?.map;
      if (activeMap) setBackground(activeMap);
    };
    // Presence and movement arrive through refs; poll their identities without redrawing an idle unlit map.
    const snapshotTimer = setInterval(() => {
      if (disposed || !isStill) return;
      try {
        const inputs = travelFrameInputs(options.getSnapshot());
        if (inputs.some((input, index) => input !== lastFrameInputs?.[index]))
          game.invalidate();
      } catch (error) {
        game.dispose();
        options.onError(error);
      }
    }, 100);
    game.own(() => {
      disposed = true;
      generation++;
      clearInterval(snapshotTimer);
      if (zoomTimer !== null) clearTimeout(zoomTimer);
    });
    game.setUpdate((sourceFrame) => {
      const frame = game.visualEffects.spriteAnimations
        ? sourceFrame
        : { ...sourceFrame, reducedMotion: true };
      const snapshot = options.getSnapshot(),
        entry = sectors.get(snapshot.sector);
      const isPreparing = snapshot.viewer?.status === "TRAVEL";
      isStill =
        isPreparing ||
        (frame.reducedMotion &&
          (sourceFrame.reducedMotion ||
            (!game.visualEffects.weather && !game.visualEffects.wind)) &&
          !game.visualEffects.sunlight &&
          !game.visualEffects.dayNight &&
          !game.visualEffects.localLights);
      game.setAnimating(!isStill);
      lastFrameInputs = travelFrameInputs(snapshot);
      if (isPreparing) return;
      if (!entry) return;
      movements.clear();
      for (const [userId, step] of snapshot.motionSteps ?? []) {
        const from = sectors.get(step.from.sector),
          to = sectors.get(step.to.sector);
        const a = from?.grid.getHex({ col: step.from.x, row: step.from.y });
        const b = to?.grid.getHex({ col: step.to.x, row: step.to.y });
        if (!from || !to || !a || !b) continue;
        const progress = frame.reducedMotion
          ? 1
          : Math.max(
              0,
              Math.min(1, (frame.now - step.startedAt) / SECTOR_WALK_STEP_MS),
            );
        const ax = -a.center.x + from.position.x,
          ay = -a.center.y + from.position.y;
        movements.set(userId, {
          x: ax + (-b.center.x + to.position.x - ax) * progress - entry.position.x,
          y: ay + (-b.center.y + to.position.y - ay) * progress - entry.position.y,
          direction: progress < 1 ? step.direction : null,
          facing: step.facing,
        });
      }
      // Roaming NPCs follow the shared wander timeline on the server-corrected clock.
      const wanderMap = snapshot.window.find((w) => w.sector === snapshot.sector)?.map;
      if (wanderMap && wanderSpotsSector !== snapshot.sector) {
        wanderSpotsSector = snapshot.sector;
        wanderSpotCache.clear();
      }
      const clock = snapshot.weatherTime ?? Date.now();
      for (const user of wanderMap ? snapshot.users : []) {
        const wander = user.npcWander;
        if (!wander || !wanderMap) continue;
        const key = `${wander.seed}:${wander.radius}:${wander.wildOnly}`;
        let spots = wanderSpotCache.get(key);
        if (!spots) {
          spots = wanderSpots(wanderMap, wander.anchor, wander.radius, wander.wildOnly);
          wanderSpotCache.set(key, spots);
        }
        const pose = wanderPose({ ...wander, spots }, user.npcMember ?? 0, clock);
        const point = (tile: WanderTile, offset: WanderTile) => {
          const hex = entry.grid.getHex({ col: tile.x, row: tile.y });
          return hex
            ? {
                x: -hex.center.x + offset.x * hex.width,
                y: -hex.center.y + offset.y * hex.height,
              }
            : null;
        };
        const from = point(pose.from, pose.fromOffset),
          to = point(pose.to, pose.toOffset);
        if (!from || !to) continue;
        const via = pose.via ? point(pose.via, { x: 0, y: 0 }) : null;
        const progress = frame.reducedMotion
          ? Math.round(pose.progress)
          : pose.progress;
        const at = alongWalk(from, via, to, progress);
        movements.set(travelActorKey(user), {
          x: at.x,
          y: at.y,
          direction: pose.moving && !frame.reducedMotion ? "horizontal" : null,
          facing: to.x < from.x ? 1 : -1,
        });
      }
      const tile = entry.grid.getHex({ col: snapshot.col, row: snapshot.row });
      if (tile) {
        const movement = movements.get(snapshot.viewer?.userId ?? "");
        const target = {
          x: (movement?.x ?? -tile.center.x) + tile.width / 2 + entry.position.x,
          y: (movement?.y ?? -tile.center.y) + tile.height / 2 + entry.position.y,
        };
        if (!camera) camera = target;
        else if (!hasManualCamera) {
          // Exponential follow has the same response at every frame rate; reduced motion centers immediately.
          const blend = frame.reducedMotion ? 1 : -Math.expm1(-8 * frame.delta);
          camera.x += (target.x - camera.x) * blend;
          camera.y += (target.y - camera.y) * blend;
          if (Math.hypot(target.x - camera.x, target.y - camera.y) * scale() < 0.1)
            camera = target;
        }
      }
      transform();
      actors.container.position.copyFrom(entry.position);
      const halfWidth = game.renderer.width / (2 * scale());
      const halfHeight = game.renderer.height / (2 * scale());
      // Actor culling uses sector-local world coordinates, independent of camera zoom and sector offset.
      if (camera)
        actors.setViewport({
          minX: camera.x - halfWidth - entry.position.x,
          maxX: camera.x + halfWidth - entry.position.x,
          minY: camera.y - halfHeight - entry.position.y,
          maxY: camera.y + halfHeight - entry.position.y,
        });
      const actorSnapshot: TravelActorsSnapshot = {
        ...snapshot,
        grid: entry.grid,
        showAmbient: game.visualEffects.wildlife,
      };
      if (
        actorsDirty ||
        !lastActorSnapshot ||
        snapshot.actorRevision !== lastActorSnapshot.actorRevision ||
        snapshot.sector !== lastActorSnapshot.sector ||
        snapshot.viewer !== lastActorSnapshot.viewer ||
        snapshot.showUsers !== lastActorSnapshot.showUsers ||
        snapshot.minBracket !== lastActorSnapshot.minBracket ||
        snapshot.friendlyAttack !== lastActorSnapshot.friendlyAttack ||
        snapshot.wars !== lastActorSnapshot.wars ||
        snapshot.structureObjectiveIds !== lastActorSnapshot.structureObjectiveIds ||
        game.visualEffects.wildlife !== lastShowAmbient
      ) {
        actorsDirty = false;
        lastActorSnapshot = snapshot;
        lastShowAmbient = game.visualEffects.wildlife;
        actors.sync(actorSnapshot);
      }
      const breeze = sampleWorldWind(sourceFrame, scale(), game.visualEffects.wind);
      const viewport = camera
        ? {
            minX: camera.x - halfWidth,
            maxX: camera.x + halfWidth,
            minY: camera.y - halfHeight,
            maxY: camera.y + halfHeight,
          }
        : null;
      const refreshDetails = sceneryScale !== scale();
      for (const rendered of sectors.values()) {
        const bounds = {
          minX: rendered.position.x,
          maxX: rendered.position.x + logicalWidth,
          minY: rendered.position.y,
          maxY: rendered.position.y + rendered.height,
        };
        const visible = !viewport || boundsOverlap(bounds, viewport, rendered.margin);
        rendered.art.setRenderable(visible);
        // Terrain needs only one tile of edge clearance; tall scenery retains its wider margin.
        rendered.terrain.container.renderable =
          !viewport || boundsOverlap(bounds, viewport, rendered.margin / 3);
        if (camera)
          rendered.art.setViewport(
            {
              minX: camera.x - halfWidth - rendered.position.x,
              maxX: camera.x + halfWidth - rendered.position.x,
              minY: camera.y - halfHeight - rendered.position.y,
              maxY: camera.y + halfHeight - rendered.position.y,
            },
            Math.max(6, game.renderer.width * 0.0035) / scale(),
          );
        if (visible || refreshDetails)
          rendered.art.animate(frame, scale(), null, breeze);
      }
      // Zoom can reclassify foreground scenery before actor contact order is resolved.
      actors.animate(frame, movements);
      sceneryScale = scale();
      const pointer = controls.pointer();
      let hoverTile: TravelPick["tile"] = null;
      if (!pointer || !snapshot.enabled || controls.dragging()) {
        actors.hover(null);
        if (hover !== "") {
          hover = "";
          options.onHover(null, null);
        }
        const cursor = controls.dragging() ? "grabbing" : "default";
        if (game.canvas.style.cursor !== cursor) game.canvas.style.cursor = cursor;
      } else {
        const hit = pick(pointer.x, pointer.y);
        hoverTile = hit.tile;
        actors.hover(hit.actor?.key ?? null);
        const hoverKey = `${hit.structureId}:${hit.locationId}`;
        if (hoverKey !== hover) {
          hover = hoverKey;
          options.onHover(hit.structureId, hit.locationId);
        }
        if (document.body.style.cursor !== "wait") {
          const cursor =
            hit.actor || hit.locationId || hit.structureId ? "pointer" : "default";
          if (game.canvas.style.cursor !== cursor) game.canvas.style.cursor = cursor;
        }
      }
      const selected = snapshot.routeTarget;
      const selectedTile =
        selected &&
        sectors.get(selected.sector)?.grid.getHex({
          col: selected.x,
          row: selected.y,
        });
      const isTravelling =
        selected &&
        (selected.sector !== snapshot.sector ||
          selected.x !== snapshot.col ||
          selected.y !== snapshot.row ||
          movements.has(snapshot.viewer?.userId ?? ""));
      const goal = !snapshot.enabled
        ? null
        : isTravelling && selectedTile
          ? { sector: selected.sector, hex: selectedTile }
          : hoverTile;
      const nav = snapshot.nav;
      const key =
        goal && !goal.hex.blocked
          ? `${snapshot.sector}:${snapshot.col},${snapshot.row}:${goal.sector}:${goal.hex.col},${goal.hex.row}:${generation}`
          : "";
      if (key !== lastPath) {
        lastPath = key;
        const points: { x: number; y: number }[] = [];
        const startEntry = snapshot.window.find(
          (candidate) => candidate.sector === snapshot.sector,
        );
        const goalEntry = snapshot.window.find(
          (candidate) => candidate.sector === goal?.sector,
        );
        const start =
          startEntry &&
          nav?.toUnified(startEntry.dx, startEntry.dy, snapshot.col, snapshot.row);
        const end =
          goalEntry &&
          goal &&
          nav?.toUnified(goalEntry.dx, goalEntry.dy, goal.hex.col, goal.hex.row);
        const path =
          key && start && end ? nav?.pathFinder.getShortestPath(start, end) : null;
        if (path && nav)
          for (const hex of path) {
            const local = nav.fromUnified(hex);
            const targetSector = snapshot.window.find(
              (candidate) => candidate.dx === local.dx && candidate.dy === local.dy,
            );
            const rendered = targetSector && sectors.get(targetSector.sector);
            const target = rendered?.grid.getHex({ col: local.col, row: local.row });
            if (!rendered || !target) {
              points.length = 0;
              break;
            }
            const offset =
              rendered.data.faceOffsets.get(`${target.col},${target.row}`) ?? 0;
            points.push({
              x: -target.center.x + target.width * 0.5 + rendered.position.x,
              y: -target.center.y + target.height * 0.5 + offset + rendered.position.y,
            });
          }
        route.set(points, tile?.width ?? 50);
      }
      route.animate(frame, actors.feet(snapshot.viewer?.userId ?? ""), scale());
      weather.update(
        sourceFrame,
        snapshot.weather ??
          getWorldWeather(
            getBiomeFromTileType(
              snapshot.window.find((region) => region.sector === snapshot.sector)
                ?.globalTileType ?? 1,
            ),
            snapshot.weatherTime ?? Number.NaN,
          ),
        world.position,
        snapshot.brightness,
        scale(),
      );
      // World lighting excludes the canvas UI and the actors' identity markers.
      bakedLighting?.blendSun(worldSunlight(snapshot.lightDate));
      const sun = worldSunlight(snapshot.lightDate, 60_000);
      if (viewport) shadows.update(sun, viewport, breeze);
      actors.setSun(
        game.visualEffects.sunlight && game.visualEffects.shadows && !bakedLighting
          ? sun
          : null,
      );
      for (const rendered of sectors.values()) {
        rendered.art.setLighting(snapshot.brightness);
      }
      actors.setLighting(snapshot.brightness);
    });
    await updateWindow(true);
    return {
      dispose: game.dispose,
      sectors,
      updateWindow,
      setBackground,
      /** Resume smooth character tracking after inspecting the map with a drag. */
      recenter: () => {
        hasManualCamera = false;
        game.invalidate();
      },
      clearHighlights: () => {
        lastPath = null;
        route.set([], 0);
        game.invalidate();
      },
    };
  } catch (error) {
    game.dispose();
    throw error;
  }
};
export type TravelWindowEntry = {
  sector: number;
  dx: number;
  dy: number;
  map: NormalizedSectorMap;
  structures: VillageStructure[];
  villageType: string | null;
  globalTileType: number;
};
export type TravelSnapshot = Omit<TravelActorsSnapshot, "grid"> & {
  /** Increment for user/presence changes; users-array identity alone does not reconcile actors. */
  actorRevision: number;
  window: TravelWindowEntry[];
  nav: WindowNav | null;
  col: number;
  row: number;
  enabled: boolean;
  /** Committed destination takes precedence over hover while the journey is in progress. */
  routeTarget?: { sector: number; x: number; y: number } | null;
  /** Ungated world-clock brightness; ambient and contact-shadow consumers apply their own preference. */
  brightness: number;
  motionSteps?: ReadonlyMap<
    string,
    import("@/libs/rendering/scenes/travelActors").TravelMotionStep
  >;
  /** Server-corrected cycle clock; null disables cycle-dependent directional lighting. */
  lightDate?: Date | null;
  /** Local visual override; the server-corrected live clock supplies regional weather otherwise. */
  weather?: WorldWeather | null;
  weatherTime?: number;
  decorations: Map<string, DecorationAsset>;
  terrains: Map<string, TerrainSpec>;
  /** Change when terrain, decoration or map-asset content changes to invalidate static artwork. */
  libraryVersion: string;
  locations: MapLocation[];
  mapAssets: Pick<MapAsset, "id" | "imageUrl" | "renderScale">[];
};
export type TravelPick = {
  tile: { sector: number; hex: TerrainHex } | null;
  actor: TravelActorHit | null;
  structureId: string | null;
  locationId: string | null;
};
export type TravelScene = Awaited<ReturnType<typeof createTravelScene>>;
type TravelSector = {
  margin: number;
  height: number;
  key: string;
  sourceKey: string;
  scope: GameRenderer;
  position: { x: number; y: number };
  grid: Grid<TerrainHex>;
  data: HexTerrainData;
  terrain: Awaited<ReturnType<typeof createHexTerrain>>;
  art: Awaited<ReturnType<typeof createWorldSprites>>;
  startScenery: () => Promise<void>;
};

/** Position along a walk, through `via` when the direct line was blocked. */
const alongWalk = (
  from: { x: number; y: number },
  via: { x: number; y: number } | null,
  to: { x: number; y: number },
  progress: number,
) => {
  if (!via)
    return {
      x: from.x + (to.x - from.x) * progress,
      y: from.y + (to.y - from.y) * progress,
    };
  const first = Math.hypot(via.x - from.x, via.y - from.y),
    second = Math.hypot(to.x - via.x, to.y - via.y);
  const along = progress * (first + second);
  if (along <= first || !second) {
    const t = first ? along / first : 1;
    return { x: from.x + (via.x - from.x) * t, y: from.y + (via.y - from.y) * t };
  }
  const t = (along - first) / second;
  return { x: via.x + (to.x - via.x) * t, y: via.y + (to.y - via.y) * t };
};

/** Capture ref-driven changes that need a frame even when decorative animation and lighting are disabled. */
const travelFrameInputs = (snapshot: TravelSnapshot) =>
  [
    snapshot.actorRevision,
    snapshot.sector,
    snapshot.viewer,
    snapshot.users,
    snapshot.col,
    snapshot.row,
    snapshot.window,
    snapshot.showUsers,
    snapshot.minBracket,
    snapshot.friendlyAttack,
    snapshot.wars,
    snapshot.structureObjectiveIds,
    snapshot.nav,
    snapshot.enabled,
    snapshot.brightness,
    snapshot.routeTarget?.sector,
    snapshot.routeTarget?.x,
    snapshot.routeTarget?.y,
  ] as const;

/**
 * Retain CPU terrain and descriptions for up to nine sectors across navigation.
 * Live users and renderer resources stay scene-local; insertion order controls eviction.
 */
const cachedSectorData = new Map<
  number,
  {
    key: string;
    sourceKey: string;
    grid: Grid<TerrainHex>;
    data: HexTerrainData;
    descriptions: WorldSpriteDescription[];
  }
>();
