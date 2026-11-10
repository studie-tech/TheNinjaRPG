import { BufferImageSource, Container, UniformGroup } from "pixi.js";
import {
  IMG_AVATAR_DEFAULT,
  IMG_MAP_WAR_ICON,
  MAP_RESERVED_SECTORS,
  MAP_WAR_TORN_BATTLEGROUND_SECTOR,
} from "@/drizzle/constants";
import type { Village } from "@/drizzle/schema";
import { linearRenderColor } from "@/libs/rendering/color";
import {
  GLOBE_CLIMATE_HEIGHT,
  GLOBE_CLIMATE_WIDTH,
} from "@/libs/rendering/globeClimate";
import { createGameRenderer } from "@/libs/rendering/runtime";
import {
  createGlobeControls,
  storedGlobeZoom,
} from "@/libs/rendering/scenes/globeControls";
import {
  createGlobeMarkers,
  type GlobeMarker,
} from "@/libs/rendering/scenes/globeMarkers";
import {
  createGlobeAtmosphere,
  createGlobeClouds,
  createGlobeGrid,
  createGlobeLines,
  createGlobeMesh,
  createGlobeRoute,
} from "@/libs/rendering/scenes/globeMesh";
import {
  GLOBE_HALF_FOV,
  type GlobeCamera,
  globeCameraBasis,
  globeDistanceLimits,
  globeSectorAt,
} from "@/libs/rendering/scenes/globeProjection";
import { createSectorGenerator } from "@/libs/rendering/sectorGenerationClient";
import { worldSunlight } from "@/libs/rendering/worldSunlight";
import { getWorldWeather, type WorldWeather } from "@/libs/rendering/worldWeather";
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
  /** Hovered sector, with the pointer and canvas size in CSS pixels when there is one. */
  onHover: (sector: number | null, at: GlobeHoverPoint | null) => void;
  onClick: (sector: number) => void;
}) => {
  const game = await createGameRenderer({
    ...options,
    surface: "globe",
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
    const light = new UniformGroup({
      uLight: { value: new Float32Array([0, 0, 1]), type: "vec3<f32>" },
      uSun: { value: new Float32Array(3), type: "vec3<f32>" },
      uAmbient: { value: new Float32Array(3), type: "vec3<f32>" },
      uSky: { value: new Float32Array(3), type: "vec3<f32>" },
      uShade: { value: 1, type: "f32" },
      uTime: { value: 0, type: "f32" },
      uClouds: { value: new Float32Array(2), type: "vec2<f32>" },
    });
    const paint = new UniformGroup({ uPainted: { value: 0, type: "f32" } });
    const climateTexels = new Uint8Array(
      GLOBE_CLIMATE_WIDTH * GLOBE_CLIMATE_HEIGHT * 4,
    );
    const climate = new BufferImageSource({
      resource: climateTexels,
      width: GLOBE_CLIMATE_WIDTH,
      height: GLOBE_CLIMATE_HEIGHT,
      format: "rgba8unorm",
      scaleMode: "linear",
      addressModeU: "repeat",
      addressModeV: "clamp-to-edge",
      alphaMode: "no-premultiply-alpha",
      autoGenerateMipmaps: false,
    });
    game.own(() => climate.destroy());
    let painted = 0,
      hasClimate = false;
    void globeClimate(map.protectedLandSectors ?? []).then(
      (texels) => {
        if (options.signal.aborted) return;
        climateTexels.set(texels);
        climate.update();
        hasClimate = true;
      },
      // The vertex climate colours stay on screen; the field is an enhancement.
      () => undefined,
    );
    const surfaceLayer = new Container();
    const atmosphere = createGlobeAtmosphere(game, uniforms, light);
    const clouds = createGlobeClouds(game, uniforms, light, radius);
    const route = createGlobeRoute(game, uniforms, light, radius);
    const borders = new Map<string, ReturnType<typeof createGlobeLines>>();
    const bordersLayer = new Container();
    const grid = createGlobeGrid(game, uniforms, linearRenderColor("#1f2937"));
    const outline = createGlobeLines(
      game,
      uniforms,
      linearRenderColor("#ffd24a"),
      0.95,
      false,
    );
    const markers = createGlobeMarkers(game, uniforms, camera, radius);
    game.stage.addChild(
      atmosphere.mesh,
      surfaceLayer,
      grid.mesh,
      outline.mesh,
      bordersLayer,
      clouds.mesh,
      route.mesh,
      markers.container,
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
      emphasizeGrid();
      updateRoute();
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
      const pointer = controls.pointer();
      options.onHover(
        sector,
        pointer
          ? { x: pointer.x, y: pointer.y, width: camera.width, height: camera.height }
          : null,
      );
    };
    let routeKey = "";
    const updateRoute = () => {
      const target = hovered ?? state.routeTarget ?? null;
      const from = state.userLocation && state.user ? state.user.sector : null;
      if (routeKey === `${from}:${target}`) return;
      routeKey = `${from}:${target}`;
      route.set(
        from === null || target === null || target === from
          ? null
          : (surfacePoint(map, from) ?? null),
        target === null ? null : (surfacePoint(map, target) ?? null),
      );
    };
    const emphasizeGrid = () => {
      const center = hovered === null ? null : map.tiles[hovered]?.c;
      const length = center ? Math.hypot(center.x, center.y, center.z) : 0;
      const focus =
        center && length > 0
          ? { x: center.x / length, y: center.y / length, z: center.z / length }
          : null;
      if (state.showOwnership) grid.setEmphasis(0.2, 0.25, focus);
      else grid.setEmphasis(0.04, 0.45, focus);
    };
    const pick = (x: number, y: number) =>
      markers.pick(x, y) ?? globeSectorAt(x, y, camera, radius);
    const controls = createGlobeControls(
      game,
      camera,
      { ...limits, latitude: (map.latitudeLimit * Math.PI) / 180 },
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
        surface = createGlobeMesh(
          game,
          map,
          uniforms,
          light,
          paint,
          climate,
          (sector) => {
            if (!state.showOwnership) return null;
            const owner = ownerBySector.get(sector);
            return (
              (owner ? colors.get(owner) : null) ??
              (MAP_RESERVED_SECTORS.includes(sector)
                ? linearRenderColor("#b3afae")
                : null)
            );
          },
        );
        surfaceLayer.addChild(surface.container);
        const edges = state.showOwnership
          ? territoryBorders(map, ownerBySector)
          : new Map<string, number[]>();
        for (const [owner, lines] of borders)
          if (!edges.has(owner)) lines.setPoints([]);
        for (const [owner, points] of edges) {
          let lines = borders.get(owner);
          if (!lines) {
            lines = createGlobeLines(
              game,
              uniforms,
              colors.get(owner) ?? linearRenderColor("#ffffff"),
              0.95,
            );
            borders.set(owner, lines);
            bordersLayer.addChild(lines.mesh);
          }
          lines.setPoints(points);
        }
      }
      light.uniforms.uShade = state.showOwnership ? 0.45 : 1;
      emphasizeGrid();
      const pins: { sector: number; type: "quest" | "war" | "focus" }[] = [];
      if (state.userLocation && !state.showOwnership && state.layers.quests)
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
      // Draw order is paint order: ground effects, then pins, banners and avatars on top.
      const ground: GlobeMarker[] = [],
        standing: GlobeMarker[] = [],
        banners: GlobeMarker[] = [],
        avatars: GlobeMarker[] = [];
      const bannerSectors = new Set<number>();
      if (state.layers.labels)
        for (const village of state.highlights ?? []) {
          if (
            village.type === "HIDEOUT" &&
            village.id !== state.clanVillageId &&
            !state.showOwnership
          )
            continue;
          const point = surfacePoint(map, village.sector);
          if (!point) continue;
          bannerSectors.add(village.sector);
          banners.push({
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
      // Markers sharing a sector with a banner step beside its pole instead of covering it.
      const avatar = (user: GlobeUser, border: string, clickable: boolean) => {
        const point = surfacePoint(map, user.sector);
        if (!point) return;
        avatars.push({
          kind: "avatar",
          sector: user.sector,
          point,
          image: user.avatarLight || user.avatar || IMG_AVATAR_DEFAULT,
          border,
          clickable,
          nudge: bannerSectors.has(user.sector) ? 0.7 : 0,
        });
      };
      for (const user of state.usersHighlighted ?? []) avatar(user, "#dc2626", true);
      const own = state.user ? surfacePoint(map, state.user.sector) : null;
      if (state.user && own) {
        ground.push({
          kind: "ring",
          sector: state.user.sector,
          point: own,
          border: "#ffffff",
          pulse: true,
        });
        avatar(state.user, "white", false);
      }
      for (const pin of uniquePins) {
        const point = surfacePoint(map, pin.sector);
        if (!point) continue;
        const nudge = bannerSectors.has(pin.sector) ? -0.75 : 0;
        if (pin.type === "war") {
          ground.push({ kind: "glow", sector: pin.sector, point, pulse: true });
          if (!nudge)
            standing.push({
              kind: "pin",
              sector: pin.sector,
              point,
              clickable: true,
              image: IMG_MAP_WAR_ICON,
            });
        } else
          standing.push({
            kind: pin.type === "quest" ? "quest" : "target",
            sector: pin.sector,
            point,
            clickable: true,
            pulse: true,
            edge: true,
            nudge,
          });
      }
      const nextMarkers = [...ground, ...standing, ...banners, ...avatars];
      const markersKey = JSON.stringify(nextMarkers);
      if (markersKey !== previousMarkersKey) {
        previousMarkersKey = markersKey;
        markers.set(nextMarkers);
      }
      updateRoute();
    };
    updateState(state);
    game.setResize((width, height) => {
      camera.width = width;
      camera.height = height;
      uniforms.uniforms.uViewport.set([width, height]);
    });
    // The key light rides with the camera (upper left, slightly behind the viewer),
    // so the face the player looks at is always lit; the world's day/night cycle
    // only shifts its colour between warm sun and cool moonlight.
    // The key light rides with the camera (upper left, slightly behind the viewer),
    // so the face the player looks at is always lit; the world's day/night cycle
    // only shifts its colour between warm sun and cool moonlight.
    const lightDirection = light.uniforms.uLight as Float32Array;
    const updateLightDirection = (basis: ReturnType<typeof globeCameraBasis>) => {
      const x = -0.62 * basis.right.x + 0.5 * basis.up.x + 0.6 * basis.forward.x,
        y = -0.62 * basis.right.y + 0.5 * basis.up.y + 0.6 * basis.forward.y,
        z = -0.62 * basis.right.z + 0.5 * basis.up.z + 0.6 * basis.forward.z;
      const length = Math.hypot(x, y, z) || 1;
      lightDirection[0] = x / length;
      lightDirection[1] = y / length;
      lightDirection[2] = z / length;
    };
    const updateLightColors = (day: number, sky: WorldWeather) => {
      const mix = (night: number[], noon: number[]) =>
        night.map((value, index) => value + ((noon[index] ?? value) - value) * day);
      light.uniforms.uSun.set(mix([0.46, 0.53, 0.78], [0.92, 0.86, 0.74]));
      light.uniforms.uAmbient.set(mix([0.24, 0.27, 0.4], [0.34, 0.35, 0.42]));
      light.uniforms.uSky.set(mix([0.12, 0.2, 0.5], [0.42, 0.68, 1.0]));
      light.uniforms.uClouds.set(state.layers.clouds ? globeCloudCover(sky) : [0, 0]);
    };
    const right = uniforms.uniforms.uRight as Float32Array,
      up = uniforms.uniforms.uUp as Float32Array,
      forward = uniforms.uniforms.uForward as Float32Array;
    let elapsed = 0,
      skyCheckedAt = -Infinity,
      lastClouds: boolean | null = null,
      lastDistance = Number.NaN;
    // Last pointer and camera the hover pick ran for; it reruns only when one changes.
    const lastPick = {
      x: Number.NaN,
      y: Number.NaN,
      longitude: 0,
      latitude: 0,
      distance: 0,
    };
    game.setUpdate((frame) => {
      elapsed += frame.delta;
      if (elapsed - skyCheckedAt > 5 || lastClouds !== state.layers.clouds) {
        skyCheckedAt = elapsed;
        lastClouds = state.layers.clouds;
        const now = Date.now() - state.timeDiff;
        updateLightColors(
          worldSunlight(new Date(now)).day,
          getWorldWeather("ground", now),
        );
      }
      if (
        state.autoRotate &&
        !state.isTravelStep &&
        !frame.reducedMotion &&
        !controls.isInteracting()
      )
        camera.longitude += (frame.delta * Math.PI) / 50;
      const basis = globeCameraBasis(camera);
      right[0] = basis.right.x;
      right[1] = basis.right.y;
      right[2] = basis.right.z;
      up[0] = basis.up.x;
      up[1] = basis.up.y;
      up[2] = basis.up.z;
      forward[0] = basis.forward.x;
      forward[1] = basis.forward.y;
      forward[2] = basis.forward.z;
      uniforms.uniforms.uDistance = camera.distance;
      updateLightDirection(basis);
      light.uniforms.uTime = frame.reducedMotion ? 0 : elapsed;
      light.update();
      const paintTarget = hasClimate && !state.showOwnership ? 1 : 0;
      if (painted !== paintTarget) {
        painted = frame.reducedMotion
          ? paintTarget
          : Math.max(
              0,
              Math.min(
                1,
                painted + Math.sign(paintTarget - painted) * frame.delta * 1.5,
              ),
            );
        paint.uniforms.uPainted = painted;
        paint.update();
      }
      if (camera.distance !== lastDistance) {
        lastDistance = camera.distance;
        atmosphere.setView(radius, camera.distance);
      }
      const phase = frame.reducedMotion
        ? 0
        : (1 - Math.cos(((Date.now() % 2000) / 2000) * Math.PI * 2)) / 2;
      uniforms.uniforms.uPhase = phase;
      uniforms.update();
      // A drag keeps its hover target: picking every dragged frame would only churn
      // the hover card and route under the moving globe.
      if (controls.isInteracting()) return;
      const pointer = controls.pointer();
      if (!pointer) {
        if (!Number.isNaN(lastPick.x)) {
          lastPick.x = lastPick.y = Number.NaN;
          highlightSector(null);
        }
        return;
      }
      if (
        pointer.x === lastPick.x &&
        pointer.y === lastPick.y &&
        camera.longitude === lastPick.longitude &&
        camera.latitude === lastPick.latitude &&
        camera.distance === lastPick.distance
      )
        return;
      lastPick.x = pointer.x;
      lastPick.y = pointer.y;
      lastPick.longitude = camera.longitude;
      lastPick.latitude = camera.latitude;
      lastPick.distance = camera.distance;
      highlightSector(pick(pointer.x, pointer.y));
    });
    return { dispose: game.dispose, updateState, zoom: controls.zoom };
  } catch (error) {
    game.dispose();
    throw error;
  }
};

/** A sector's centre on the surface in scaled globe units: where its markers stand. */
const surfacePoint = (map: GlobalMapData, sector: number): GlobalPoint | null => {
  const point = map.tiles[sector]?.c;
  return point
    ? {
        x: (point.x / 3.0) * 1.003,
        y: (point.y / 3.0) * 1.003,
        z: (point.z / 3.0) * 1.003,
      }
    : null;
};

/**
 * Line pairs per owner along every sector edge where ownership changes, drawn twice and
 * inset toward the owner's own sector so two neighbouring realms each show their colour.
 */
const territoryBorders = (map: GlobalMapData, ownerBySector: Map<number, string>) => {
  const edges = new Map<string, number[]>();
  const sides = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
  ] as const;
  for (const [sector, owner] of ownerBySector) {
    const tile = map.tiles[sector];
    if (!tile?.n) continue;
    const points = edges.get(owner) ?? [];
    tile.n.forEach((neighbour, side) => {
      if (neighbour >= 0 && ownerBySector.get(neighbour) === owner) return;
      const [from, to] = sides[side] ?? [0, 1];
      const a = tile.b[from],
        b = tile.b[to];
      if (!a || !b) return;
      for (const inset of [0.04, 0.08]) {
        for (const corner of [a, b]) {
          const x = Number(corner.x) + (tile.c.x - Number(corner.x)) * inset,
            y = Number(corner.y) + (tile.c.y - Number(corner.y)) * inset,
            z = Number(corner.z) + (tile.c.z - Number(corner.z)) * inset;
          const scale = ((map.radius / 3) * 1.004) / (Math.hypot(x, y, z) || 1);
          points.push(x * scale, y * scale, z * scale);
        }
      }
    });
    edges.set(owner, points);
  }
  return edges;
};

/**
 * Cloud coverage and storm darkness for the shared weather front: fair-weather clouds
 * always drift, cloud fronts thicken them and rain also darkens them.
 */
const globeCloudCover = (weather: WorldWeather) => {
  const intensity = weather.kind === "clear" ? 0 : weather.intensity;
  const isStorm = weather.kind !== "clear" && weather.kind !== "clouds";
  return [0.32 + intensity * 0.16, isStorm ? Math.min(1, intensity * 1.4) : 0];
};

/** One climate field per protected-land list, kept for the session so remounts are instant. */
const globeClimate = (protectedSectors: number[]) => {
  const key = protectedSectors.join(",");
  let field = climateFields.get(key);
  if (!field) {
    field = createSectorGenerator().globe({ protectedSectors });
    field.catch(() => climateFields.delete(key));
    climateFields.set(key, field);
  }
  return field;
};

const climateFields = new Map<string, Promise<Uint8Array>>();

/** Where the pointer entered the hovered sector, in the canvas's CSS pixels. */
export type GlobeHoverPoint = { x: number; y: number; width: number; height: number };

/** Optional map overlays the player can switch off. */
export type GlobeLayers = { labels: boolean; quests: boolean; clouds: boolean };

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
  /** Client clock minus server clock, so daylight and weather follow the server's cycle. */
  timeDiff: number;
  /** Destination the route arc keeps pointing at when nothing is hovered (a pending trip). */
  routeTarget?: number | null;
  layers: GlobeLayers;
  ownership?: {
    sectors: { sector: number; villageId: string }[];
    colors: { id: string; hexColor: string }[];
    wars: { sector: number }[];
  };
};
