import { Container, UniformGroup } from "pixi.js";
import {
  IMG_AVATAR_DEFAULT,
  IMG_BADGE_MOVE_TO_LOCATION,
  IMG_MAP_QUEST_ICON,
  IMG_MAP_WAR_ICON,
  MAP_RESERVED_SECTORS,
  MAP_WAR_TORN_BATTLEGROUND_COLOR,
  MAP_WAR_TORN_BATTLEGROUND_SECTOR,
} from "@/drizzle/constants";
import type { Village } from "@/drizzle/schema";
import { linearRenderColor } from "@/libs/rendering/color";
import { createGameRenderer } from "@/libs/rendering/runtime";
import {
  createGlobeControls,
  storedGlobeZoom,
} from "@/libs/rendering/scenes/globeControls";
import {
  createGlobeMarkers,
  type GlobeMarker,
} from "@/libs/rendering/scenes/globeMarkers";
import { createGlobeLines, createGlobeMesh } from "@/libs/rendering/scenes/globeMesh";
import {
  GLOBE_HALF_FOV,
  type GlobeCamera,
  globeCameraBasis,
  globeDistanceLimits,
  globeSectorAt,
} from "@/libs/rendering/scenes/globeProjection";
import type { GlobalMapData, GlobalPoint } from "@/libs/sector-map/world-types";
import { getReadableVillageHexColor } from "@/utils/color";

/**
 * Owns the projected globe; the surface is ready on return while marker images
 * load independently. updateState changes overlays/focus, retaining the initial map.
 * zoom multiplies camera distance (>1 zooms out), following the gesture controller.
 */
export const createGlobeScene = async (options: {
  mount: HTMLElement;
  signal: AbortSignal;
  state: GlobeSceneState;
  onError: (error: unknown) => void;
  onHover: (sector: number | null) => void;
  onClick: (sector: number) => void;
}) => {
  const game = await createGameRenderer({
    ...options,
    height: (width) => width,
  });
  try {
    let state = options.state;
    const map = state.map,
      radius = map.radius / 3;
    const limits = globeDistanceLimits(radius);
    const camera: GlobeCamera = {
      longitude: Math.PI / 2,
      latitude: 0,
      distance: limits.min + storedGlobeZoom() * (limits.max - limits.min),
      width: game.renderer.width,
      height: game.renderer.height,
    };
    const aimAt = (sector: number | null | undefined) => {
      const point =
        sector === null || sector === undefined ? null : map.tiles[sector]?.c;
      if (!point) return;
      camera.longitude = Math.atan2(point.z, point.x);
      camera.latitude = Math.asin(point.y / Math.hypot(point.x, point.y, point.z));
    };
    aimAt(state.focusSector ?? (state.userLocation ? state.user?.sector : null));
    const uniforms = new UniformGroup({
      uRight: { value: new Float32Array(3), type: "vec3<f32>" },
      uUp: { value: new Float32Array(3), type: "vec3<f32>" },
      uForward: { value: new Float32Array(3), type: "vec3<f32>" },
      uDistance: { value: camera.distance, type: "f32" },
      uRadius: { value: radius, type: "f32" },
      uViewport: {
        value: new Float32Array([camera.width, camera.height]),
        type: "vec2<f32>",
      },
      uTanHalfFov: { value: Math.tan(GLOBE_HALF_FOV), type: "f32" },
      uPhase: { value: 0, type: "f32" },
    });
    const surfaceLayer = new Container();
    const grid = createGlobeLines(game, uniforms, linearRenderColor("#4b5563"), 0.2);
    const stems = createGlobeLines(game, uniforms, { r: 0, g: 0, b: 0 });
    const outline = createGlobeLines(
      game,
      uniforms,
      linearRenderColor("#ffd24a"),
      0.95,
      false,
    );
    const markers = createGlobeMarkers(game, uniforms, camera, radius);
    game.stage.addChild(
      surfaceLayer,
      grid.mesh,
      stems.mesh,
      markers.container,
      outline.mesh,
    );
    grid.setPoints(
      map.tiles.flatMap((tile) =>
        tile.b.flatMap((a, index) => {
          const b = tile.b[(index + 1) % tile.b.length];
          return b
            ? [
                (a.x / 3) * 1.0015,
                (a.y / 3) * 1.0015,
                (a.z / 3) * 1.0015,
                (b.x / 3) * 1.0015,
                (b.y / 3) * 1.0015,
                (b.z / 3) * 1.0015,
              ]
            : [];
        }),
      ),
    );
    let surface: ReturnType<typeof createGlobeMesh> | null = null;
    let previousSurfaceKey: string | null = null,
      previousMarkersKey: string | null = null;
    let hovered: number | null = null;
    let ownerBySector = new Map<number, string>();
    const highlightSector = (sector: number | null) => {
      if (sector === hovered) return;
      hovered = sector;
      markers.emphasizeOwner(
        state.showOwnership && sector !== null
          ? (ownerBySector.get(sector) ?? null)
          : null,
      );
      const tile = sector === null ? null : map.tiles[sector];
      outline.setPoints(
        tile
          ? tile.b.flatMap((a, index) => {
              const b = tile.b[(index + 1) % tile.b.length];
              return b
                ? [
                    (a.x / 3) * 1.006,
                    (a.y / 3) * 1.006,
                    (a.z / 3) * 1.006,
                    (b.x / 3) * 1.006,
                    (b.y / 3) * 1.006,
                    (b.z / 3) * 1.006,
                  ]
                : [];
            })
          : [],
      );
      game.canvas.style.cursor = sector === null ? "default" : "pointer";
      options.onHover(sector);
    };
    const pick = (x: number, y: number) =>
      markers.pick(x, y) ?? globeSectorAt(x, y, camera, radius);
    const controls = createGlobeControls(
      game,
      camera,
      { ...limits, latitude: ((map.latitudeLimit ?? 65) * Math.PI) / 180 },
      (x, y) => {
        const sector = pick(x, y);
        highlightSector(sector);
        if (sector !== null) options.onClick(sector);
      },
    );
    const updateState = (next: GlobeSceneState) => {
      if (next.focusSector !== state.focusSector) aimAt(next.focusSector);
      state = next;
      ownerBySector = new Map(
        state.ownership?.sectors.map((entry) => [entry.sector, entry.villageId]),
      );
      const surfaceKey = JSON.stringify(state.showOwnership ? state.ownership : null);
      if (surfaceKey !== previousSurfaceKey) {
        previousSurfaceKey = surfaceKey;
        surface?.dispose();
        const colors = new Map(
          state.ownership?.colors.map((entry) => [
            entry.id,
            linearRenderColor(getReadableVillageHexColor(entry.hexColor)),
          ]),
        );
        surface = createGlobeMesh(game, map, uniforms, (sector) => {
          if (!state.showOwnership) return null;
          const owner = ownerBySector.get(sector);
          return (
            (owner ? colors.get(owner) : null) ??
            (MAP_RESERVED_SECTORS.includes(sector)
              ? linearRenderColor("#b3afae")
              : null)
          );
        });
        surfaceLayer.addChild(surface.container);
      }
      const pins: { sector: number; type: "quest" | "war" | "focus" }[] = [];
      if (state.userLocation && !state.showOwnership)
        for (const sector of state.questSectors) pins.push({ sector, type: "quest" });
      pins.push({ sector: MAP_WAR_TORN_BATTLEGROUND_SECTOR, type: "war" });
      for (const war of state.ownership?.wars ?? [])
        pins.push({ sector: war.sector, type: "war" });
      if (state.focusSector !== null && state.focusSector !== undefined)
        pins.push({ sector: state.focusSector, type: "focus" });
      const uniquePins = pins.filter(
        (pin, index) =>
          pins.findIndex((other) => other.sector === pin.sector) === index,
      );
      surface?.setHighlights(uniquePins);
      const nextMarkers: GlobeMarker[] = [];
      const lines: number[] = [];
      const position = (sector: number): GlobalPoint | null => {
        const point = map.tiles[sector]?.c;
        return point ? { x: point.x / 2.5, y: point.y / 2.5, z: point.z / 2.5 } : null;
      };
      const stem = (sector: number) => {
        const point = map.tiles[sector]?.c,
          end = position(sector);
        if (point && end)
          lines.push(point.x / 3, point.y / 3, point.z / 3, end.x, end.y, end.z);
      };
      const avatar = (user: GlobeUser, border: string, line: boolean) => {
        const point = position(user.sector);
        if (!point) return;
        nextMarkers.push({
          kind: "avatar",
          sector: user.sector,
          point,
          image: user.avatarLight || user.avatar || IMG_AVATAR_DEFAULT,
          border,
        });
        if (line) stem(user.sector);
      };
      for (const user of state.usersHighlighted ?? []) avatar(user, "red", false);
      for (const village of state.highlights ?? []) {
        if (
          village.type === "HIDEOUT" &&
          village.id !== state.clanVillageId &&
          !state.showOwnership
        )
          continue;
        const point = position(village.sector);
        if (!point) continue;
        stem(village.sector);
        nextMarkers.push({
          kind: "label",
          sector: village.sector,
          point,
          text: village.mapName || village.name,
          nameLength: village.name.length,
          fill: getReadableVillageHexColor(village.hexColor),
          owner: village.id,
          clickable: true,
        });
      }
      if (state.user) avatar(state.user, "white", true);
      for (const pin of uniquePins) {
        if (state.highlights?.some((village) => village.sector === pin.sector))
          continue;
        const point = position(pin.sector);
        if (!point) continue;
        stem(pin.sector);
        nextMarkers.push({
          kind: "pin",
          sector: pin.sector,
          point,
          clickable: true,
          pulse: pin.type === "quest",
          image:
            pin.type === "war"
              ? IMG_MAP_WAR_ICON
              : pin.type === "focus"
                ? IMG_BADGE_MOVE_TO_LOCATION
                : IMG_MAP_QUEST_ICON,
        });
      }
      const markersKey = JSON.stringify(nextMarkers);
      if (markersKey !== previousMarkersKey) {
        previousMarkersKey = markersKey;
        markers.set(nextMarkers);
        stems.setPoints(lines);
      }
    };
    updateState(state);
    game.setResize((width, height) => {
      camera.width = width;
      camera.height = height;
      uniforms.uniforms.uViewport.set([width, height]);
    });
    const war = linearRenderColor(MAP_WAR_TORN_BATTLEGROUND_COLOR);
    let lastPickKey = "";
    game.setUpdate((frame) => {
      if (
        state.autoRotate &&
        !state.isTravelStep &&
        !frame.reducedMotion &&
        !controls.isInteracting()
      )
        camera.longitude += (frame.delta * Math.PI) / 50;
      const basis = globeCameraBasis(camera);
      uniforms.uniforms.uRight.set([basis.right.x, basis.right.y, basis.right.z]);
      uniforms.uniforms.uUp.set([basis.up.x, basis.up.y, basis.up.z]);
      uniforms.uniforms.uForward.set([
        basis.forward.x,
        basis.forward.y,
        basis.forward.z,
      ]);
      uniforms.uniforms.uDistance = camera.distance;
      const phase = frame.reducedMotion
        ? 0
        : (1 - Math.cos(((Date.now() % 2000) / 2000) * Math.PI * 2)) / 2;
      uniforms.uniforms.uPhase = phase;
      surface?.setPhase(phase, war);
      uniforms.update();
      const pointer = controls.pointer();
      const key = pointer
        ? `${pointer.x},${pointer.y},${camera.longitude},${camera.latitude},${camera.distance}`
        : "";
      if (pointer && key !== lastPickKey) highlightSector(pick(pointer.x, pointer.y));
      else if (!pointer && lastPickKey && !controls.isInteracting())
        highlightSector(null);
      lastPickKey = key;
    });
    return { dispose: game.dispose, updateState, zoom: controls.zoom };
  } catch (error) {
    game.dispose();
    throw error;
  }
};

export type GlobeUser = {
  sector: number;
  avatar: string | null;
  avatarLight: string | null;
};
export type GlobeSceneState = {
  map: GlobalMapData;
  highlights?: Village[];
  usersHighlighted?: GlobeUser[];
  user?: GlobeUser | null;
  clanVillageId?: string | null;
  userLocation?: boolean;
  showOwnership?: boolean;
  autoRotate: boolean;
  isTravelStep: boolean;
  focusSector?: number | null;
  questSectors: number[];
  ownership?: {
    sectors: { sector: number; villageId: string }[];
    colors: { id: string; hexColor: string }[];
    wars: { sector: number }[];
  };
};
