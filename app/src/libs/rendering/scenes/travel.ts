import alea from "alea";
import type { Grid } from "honeycomb-grid";
import { Container, getMaxFragmentPrecision, RenderLayer } from "pixi.js";
import { SECTOR_WALK_STEP_MS } from "@/drizzle/constants";
import type { MapAsset, VillageStructure } from "@/drizzle/schema";
import type { TerrainHex } from "@/libs/hexgrid";
import { getBackgroundColor } from "@/libs/rendering/biomes";
import { calculateWidth2Height } from "@/libs/rendering/hexGeometry";
import { createMapControls } from "@/libs/rendering/mapControls";
import { createWorldSprites } from "@/libs/rendering/primitives/sprites";
import { createHexTerrain } from "@/libs/rendering/primitives/terrain";
import { createGameRenderer, type GameRenderer } from "@/libs/rendering/runtime";
import {
  createTravelActors,
  type TravelActorHit,
  type TravelActorMovement,
  type TravelActorsSnapshot,
} from "@/libs/rendering/scenes/travelActors";
import { travelSectorKey } from "@/libs/rendering/scenes/travelData";
import { createTravelPath } from "@/libs/rendering/scenes/travelPath";
import { createRenderScope } from "@/libs/rendering/scope";
import { buildSectorTerrainData } from "@/libs/rendering/sectorData";
import { sectorSpriteDescriptions } from "@/libs/rendering/sectorSprites";
import {
  createWaterShelf,
  type HexTerrainData,
  hexTerrainAt,
} from "@/libs/rendering/terrainData";
import { planVillageLandscape } from "@/libs/rendering/villageLandscape";
import { boundsOverlap } from "@/libs/rendering/visibility";
import { hasWorldWaterDepth } from "@/libs/rendering/worldArt";
import { createWorldShadows, worldSunlight } from "@/libs/rendering/worldShadows";
import { sampleWorldWind } from "@/libs/rendering/worldWind";
import type { DecorationAsset } from "@/libs/sector-map/decorations";
import { buildWindowNav, type WindowNav } from "@/libs/sector-map/navigation";
import { prepareSectorGrid } from "@/libs/sector-map/sector-grid";
import type { TerrainSpec } from "@/libs/sector-map/terrains";
import type { NormalizedSectorMap } from "@/libs/sector-map/types";
import type { MapLocation } from "@/validators/mapLocation";

/**
 * Owns retained sector scopes. Initialization awaits only the current sector;
 * call updateWindow after window/library changes to reconcile the remaining sectors.
 */
export const createTravelScene = async (options: {
  mount: HTMLElement;
  signal: AbortSignal;
  lightLayout: boolean;
  getSnapshot: () => TravelSnapshot;
  onError: (error: unknown) => void;
  /** Runs after each new sector installation, including before this factory returns. */
  onReady: () => void;
  onTap: (hit: TravelPick) => void;
  onHover: (structureId: string | null, locationId: string | null) => void;
  onZoom: (zoom: number) => void;
  initialZoom: number;
  resolution?: number;
}) => {
  const logicalWidth = 1024;
  const resolution = options.resolution ?? 1;
  const displayRatio = () => {
    const map = options.getSnapshot().window[0]?.map;
    return map ? calculateWidth2Height(map.width, map.height + 2) : 0.7;
  };
  const game = await createGameRenderer({
    ...options,
    backgroundAlpha: 0.5,
    height: (width) =>
      options.mount.closest('[data-world-expanded="true"]')
        ? window.innerHeight
        : Math.max(width * displayRatio(), Math.min(window.innerHeight * 0.6, 600)),
  });
  try {
    const world = new Container(),
      terrainLayer = new Container(),
      terrainDrawLayer = new RenderLayer(),
      artLayer = new Container(),
      groundArtLayer = new RenderLayer(),
      depthLayer = new RenderLayer({ sortableChildren: true }),
      uiLayer = new RenderLayer();
    // Packed geometry decoding needs highp; mediump devices use the primitives' ambient lighting.
    const shadows =
      getMaxFragmentPrecision() === "highp"
        ? createWorldShadows(game, world)
        : undefined;
    const lightingLayer = shadows?.container ?? new Container();
    const route = createTravelPath(),
      actors = createTravelActors(
        game,
        { ground: groundArtLayer, depth: depthLayer, overlay: uiLayer },
        shadows,
      );
    // Ownership stays with sector scopes; their physical draw layers share one lighting pass.
    lightingLayer.addChild(
      terrainDrawLayer,
      groundArtLayer,
      route.container,
      depthLayer,
    );
    world.addChild(terrainLayer, artLayer, lightingLayer, uiLayer, actors.container);
    game.stage.addChild(world);
    const sectors = new Map<number, TravelSector>();
    const movements = new Map<string, TravelActorMovement>();
    /** Keep draw order global while retained sector scopes continue owning their sprites. */
    const placeArt = (art: TravelSector["art"], position: { x: number; y: number }) => {
      art.attachLayers(
        { ground: groundArtLayer, world: depthLayer, ui: uiLayer },
        position.y,
      );
    };
    const pending = new Set<GameRenderer>();
    let generation = 0,
      disposed = false,
      zoom = options.initialZoom;
    let camera: { x: number; y: number } | null = null;
    let actorsDirty = true,
      lastPath: string | null = null,
      hover = "";
    let lastActorSnapshot: TravelSnapshot | null = null;
    let zoomTimer: ReturnType<typeof setTimeout> | null = null;
    const scale = () => (game.renderer.width / logicalWidth) * zoom;
    const transform = () => {
      const s = scale();
      world.scale.set(s, -s);
      // Move the whole map on backing pixels so nearest-sampled wall joints stay stable.
      world.position.set(
        Math.round((game.renderer.width / 2 - (camera?.x ?? 0) * s) * resolution) /
          resolution,
        Math.round((game.renderer.height / 2 + (camera?.y ?? 0) * s) * resolution) /
          resolution,
      );
    };
    game.setResize(transform);
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
      enabled: () => options.getSnapshot().enabled,
      tap: (x, y) => options.onTap(pick(x, y)),
      zoom: (factor) => {
        zoom = Math.max(0.8, Math.min(3, zoom * factor));
        transform();
        if (zoomTimer !== null) clearTimeout(zoomTimer);
        zoomTimer = setTimeout(() => options.onZoom(zoom), 300);
      },
    });
    const setBackground = (map: NormalizedSectorMap) => {
      game.setBackground(
        getBackgroundColor(map.tiles[0]?.battleBiome ?? "ground").color,
      );
    };
    /**
     * Latest request wins: cancel pending builds, retaining completed sectors until
     * departure, successful replacement or disposal. Initialization requests the current sector only.
     */
    const updateWindow = async (initial = false) => {
      for (const scope of pending) scope.dispose();
      pending.clear();
      const token = ++generation,
        snapshot = options.getSnapshot();
      const center = snapshot.window.find((entry) => entry.dx === 0 && entry.dy === 0);
      if (!center) return;
      const first = sectors.get(center.sector);
      if (!first && sectors.size > 0) camera = null;
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
          );
          const cached = sectors.get(entry.sector);
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
              ),
            },
          ] as const;
        }),
      );
      const nav = hasWaterShelf ? buildWindowNav(snapshot.window, 10) : null;
      const coast = new Map<TerrainHex, { isWater: boolean }>();
      if (nav)
        for (const entry of snapshot.window)
          for (const tile of prepared.get(entry.sector)?.grid ?? []) {
            const unified = nav.toUnified(entry.dx, entry.dy, tile.col, tile.row);
            if (unified) coast.set(unified, { isWater: !!tile.spec?.isWater });
          }
      const shelf = nav ? createWaterShelf(nav.pathFinder.grid, coast) : null;
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
          shelf && unifiedOrigin
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
            : "";
        const key = preparedSector.sourceKey + (shelf ? `water:${shoreKey}` : "");
        const position = {
          x: origin.x + entry.dx * spanX,
          y: origin.y + entry.dy * spanY,
        };
        const existing = sectors.get(entry.sector);
        if (existing?.key === key) {
          existing.position = position;
          existing.terrain.container.position.copyFrom(position);
          existing.art.container.position.copyFrom(position);
          placeArt(existing.art, position);
          continue;
        }
        const scope = createRenderScope(game);
        pending.add(scope);
        try {
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
            ));
          }
          const roads = planVillageLandscape(
            grid,
            entry.structures,
            villageWallPlan,
            entry.sector,
          );
          const descriptions = sectorSpriteDescriptions({
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
          const data = buildSectorTerrainData(grid, prng, options.lightLayout, {
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
          const [terrain, art] = await Promise.all([
            createHexTerrain(scope, data),
            createWorldSprites(scope, descriptions, shadows),
          ]);
          if (disposed || token !== generation) {
            scope.dispose();
            return;
          }
          if (shadows) scope.own(shadows.registerTerrain(terrain.container, data));
          terrain.container.position.copyFrom(position);
          art.container.position.copyFrom(position);
          terrainLayer.addChild(terrain.container);
          // Interleave sector depths while retaining each sector's transform and ownership.
          terrainDrawLayer.attach(...terrain.container.children);
          terrainDrawLayer.sortRenderLayerChildren();
          artLayer.addChild(art.container);
          placeArt(art, position);
          existing?.scope.dispose();
          sectors.set(entry.sector, {
            key,
            sourceKey: preparedSector.sourceKey,
            scope,
            grid,
            data,
            terrain,
            art,
            position,
            height:
              logicalWidth *
              calculateWidth2Height(entry.map.width, entry.map.height + 2),
            margin: (grid.toArray()[0]?.width ?? 50) * 3,
          });
          // A ready callback may reconcile immediately; cancellation must only dispose uninstalled scopes.
          pending.delete(scope);
          actorsDirty = true;
          lastPath = null;
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
    game.own(() => {
      disposed = true;
      generation++;
      if (zoomTimer !== null) clearTimeout(zoomTimer);
    });
    game.setUpdate((frame) => {
      const snapshot = options.getSnapshot(),
        entry = sectors.get(snapshot.sector);
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
      const tile = entry.grid.getHex({ col: snapshot.col, row: snapshot.row });
      if (tile) {
        const movement = movements.get(snapshot.viewer?.userId ?? "");
        const target = {
          x: (movement?.x ?? -tile.center.x) + tile.width / 2 + entry.position.x,
          y: (movement?.y ?? -tile.center.y) + tile.height / 2 + entry.position.y,
        };
        // The actor and camera share the path clock; corrections land without a trailing tween.
        camera = target;
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
      const actorSnapshot: TravelActorsSnapshot = { ...snapshot, grid: entry.grid };
      if (
        actorsDirty ||
        !lastActorSnapshot ||
        snapshot.actorRevision !== lastActorSnapshot.actorRevision ||
        snapshot.sector !== lastActorSnapshot.sector ||
        snapshot.viewer !== lastActorSnapshot.viewer ||
        snapshot.showUsers !== lastActorSnapshot.showUsers ||
        snapshot.minBracket !== lastActorSnapshot.minBracket ||
        snapshot.friendlyAttack !== lastActorSnapshot.friendlyAttack ||
        snapshot.structureObjectiveIds !== lastActorSnapshot.structureObjectiveIds
      ) {
        actorsDirty = false;
        lastActorSnapshot = snapshot;
        actors.sync(actorSnapshot);
      }
      actors.animate(frame, movements);
      const breeze = sampleWorldWind(frame, scale());
      const viewport = camera
        ? {
            minX: camera.x - halfWidth,
            maxX: camera.x + halfWidth,
            minY: camera.y - halfHeight,
            maxY: camera.y + halfHeight,
          }
        : null;
      for (const rendered of sectors.values()) {
        const bounds = {
          minX: rendered.position.x,
          maxX: rendered.position.x + logicalWidth,
          minY: rendered.position.y,
          maxY: rendered.position.y + rendered.height,
        };
        const visible = !viewport || boundsOverlap(bounds, viewport, rendered.margin);
        rendered.art.container.renderable = visible;
        // Terrain needs only one tile of edge clearance; tall scenery retains its wider margin.
        rendered.terrain.container.renderable =
          !viewport || boundsOverlap(bounds, viewport, rendered.margin / 3);
        if (visible) {
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
          rendered.art.animate(frame, scale(), null, breeze);
        }
      }
      const pointer = controls.pointer();
      let hoverTile: TravelPick["tile"] = null;
      if (!pointer || !snapshot.enabled) {
        actors.hover(null);
      } else {
        const hit = pick(pointer.x, pointer.y);
        hoverTile = hit.tile;
        actors.hover(hit.actor?.key ?? null);
        const hoverKey = `${hit.structureId}:${hit.locationId}`;
        if (hoverKey !== hover) {
          hover = hoverKey;
          options.onHover(hit.structureId, hit.locationId);
        }
        if (document.body.style.cursor !== "wait")
          game.canvas.style.cursor =
            hit.actor || hit.locationId || hit.structureId ? "pointer" : "default";
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
      // Physical lighting excludes the canvas UI and the actors' identity markers.
      game.canvas.style.filter = "none";
      if (shadows) {
        if (viewport)
          shadows.update(worldSunlight(snapshot.lightDate), viewport, breeze);
      } else {
        for (const rendered of sectors.values()) {
          rendered.terrain.setLighting(snapshot.brightness);
          rendered.art.setLighting(snapshot.brightness);
        }
        actors.setLighting(snapshot.brightness);
      }
    });
    await updateWindow(true);
    return {
      dispose: game.dispose,
      sectors,
      updateWindow,
      setBackground,
      clearHighlights: () => {
        lastPath = null;
        route.set([], 0);
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
  brightness: number;
  motionSteps?: ReadonlyMap<
    string,
    import("@/libs/rendering/scenes/travelActors").TravelMotionStep
  >;
  /** Server-corrected cycle clock; null disables cycle-dependent directional lighting. */
  lightDate?: Date | null;
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
};
