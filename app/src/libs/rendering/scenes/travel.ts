import alea from "alea";
import type { Grid } from "honeycomb-grid";
import { Container, Graphics, RenderLayer } from "pixi.js";
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
  type TravelActorsSnapshot,
} from "@/libs/rendering/scenes/travelActors";
import { travelSectorKey } from "@/libs/rendering/scenes/travelData";
import { createRenderScope } from "@/libs/rendering/scope";
import { buildSectorTerrainData } from "@/libs/rendering/sectorData";
import { sectorSpriteDescriptions } from "@/libs/rendering/sectorSprites";
import { type HexTerrainData, hexTerrainAt } from "@/libs/rendering/terrainData";
import type { DecorationAsset } from "@/libs/sector-map/decorations";
import type { WindowNav } from "@/libs/sector-map/navigation";
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
}) => {
  const logicalWidth = 1024;
  const displayRatio = () => {
    const map = options.getSnapshot().window[0]?.map;
    return map ? calculateWidth2Height(map.width, map.height + 2) : 0.7;
  };
  const game = await createGameRenderer({
    ...options,
    backgroundAlpha: 0.5,
    height: (width) =>
      Math.max(width * displayRatio(), Math.min(window.innerHeight * 0.6, 600)),
  });
  try {
    const world = new Container(),
      terrainLayer = new Container(),
      terrainDrawLayer = new RenderLayer(),
      artLayer = new Container();
    const highlights = new Graphics(),
      actors = createTravelActors(game);
    world.addChild(
      terrainLayer,
      terrainDrawLayer,
      highlights,
      artLayer,
      actors.container,
    );
    game.stage.addChild(world);
    const sectors = new Map<number, TravelSector>();
    const pending = new Set<GameRenderer>();
    let generation = 0,
      disposed = false,
      zoom = options.initialZoom;
    let camera: { x: number; y: number } | null = null;
    let actorsDirty = true,
      lastPath = "",
      hover = "";
    let lastActorSnapshot: TravelSnapshot | null = null;
    let zoomTimer: ReturnType<typeof setTimeout> | null = null;
    const scale = () => (game.renderer.width / logicalWidth) * zoom;
    const transform = () => {
      const s = scale();
      world.scale.set(s, -s);
      // Move the whole map on backing pixels so nearest-sampled wall joints stay stable.
      world.position.set(
        Math.round(game.renderer.width / 2 - (camera?.x ?? 0) * s),
        Math.round(game.renderer.height / 2 + (camera?.y ?? 0) * s),
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
      for (const entry of ordered) {
        if (disposed || token !== generation) return;
        const locations = snapshot.locations.filter(
          (location) => location.sector === entry.sector,
        );
        const key = travelSectorKey(
          entry,
          snapshot.libraryVersion,
          options.lightLayout,
          locations,
        );
        const position = {
          x: origin.x + entry.dx * spanX,
          y: origin.y + entry.dy * spanY,
        };
        const existing = sectors.get(entry.sector);
        if (existing?.key === key) {
          existing.position = position;
          existing.terrain.container.position.copyFrom(position);
          existing.art.container.position.copyFrom(position);
          continue;
        }
        const scope = createRenderScope(game),
          prng = alea(entry.sector + 1);
        pending.add(scope);
        try {
          const { grid, villageWallPlan } = prepareSectorGrid(
            logicalWidth,
            prng,
            entry.globalTileType,
            entry.structures,
            entry.map,
            snapshot.terrains,
            entry.villageType,
          );
          const data = buildSectorTerrainData(grid, prng, options.lightLayout);
          const [terrain, art] = await Promise.all([
            createHexTerrain(scope, data),
            createWorldSprites(
              scope,
              sectorSpriteDescriptions({
                map: entry.map,
                grid,
                structures: entry.structures,
                decorations: snapshot.decorations,
                wall: villageWallPlan,
                lightLayout: options.lightLayout,
                locations,
                mapAssets: snapshot.mapAssets,
              }),
            ),
          ]);
          if (disposed || token !== generation) {
            scope.dispose();
            return;
          }
          terrain.container.position.copyFrom(position);
          art.container.position.copyFrom(position);
          terrainLayer.addChild(terrain.container);
          // Interleave sector depths while retaining each sector's transform and ownership.
          terrainDrawLayer.attach(...terrain.container.children);
          terrainDrawLayer.sortRenderLayerChildren();
          artLayer.addChild(art.container);
          existing?.scope.dispose();
          sectors.set(entry.sector, {
            key,
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
          actorsDirty = true;
          lastPath = "";
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
      const tile = entry.grid.getHex({ col: snapshot.col, row: snapshot.row });
      if (tile) {
        const target = {
          x: -tile.center.x + tile.width / 2 + entry.position.x,
          y: -tile.center.y + tile.height / 2 + entry.position.y,
        };
        if (!camera) camera = target;
        else {
          const amount = frame.reducedMotion ? 1 : 1 - 0.9 ** (frame.delta * 60);
          camera.x += (target.x - camera.x) * amount;
          camera.y += (target.y - camera.y) * amount;
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
      actors.animate(frame);
      for (const rendered of sectors.values()) {
        const margin = rendered.margin;
        const visible =
          !camera ||
          (rendered.position.x - margin < camera.x + halfWidth &&
            rendered.position.x + logicalWidth + margin > camera.x - halfWidth &&
            rendered.position.y - margin < camera.y + halfHeight &&
            rendered.position.y + rendered.height + margin > camera.y - halfHeight);
        rendered.art.container.renderable = visible;
        rendered.terrain.container.renderable = visible;
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
          rendered.art.animate(frame, scale());
        }
      }
      const pointer = controls.pointer();
      if (!pointer || !snapshot.enabled) {
        actors.hover(null);
        if (lastPath) {
          highlights.clear();
          lastPath = "";
        }
      } else {
        const hit = pick(pointer.x, pointer.y);
        actors.hover(hit.actor?.key ?? null);
        const hoverKey = `${hit.structureId}:${hit.locationId}`;
        if (hoverKey !== hover) {
          hover = hoverKey;
          options.onHover(hit.structureId, hit.locationId);
        }
        if (document.body.style.cursor !== "wait")
          game.canvas.style.cursor =
            hit.actor || hit.locationId || hit.structureId ? "pointer" : "default";
        const goal = hit.tile,
          nav = snapshot.nav;
        const key =
          goal && !goal.hex.blocked
            ? `${snapshot.sector}:${snapshot.col},${snapshot.row}:${goal.sector}:${goal.hex.col},${goal.hex.row}:${generation}`
            : "";
        if (key !== lastPath) {
          lastPath = key;
          highlights.clear();
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
              if (!rendered || !target) continue;
              const offset =
                rendered.data.faceOffsets.get(`${target.col},${target.row}`) ?? 0;
              highlights
                .poly(
                  target.corners.flatMap((corner) => [
                    corner.x + rendered.position.x,
                    corner.y + offset + rendered.position.y,
                  ]),
                )
                .fill({ color: 0xffc23e, alpha: 0.4 });
            }
        }
      }
      game.canvas.style.filter = `brightness(${snapshot.brightness.toFixed(3)})`;
    });
    await updateWindow(true);
    return {
      dispose: game.dispose,
      sectors,
      updateWindow,
      setBackground,
      clearHighlights: () => {
        lastPath = "";
        highlights.clear();
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
  brightness: number;
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
  scope: GameRenderer;
  position: { x: number; y: number };
  grid: Grid<TerrainHex>;
  data: HexTerrainData;
  terrain: Awaited<ReturnType<typeof createHexTerrain>>;
  art: Awaited<ReturnType<typeof createWorldSprites>>;
};
