"use client";

import alea from "alea";
import { useEffect, useRef } from "react";
import type { Mesh, MeshBasicMaterial } from "three";
import { OrthographicCamera, Raycaster, type Sprite, Vector2 } from "three";
import {
  ASSETS_LAYER,
  HEX_ASPECT_RATIO,
  HEX_STACKING_DISPLACEMENT,
} from "@/drizzle/constants";
import type { VillageStructure } from "@/drizzle/schema";
import type { TerrainHex } from "@/libs/hexgrid";
import type { DecorationAsset } from "@/libs/sector-map/decorations";
import type { TerrainSpec } from "@/libs/sector-map/terrains";
import type { NormalizedSectorMap } from "@/libs/sector-map/types";
import {
  isVillageStructurePlacementAllowed,
  usesVillageWalls,
} from "@/libs/sector-map/village-walls";
import { getBackgroundColor } from "@/libs/threejs/biome";
import {
  drawSector,
  drawVillage,
  sortSectorAssetsByGroundContact,
} from "@/libs/threejs/sector";
import { updateWaveAnimation, updateWindAnimation } from "@/libs/threejs/shaders";
import {
  disposeGroupPreservingShared,
  setRaycasterFromMouse,
  setupScene,
} from "@/libs/threejs/util";

interface SectorPreviewProps {
  map: NormalizedSectorMap;
  sector: number;
  decorationAssets: Map<string, DecorationAsset>;
  terrainRegistry: Map<string, TerrainSpec>;
  /** Village structures to render (and, with onMoveStructure, to drag around) */
  structures?: VillageStructure[];
  villageType?: string | null;
  /** When set, structures become draggable; called when one is dropped on a new tile */
  onMoveStructure?: (
    structure: { id: string; name: string },
    target: { x: number; y: number },
  ) => void;
}

/**
 * Static render of one sector map: the exact same drawSector/drawVillage
 * pipeline the travel scene uses (same materials, decorations, structures,
 * water animation), minus the gameplay shell (users, movement, 3x3 window).
 * Used to review a map in the editor without publishing or travelling there,
 * and - for content staff - to drag village structures onto new tiles.
 */
const SectorPreview: React.FC<SectorPreviewProps> = (props) => {
  const { map, sector, decorationAssets, terrainRegistry } = props;
  const { structures, villageType } = props;
  const mountRef = useRef<HTMLDivElement | null>(null);
  // Keep the drop callback fresh without rebuilding the scene
  const onMoveStructureRef = useRef(props.onMoveStructure);
  onMoveStructureRef.current = props.onMoveStructure;
  const draggable = !!props.onMoveStructure;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let animationId = 0;
    let cancelled = false;
    let cleanupScene: (() => void) | null = null;

    // The mount can measure 0 on first paint (layout/animation); wait for a
    // real width before building the scene
    const buildWhenSized = () => {
      if (cancelled) return;
      const width = mount.getBoundingClientRect().width;
      if (width < 50) {
        animationId = requestAnimationFrame(buildWhenSized);
        return;
      }

      const width2height =
        ((map.height + 2) * HEX_ASPECT_RATIO) /
        (map.width - HEX_STACKING_DISPLACEMENT * (map.width - 1));
      const height = width * width2height;

      // Same clear color heuristic as the travel scene: the first walkable
      // tile's combat biome sets the backdrop
      const biome = map.tiles.find((tile) => !tile.blocked)?.battleBiome ?? "ground";
      const { scene, renderer } = setupScene({
        mountRef,
        width,
        height,
        sortObjects: false,
        color: getBackgroundColor(biome).color,
        colorAlpha: 0.5,
        width2height,
      });
      if (!renderer) return;
      mount.appendChild(renderer.domElement);

      const groups = drawSector(
        width,
        alea(sector + 1),
        1,
        false,
        structures,
        map,
        decorationAssets,
        terrainRegistry,
      );
      drawVillage(
        groups.group_assets,
        structures ?? [],
        groups.honeycombGrid,
        map,
        villageType ?? null,
      );
      sortSectorAssetsByGroundContact(groups.group_assets);
      scene.add(groups.group_dirt);
      scene.add(groups.group_tiles);
      scene.add(groups.group_edges);
      // Invisible per-tile hexes double as the drag target raycast layer
      scene.add(groups.group_interaction);
      scene.add(groups.group_assets);

      const camera = new OrthographicCamera(0, width, height, 0, -10, 10);

      // Drag-and-drop of structure sprites onto tiles
      const raycaster = new Raycaster();
      const canvas = renderer.domElement;
      let dragged: Sprite | null = null;
      let dragOrigin = new Vector2();
      let targetTile: TerrainHex | null = null;
      let highlighted: Mesh | null = null;

      const structureAt = (event: PointerEvent): Sprite | null => {
        setRaycasterFromMouse(raycaster, canvas, event, camera);
        const hit = raycaster
          .intersectObjects([groups.group_assets], true)
          .find((i) => i.object.userData?.structureId);
        return (hit?.object as Sprite) ?? null;
      };
      const tileAt = (event: PointerEvent): { tile: TerrainHex; mesh: Mesh } | null => {
        setRaycasterFromMouse(raycaster, canvas, event, camera);
        const hit = raycaster
          .intersectObjects([groups.group_interaction])
          .find((i) => i.object.userData?.type === "tile");
        if (!hit) return null;
        return {
          tile: hit.object.userData.tile as TerrainHex,
          mesh: hit.object as Mesh,
        };
      };
      const clearHighlight = () => {
        if (highlighted) {
          const material = highlighted.material as MeshBasicMaterial;
          material.visible = false;
          material.color.setHex(0xffc23e);
          highlighted = null;
        }
      };
      const endDrag = () => {
        if (dragged) {
          dragged.position.set(dragOrigin.x, dragOrigin.y, ASSETS_LAYER);
          dragged = null;
        }
        targetTile = null;
        clearHighlight();
        canvas.style.cursor = "default";
      };
      const onPointerDown = (event: PointerEvent) => {
        const sprite = structureAt(event);
        if (!sprite) return;
        dragged = sprite;
        dragOrigin = new Vector2(sprite.position.x, sprite.position.y);
        targetTile = null;
        canvas.style.cursor = "grabbing";
        canvas.setPointerCapture(event.pointerId);
      };
      const onPointerMove = (event: PointerEvent) => {
        if (!dragged) {
          canvas.style.cursor = structureAt(event) ? "grab" : "default";
          return;
        }
        const hit = tileAt(event);
        if (hit) {
          const occupied = structures?.some(
            (candidate) =>
              candidate.id !== dragged?.userData.structureId &&
              candidate.longitude === hit.tile.col &&
              candidate.latitude === hit.tile.row,
          );
          const placementAllowed =
            !occupied &&
            (!usesVillageWalls(villageType) ||
              isVillageStructurePlacementAllowed(map, {
                x: hit.tile.col,
                y: hit.tile.row,
              }));
          // Snap the building to the hovered hex and light the tile up
          targetTile = placementAllowed ? hit.tile : null;
          const h = hit.tile.height;
          dragged.position.set(hit.tile.x, hit.tile.y + h / 10, ASSETS_LAYER);
          if (highlighted !== hit.mesh) {
            clearHighlight();
            highlighted = hit.mesh;
            const material = highlighted.material as MeshBasicMaterial;
            material.color.setHex(placementAllowed ? 0xffc23e : 0xef4444);
            material.visible = true;
          }
        }
      };
      const onPointerUp = () => {
        if (!dragged) return;
        const sprite = dragged;
        const target = targetTile;
        endDrag();
        if (!target) return;
        const structure = structures?.find(
          (candidate) => candidate.id === sprite.userData.structureId,
        );
        if (!structure) return;
        if (structure.longitude === target.col && structure.latitude === target.row) {
          return;
        }
        onMoveStructureRef.current?.(
          { id: structure.id, name: structure.name },
          { x: target.col, y: target.row },
        );
      };
      if (draggable) {
        canvas.addEventListener("pointerdown", onPointerDown);
        canvas.addEventListener("pointermove", onPointerMove);
        canvas.addEventListener("pointerup", onPointerUp);
        canvas.addEventListener("pointerleave", endDrag);
      }

      const render = () => {
        animationId = requestAnimationFrame(render);
        const time = performance.now() / 1000;
        updateWindAnimation(groups.group_assets, time);
        updateWaveAnimation(groups.animatedMaterials, time);
        renderer.render(scene, camera);
      };
      render();

      cleanupScene = () => {
        cancelAnimationFrame(animationId);
        if (draggable) {
          canvas.removeEventListener("pointerdown", onPointerDown);
          canvas.removeEventListener("pointermove", onPointerMove);
          canvas.removeEventListener("pointerup", onPointerUp);
          canvas.removeEventListener("pointerleave", endDrag);
        }
        [
          groups.group_dirt,
          groups.group_tiles,
          groups.group_edges,
          groups.group_assets,
          groups.group_interaction,
        ].forEach(disposeGroupPreservingShared);
        renderer.dispose();
        if (renderer.domElement.parentNode === mount) {
          mount.removeChild(renderer.domElement);
        }
      };
    };
    buildWhenSized();

    return () => {
      cancelled = true;
      cancelAnimationFrame(animationId);
      cleanupScene?.();
    };
  }, [
    map,
    sector,
    decorationAssets,
    terrainRegistry,
    structures,
    villageType,
    draggable,
  ]);

  return <div ref={mountRef} className="w-full" />;
};

export default SectorPreview;
