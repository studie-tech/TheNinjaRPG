import alea from "alea";
import { Container, Graphics, getMaxFragmentPrecision, RenderLayer } from "pixi.js";
import type { MapAsset, VillageStructure } from "@/drizzle/schema";
import { getBackgroundColor } from "@/libs/rendering/biomes";
import { calculateWidth2Height } from "@/libs/rendering/hexGeometry";
import { createWorldSprites } from "@/libs/rendering/primitives/sprites";
import { createHexTerrain } from "@/libs/rendering/primitives/terrain";
import { createGameRenderer } from "@/libs/rendering/runtime";
import { buildSectorTerrainData } from "@/libs/rendering/sectorData";
import { sectorSpriteDescriptions } from "@/libs/rendering/sectorSprites";
import { hexTerrainAt } from "@/libs/rendering/terrainData";
import { planVillageLandscape } from "@/libs/rendering/villageLandscape";
import { createWorldShadows, worldSunlight } from "@/libs/rendering/worldShadows";
import { sampleWorldWind } from "@/libs/rendering/worldWind";
import type { DecorationAsset } from "@/libs/sector-map/decorations";
import { prepareSectorGrid } from "@/libs/sector-map/sector-grid";
import type { TerrainSpec } from "@/libs/sector-map/terrains";
import type { NormalizedSectorMap } from "@/libs/sector-map/types";
import {
  isVillageStructurePlacementAllowed,
  usesVillageWalls,
} from "@/libs/sector-map/village-walls";
import type { MapLocation } from "@/validators/mapLocation";

/**
 * Owns a fixed sector preview, awaiting terrain/scenery attempts and reporting
 * unavailable scenery via missingAssets. Recreate when data or move availability
 * changes: touch policy is fixed at construction. onMove delegates persistence to the caller.
 */
export const createSectorPreview = async (options: {
  mount: HTMLElement;
  signal: AbortSignal;
  data: SectorPreviewData;
  onError: (error: unknown) => void;
  canMove: () => boolean;
  onMove: (
    structure: { id: string; name: string },
    target: { x: number; y: number },
  ) => void;
}) => {
  const { map, sector, decorationAssets, terrainRegistry, villageType } = options.data;
  const structures = options.data.structures ?? [];
  const ratio = calculateWidth2Height(map.width, map.height + 2);
  const game = await createGameRenderer({
    ...options,
    touchAction: options.canMove() ? "none" : "auto",
    height: (width) => width * ratio,
    background: getBackgroundColor(map.tiles[0]?.battleBiome ?? "ground").color,
    backgroundAlpha: 0.5,
  });
  try {
    const logicalWidth = 1024;
    const prng = alea(sector + 1);
    const { grid, villageWallPlan } = prepareSectorGrid(
      logicalWidth,
      prng,
      1,
      structures,
      map,
      terrainRegistry,
      villageType ?? null,
    );
    const roads = planVillageLandscape(grid, structures, villageWallPlan, sector);
    const descriptions = sectorSpriteDescriptions({
      map,
      grid,
      structures,
      decorations: decorationAssets,
      wall: villageWallPlan,
      lightLayout: false,
      locations: options.data.locations,
      mapAssets: options.data.mapAssets,
      roads,
    });
    const data = buildSectorTerrainData(grid, prng, false, {
      sector,
      sprites: descriptions,
      wall: villageWallPlan,
      roads,
    });
    const world = new Container();
    // Packed geometry decoding needs highp; static previews retain noon ambient light on mediump devices.
    const shadows =
      getMaxFragmentPrecision() === "highp"
        ? createWorldShadows(game, world)
        : undefined;
    const lightingLayer = shadows?.container ?? new Container();
    const [terrain, art] = await Promise.all([
      createHexTerrain(game, data),
      createWorldSprites(game, descriptions, shadows),
    ]);
    if (game.signal.aborted || game.isDisposed())
      throw new DOMException("Preview cancelled", "AbortError");
    if (shadows) game.own(shadows.registerTerrain(terrain.container, data));
    const highlight = new Graphics();
    const depthLayer = new RenderLayer(),
      uiLayer = new RenderLayer();
    art.attachLayers({ world: depthLayer, ui: uiLayer });
    lightingLayer.addChild(terrain.container, art.container, depthLayer);
    world.addChild(lightingLayer, highlight, uiLayer);
    game.stage.addChild(world);
    let scale = 1;
    game.setResize((width, height) => {
      scale = width / logicalWidth;
      world.scale.set(scale, -scale);
      world.position.set(0, height);
    });
    let dragging: (typeof art.entries)[number] | null = null;
    let target: { x: number; y: number } | null = null;
    const point = (event: PointerEvent) => {
      const rect = game.canvas.getBoundingClientRect();
      const x = ((event.clientX - rect.left) * game.renderer.width) / rect.width;
      const y = ((event.clientY - rect.top) * game.renderer.height) / rect.height;
      return { x, y, worldX: x / scale, worldY: (game.renderer.height - y) / scale };
    };
    const structureAt = (event: PointerEvent) => {
      const { x, y } = point(event);
      for (let index = art.entries.length - 1; index >= 0; index--) {
        const entry = art.entries[index];
        if (!entry?.description.structureId) continue;
        if (entry.sprite.getBounds().containsPoint(x, y)) return entry;
      }
      return null;
    };
    const cancelDrag = () => {
      if (dragging)
        dragging.sprite.position.set(dragging.description.x, dragging.description.y);
      dragging = null;
      shadows?.invalidate();
      target = null;
      highlight.clear();
      game.canvas.style.cursor = "default";
    };
    game.listen("pointerdown", (event) => {
      if (!options.canMove() || event.button !== 0) return;
      dragging = structureAt(event);
      if (!dragging) return;
      target = null;
      game.canvas.style.cursor = "grabbing";
      if (event.isTrusted) game.canvas.setPointerCapture(event.pointerId);
    });
    game.listen("pointermove", (event) => {
      if (!options.canMove()) return;
      if (!dragging) {
        game.canvas.style.cursor = structureAt(event) ? "grab" : "default";
        return;
      }
      const p = point(event),
        tile = hexTerrainAt(grid, data.faceOffsets, p.worldX, p.worldY);
      highlight.clear();
      target = null;
      if (!tile) return;
      const occupied = structures.some(
        (structure) =>
          structure.id !== dragging?.description.structureId &&
          structure.longitude === tile.col &&
          structure.latitude === tile.row,
      );
      const allowed =
        !occupied &&
        (!usesVillageWalls(villageType) ||
          isVillageStructurePlacementAllowed(map, { x: tile.col, y: tile.row }));
      dragging.sprite.position.set(tile.x, tile.y + tile.height / 10);
      const offset = data.faceOffsets.get(`${tile.col},${tile.row}`) ?? 0;
      highlight
        .poly(tile.corners.flatMap((corner) => [corner.x, corner.y + offset]))
        .fill({ color: allowed ? 0xffc23e : 0xef4444, alpha: 0.4 });
      if (allowed) target = { x: tile.col, y: tile.row };
    });
    game.listen("pointerup", () => {
      const entry = dragging,
        destination = target;
      cancelDrag();
      if (!entry || !destination) return;
      const structure = structures.find(
        (candidate) => candidate.id === entry.description.structureId,
      );
      if (
        !structure ||
        (structure.longitude === destination.x && structure.latitude === destination.y)
      )
        return;
      options.onMove({ id: structure.id, name: structure.name }, destination);
    });
    game.listen("pointercancel", cancelDrag);
    game.listen("lostpointercapture", cancelDrag);
    game.listen("pointerleave", () => {
      if (!dragging) game.canvas.style.cursor = "default";
    });
    game.setUpdate((frame) => {
      const breeze = sampleWorldWind(frame, scale);
      art.animate(frame, scale, null, breeze);
      if (dragging) shadows?.invalidate();
      shadows?.update(
        worldSunlight(),
        {
          minX: 0,
          maxX: logicalWidth,
          minY: 0,
          maxY: game.renderer.height / scale,
        },
        breeze,
      );
    });
    return { dispose: game.dispose, missingAssets: art.missing };
  } catch (error) {
    game.dispose();
    throw error;
  }
};

export type SectorPreviewData = {
  map: NormalizedSectorMap;
  locations?: MapLocation[];
  mapAssets?: Pick<MapAsset, "id" | "imageUrl" | "renderScale">[];
  sector: number;
  decorationAssets: Map<string, DecorationAsset>;
  terrainRegistry: Map<string, TerrainSpec>;
  structures?: VillageStructure[];
  villageType?: string | null;
};
