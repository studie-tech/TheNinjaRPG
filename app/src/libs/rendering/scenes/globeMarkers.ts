import {
  Container,
  Geometry,
  Mesh,
  Shader,
  State,
  Texture,
  type UniformGroup,
} from "pixi.js";
import { IMG_SECTOR_USER_SPRITE_MASK } from "@/drizzle/constants";
import { createSceneAssets } from "@/libs/rendering/assets";
import type { GameRenderer } from "@/libs/rendering/runtime";
import {
  type GlobeCamera,
  globeCameraBasis,
  globeProject,
} from "@/libs/rendering/scenes/globeProjection";
import { globeCameraShader } from "@/libs/rendering/scenes/globeShaders";
import type { GlobalPoint } from "@/libs/sector-map/world-types";
import { contrastingTextColor } from "@/utils/color";

/**
 * Scene-owned atlas batches, hidden by whether their anchor faces the camera, so a
 * marker is always drawn whole. set replaces marker content;
 * images load asynchronously. pick consumes renderer pixels using the same camera.
 */
export const createGlobeMarkers = (
  game: GameRenderer,
  uniforms: UniformGroup,
  camera: GlobeCamera,
  radius: number,
) => {
  const container = new Container();
  let generation = 0;
  let assets = createSceneAssets();
  let pages: { texture: Texture; geometry: Geometry; shader: Shader }[] = [];
  let markers: GlobeMarker[] = [];
  let hoveredOwner: string | null = null;
  const clear = () => {
    for (const child of container.removeChildren()) child.destroy();
    for (const page of pages) {
      page.geometry.destroy(true);
      page.shader.destroy();
      page.texture.destroy(true);
    }
    pages = [];
    assets.dispose();
  };
  const rebuildGeometry = (page: { geometry: Geometry }, group: GlobeMarker[]) => {
    const centers: number[] = [],
      offsets: number[] = [],
      uvs: number[] = [],
      metadata: number[] = [],
      indices: number[] = [];
    for (let index = 0; index < group.length; index++) {
      const marker = group[index];
      if (!marker) continue;
      const layout = MARKER_LAYOUT[marker.kind];
      const emphasized = hoveredOwner !== null && marker.owner === hoveredOwner;
      const alpha = hoveredOwner !== null && marker.owner && !emphasized ? 0.48 : 1;
      const lift = emphasized ? 1.14 : 1;
      const x = (index % 8) * 128 + 2,
        y = Math.floor(index / 8) * 128 + 2;
      for (const [u, v] of [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ] as const) {
        centers.push(marker.point.x, marker.point.y, marker.point.z);
        offsets.push(
          ((u - 0.5) * layout.width + (layout.shift ?? 0)) * lift,
          (layout.lift + (1 - v) * layout.height) * lift,
        );
        uvs.push((x + u * layout.texels[0]) / 1024, (y + v * layout.texels[1]) / 1024);
        metadata.push(marker.pulse ? 1 : 0, alpha, marker.edge ? 1 : 0);
      }
      const base = index * 4;
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    for (const [key, values] of Object.entries({
      aPosition: centers,
      aOffset: offsets,
      aUV: uvs,
      aMeta: metadata,
    })) {
      const buffer = page.geometry.getBuffer(key);
      buffer.data = new Float32Array(values);
      buffer.update();
    }
    const index = page.geometry.getIndex();
    index.data = new Uint16Array(indices);
    index.update();
  };
  const set = (next: GlobeMarker[]) => {
    generation++;
    const currentGeneration = generation;
    clear();
    assets = createSceneAssets();
    markers = next;
    for (let offset = 0; offset < markers.length; offset += 64) {
      const group = markers.slice(offset, offset + 64);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1024;
      const context = canvas.getContext("2d");
      if (!context) continue;
      const texture = Texture.from(canvas);
      texture.source.scaleMode = "linear";
      const geometry = new Geometry({
        attributes: {
          aPosition: { buffer: new Float32Array(3), format: "float32x3", stride: 12 },
          aOffset: { buffer: new Float32Array(2), format: "float32x2", stride: 8 },
          aUV: { buffer: new Float32Array(2), format: "float32x2", stride: 8 },
          aMeta: { buffer: new Float32Array(3), format: "float32x3", stride: 12 },
        },
        indexBuffer: new Uint16Array(6),
      });
      const shader = Shader.from({
        gl: {
          vertex: `precision highp float;
attribute vec3 aPosition; attribute vec2 aOffset; attribute vec2 aUV; attribute vec3 aMeta;
varying vec2 vUV; varying float vAlpha;
uniform float uPhase;
uniform float uRadius;
${globeCameraShader}
void main() {
  float pulse = 1.0 + aMeta.x * uPhase * 0.15;
  vec3 normal = normalize(aPosition);
  float horizon = uRadius / uDistance;
  float facing = dot(normal, uForward) - horizon;
  vec3 anchor = aPosition;
  vAlpha = aMeta.y;
  if (aMeta.z > 0.5 && facing < 0.0) {
    // Far-side markers wait on the visible rim, toward where they really are.
    vec3 side = normalize(normal - uForward * dot(normal, uForward) + uUp * 1e-4);
    anchor = (uForward * horizon + side * sqrt(1.0 - horizon * horizon)) * uRadius * 1.01;
    vAlpha *= 0.7;
  } else {
    vAlpha *= smoothstep(-0.02, 0.12, facing);
  }
  vec3 world = anchor + (uRight * aOffset.x + uUp * aOffset.y) * pulse;
  vUV = aUV;
  gl_Position = globeProject(world);
}`,
          fragment: `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vUV; varying float vAlpha;
uniform sampler2D uAtlas;
void main() {
  if (vAlpha < 0.004) discard;
  gl_FragColor = texture2D(uAtlas, vUV) * vAlpha;
}`,
        },
        resources: { camera: uniforms, uAtlas: texture.source },
      });
      const state = new State();
      state.blend = true;
      state.depthTest = false;
      state.depthMask = false;
      const page = { texture, geometry, shader };
      pages.push(page);
      rebuildGeometry(page, group);
      container.addChild(new Mesh({ geometry, shader, state }));
      group.forEach((marker, index) => {
        const x = (index % 8) * 128 + 2,
          y = Math.floor(index / 8) * 128 + 2;
        if (marker.kind === "label") {
          drawLabel(context, marker, x, y);
        } else if (marker.kind === "ring") {
          drawRing(context, marker.border ?? "#ffffff", x, y);
        } else if (marker.kind === "glow") {
          drawGlow(context, marker.fill ?? "#ff3b1f", x, y);
        } else if (marker.kind === "quest" || marker.kind === "questTag") {
          drawBadge(context, "#f59e0b", "#7c2d12", "!", x, y, marker.kind === "quest");
        } else if (marker.kind === "target" || marker.kind === "targetTag") {
          drawBadge(
            context,
            "#a855f7",
            "#3b0764",
            "\u25ce",
            x,
            y,
            marker.kind === "target",
          );
        } else if (marker.image) {
          const lease = assets;
          void Promise.all([
            lease.texture(marker.image),
            marker.kind === "avatar"
              ? lease.texture(IMG_SECTOR_USER_SPRITE_MASK)
              : Promise.resolve(null),
          ]).then(
            ([image, mask]) => {
              if (game.signal.aborted || currentGeneration !== generation) return;
              if (marker.kind === "avatar")
                drawAvatar(context, image, mask, marker.border ?? "white", x, y);
              else
                context.drawImage(
                  image.source.resource as CanvasImageSource,
                  x,
                  y,
                  64,
                  64,
                );
              texture.source.update();
            },
            (error) => {
              // A marker's unavailable art must not remove the navigable world surface.
              if (!game.signal.aborted && currentGeneration === generation)
                console.warn("Map marker art unavailable", error);
            },
          );
        }
      });
      texture.source.update();
    }
  };
  game.own(() => {
    generation++;
    clear();
  });
  return {
    container,
    set,
    emphasizeOwner: (owner: string | null) => {
      if (owner === hoveredOwner) return;
      hoveredOwner = owner;
      pages.forEach((page, index) => {
        rebuildGeometry(page, markers.slice(index * 64, index * 64 + 64));
      });
    },
    pick: (x: number, y: number) => {
      const candidates = markers
        .filter((marker) => marker.clickable)
        .map((marker) => {
          const anchor = globeMarkerAnchor(marker.point, camera, radius, !!marker.edge);
          return { marker, anchor, projected: globeProject(anchor.point, camera) };
        })
        .filter(({ anchor }) => anchor.isVisible)
        .sort((a, b) => a.projected.depth - b.projected.depth);
      for (const { marker, anchor, projected } of candidates) {
        const layout = MARKER_LAYOUT[marker.kind];
        const [bottom, top] = layout.hit ?? [layout.lift, layout.lift + layout.height];
        const dx = (x - projected.x) / projected.scale - (layout.shift ?? 0),
          dy = (projected.y - y) / projected.scale;
        if (Math.abs(dx) > layout.width / 2 || dy < bottom || dy > top) continue;
        return marker.sector;
      }
      return null;
    },
  };
};

/**
 * Where a marker stands this frame, mirroring the marker vertex shader: its own surface
 * point while that faces the camera, otherwise (for edge markers) the visible rim point
 * in its direction. Markers past the horizon without `edge` are not visible.
 */
export const globeMarkerAnchor = (
  point: GlobalPoint,
  camera: GlobeCamera,
  radius: number,
  edge: boolean,
) => {
  const { forward } = globeCameraBasis(camera);
  const length = Math.hypot(point.x, point.y, point.z) || 1;
  const normal = { x: point.x / length, y: point.y / length, z: point.z / length };
  const horizon = radius / camera.distance;
  const along = normal.x * forward.x + normal.y * forward.y + normal.z * forward.z;
  if (along - horizon >= 0)
    return { point, isVisible: along - horizon > 0.02, isClamped: false };
  if (!edge) return { point, isVisible: false, isClamped: false };
  const side = {
    x: normal.x - forward.x * along,
    y: normal.y - forward.y * along,
    z: normal.z - forward.z * along,
  };
  const sideLength = Math.hypot(side.x, side.y, side.z) || 1;
  const rim = Math.sqrt(1 - horizon * horizon);
  const scale = radius * 1.01;
  return {
    point: {
      x: (forward.x * horizon + (side.x / sideLength) * rim) * scale,
      y: (forward.y * horizon + (side.y / sideLength) * rim) * scale,
      z: (forward.z * horizon + (side.z / sideLength) * rim) * scale,
    },
    isVisible: true,
    isClamped: true,
  };
};

/**
 * Billboard size in globe units, its bottom edge's height above the anchor (`lift`),
 * the atlas texels it occupies and, for labels, the clickable band of the banner.
 */
const MARKER_LAYOUT: Record<
  GlobeMarker["kind"],
  {
    width: number;
    height: number;
    lift: number;
    texels: [number, number];
    hit?: [number, number];
    /** Screen-right offset of the billboard centre from the anchor. */
    shift?: number;
  }
> = {
  label: { width: 2.2, height: 1.99, lift: 0, texels: [124, 112], hit: [0.95, 1.99] },
  avatar: { width: 1, height: 1, lift: 0.05, texels: [64, 64] },
  quest: { width: 0.85, height: 1.13, lift: 0, texels: [72, 96] },
  target: { width: 0.85, height: 1.13, lift: 0, texels: [72, 96] },
  // Pinned on a banner's upper-left corner (see label), without a peg.
  questTag: { width: 0.72, height: 0.72, lift: 1.5, shift: -1.02, texels: [72, 72] },
  targetTag: { width: 0.72, height: 0.72, lift: 1.5, shift: -1.02, texels: [72, 72] },
  pin: { width: 1, height: 1, lift: 0.1, texels: [64, 64] },
  ring: { width: 1.6, height: 0.8, lift: -0.4, texels: [96, 48] },
  glow: { width: 2.6, height: 2.6, lift: -1.3, texels: [120, 120] },
};

/** Banner in the village colour flying from a pole whose foot is the anchor. */
const drawLabel = (
  context: CanvasRenderingContext2D,
  marker: GlobeMarker,
  x: number,
  y: number,
) => {
  context.save();
  context.translate(x, y);
  const fill = marker.fill ?? "#ffffff",
    text = contrastingTextColor(fill);
  context.fillStyle = "#2b1d12";
  context.fillRect(59, 44, 6, 62);
  context.beginPath();
  context.ellipse(62, 107, 9, 4, 0, 0, Math.PI * 2);
  context.fillStyle = "rgba(0, 0, 0, 0.45)";
  context.fill();
  context.beginPath();
  context.moveTo(4, 6);
  context.lineTo(120, 6);
  context.lineTo(114, 28);
  context.lineTo(120, 50);
  context.lineTo(70, 50);
  context.lineTo(62, 58);
  context.lineTo(54, 50);
  context.lineTo(4, 50);
  context.lineTo(10, 28);
  context.closePath();
  context.fillStyle = fill;
  context.strokeStyle = "#1a120b";
  context.lineWidth = 4;
  context.lineJoin = "round";
  context.stroke();
  context.fill();
  context.fillStyle = "rgba(255, 255, 255, 0.22)";
  context.fillRect(8, 9, 108, 6);
  context.fillStyle = "#d9b45a";
  for (const end of [6, 118]) {
    context.beginPath();
    context.arc(end, 6, 4, 0, Math.PI * 2);
    context.fill();
  }
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = text;
  context.strokeStyle = text === "#000000" ? "#F0F0F0" : "#1a1a1a";
  context.lineWidth = 3;
  context.font = `bold ${Math.max(18, 34 - (marker.nameLength ?? marker.text?.length ?? 0) * 1.4)}px arial narrow, arial, sans-serif`;
  context.strokeText(marker.text ?? "", 62, 29, 96);
  context.fillText(marker.text ?? "", 62, 29, 96);
  context.restore();
};

/** Flattened ring that reads as lying on the surface under the player. */
const drawRing = (
  context: CanvasRenderingContext2D,
  color: string,
  x: number,
  y: number,
) => {
  context.save();
  context.strokeStyle = color;
  context.globalAlpha = 0.9;
  context.lineWidth = 5;
  context.beginPath();
  context.ellipse(x + 48, y + 24, 42, 19, 0, 0, Math.PI * 2);
  context.stroke();
  context.globalAlpha = 0.25;
  context.fillStyle = color;
  context.fill();
  context.restore();
};

/**
 * Round map badge with a glyph. With a peg it stands on the surface, the peg's tip
 * at the anchor; without one it is a tag pinned onto a banner.
 */
const drawBadge = (
  context: CanvasRenderingContext2D,
  fill: string,
  rim: string,
  glyph: string,
  x: number,
  y: number,
  hasPeg: boolean,
) => {
  context.save();
  context.translate(x, y);
  if (hasPeg) {
    context.beginPath();
    context.ellipse(36, 92, 10, 4, 0, 0, Math.PI * 2);
    context.fillStyle = "rgba(0, 0, 0, 0.4)";
    context.fill();
    context.beginPath();
    context.moveTo(28, 60);
    context.lineTo(36, 92);
    context.lineTo(44, 60);
    context.closePath();
    context.fillStyle = rim;
    context.fill();
  }
  context.beginPath();
  context.arc(36, 34, 30, 0, Math.PI * 2);
  context.fillStyle = rim;
  context.fill();
  context.beginPath();
  context.arc(36, 34, 25, 0, Math.PI * 2);
  context.fillStyle = fill;
  context.fill();
  context.beginPath();
  context.arc(30, 26, 10, 0, Math.PI * 2);
  context.fillStyle = "rgba(255, 255, 255, 0.35)";
  context.fill();
  context.fillStyle = "#ffffff";
  context.strokeStyle = rim;
  context.lineWidth = 4;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = "bold 36px arial, sans-serif";
  context.strokeText(glyph, 36, 36);
  context.fillText(glyph, 36, 36);
  context.restore();
};

/** Soft radial glow under a contested sector. */
const drawGlow = (
  context: CanvasRenderingContext2D,
  color: string,
  x: number,
  y: number,
) => {
  const gradient = context.createRadialGradient(x + 60, y + 60, 4, x + 60, y + 60, 60);
  gradient.addColorStop(0, color);
  gradient.addColorStop(0.45, `${color}88`);
  gradient.addColorStop(1, `${color}00`);
  context.save();
  context.fillStyle = gradient;
  context.fillRect(x, y, 120, 120);
  context.restore();
};

const drawAvatar = (
  context: CanvasRenderingContext2D,
  image: Texture,
  mask: Texture | null,
  border: string,
  x: number,
  y: number,
) => {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const avatar = canvas.getContext("2d", { willReadFrequently: true });
  if (!avatar) return;
  avatar.drawImage(image.source.resource as CanvasImageSource, 0, 0, 64, 64);
  if (mask) {
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = maskCanvas.height = 64;
    const maskContext = maskCanvas.getContext("2d", { willReadFrequently: true });
    if (maskContext) {
      maskContext.drawImage(mask.source.resource as CanvasImageSource, 0, 0, 64, 64);
      const pixels = avatar.getImageData(0, 0, 64, 64),
        alpha = maskContext.getImageData(0, 0, 64, 64);
      // The retained mask stores coverage in green; its own alpha can be fully opaque.
      for (let i = 3; i < pixels.data.length; i += 4)
        pixels.data[i] = ((pixels.data[i] ?? 0) * (alpha.data[i - 2] ?? 0)) / 255;
      avatar.putImageData(pixels, 0, 0);
    }
  }
  context.save();
  context.fillStyle = border;
  context.beginPath();
  context.arc(x + 32, y + 32, 30, 0, Math.PI * 2);
  context.fill();
  context.drawImage(canvas, x + 64 / 12, y + 64 / 12, 64 / 1.2, 64 / 1.2);
  context.restore();
};

/**
 * Billboard anchored on the globe surface in scaled units; labels and artwork face the
 * shared camera and stand on the anchor (see MARKER_LAYOUT). `edge` keeps a far-side
 * marker visible on the rim in its direction.
 */
export type GlobeMarker = {
  kind:
    | "label"
    | "avatar"
    | "pin"
    | "ring"
    | "glow"
    | "quest"
    | "target"
    | "questTag"
    | "targetTag";
  sector: number;
  point: GlobalPoint;
  text?: string;
  nameLength?: number;
  fill?: string;
  owner?: string;
  image?: string;
  border?: string;
  pulse?: boolean;
  clickable?: boolean;
  edge?: boolean;
};
