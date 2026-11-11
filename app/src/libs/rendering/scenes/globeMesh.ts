import {
  type BufferImageSource,
  Container,
  Geometry,
  Mesh,
  Shader,
  State,
  UniformGroup,
} from "pixi.js";
import type { LinearColor } from "@/libs/rendering/color";
import type { GameRenderer } from "@/libs/rendering/runtime";
import { createGlobeArc } from "@/libs/rendering/scenes/globeRoute";
import {
  globeCameraShader,
  globeCloudShader,
  globeLightShader,
  globePaintShader,
} from "@/libs/rendering/scenes/globeShaders";
import {
  buildGlobeSurfaceData,
  samplePolarCapColor,
  surfaceWater,
} from "@/libs/rendering/scenes/globeSurface";
import { displayColorShader } from "@/libs/rendering/shaders";
import type { GlobalMapData, GlobalPoint } from "@/libs/sector-map/world-types";

/** Parallel lines that make up the route ribbon. */
const STRANDS = 3;

/** Halo quad half-size as a multiple of the silhouette radius. */
const ATMOSPHERE_EXTENT = 1.25;

/**
 * Static spherical vertices are projected on the GPU; no CPU vertex rewrite per frame.
 * Vertex climate colours show until the scene's climate field arrives; `paint.uPainted`
 * then blends in the per-pixel biomes and relief of `globePaintShader`.
 */
export const createGlobeMesh = (
  game: GameRenderer,
  map: GlobalMapData,
  camera: UniformGroup,
  light: UniformGroup,
  paint: UniformGroup,
  climate: BufferImageSource,
  tint?: (sector: number) => LinearColor | null,
) => {
  const container = new Container();
  const shader = Shader.from({
    gl: {
      vertex: `precision highp float;
attribute vec3 aPosition;
attribute vec3 aColor;
attribute float aWater;
varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vView;
varying float vWater;
${globeCameraShader}
void main() {
  vColor = aColor;
  vWater = aWater;
  vNormal = aPosition;
  vView = uForward * uDistance - aPosition;
  gl_Position = globeProject(aPosition);
}`,
      fragment: `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vView;
varying float vWater;
uniform float uPainted;
${displayColorShader}
${globeLightShader}
${globePaintShader}
${globeCloudShader}
void main() {
  vec3 normal = normalize(vNormal);
  vec3 color = vColor * mix(vec3(1.0), vec3(0.55, 0.72, 0.95), smoothstep(0.6, 1.0, vWater) * 0.55 * uShade);
  float water = vWater;
  if (uPainted > 0.0) {
    vec2 uv = paintUV(normal, climateUV(normal));
    vec4 climate = climateAt(uv);
    vec4 painted = paintClimate(climate, normal);
    float land = smoothstep(-0.006, 0.006, climate.x);
    color = mix(color, painted.rgb, uPainted);
    water = mix(water, painted.a, uPainted);
    normal = normalize(mix(normal, reliefNormal(normal, uv, climate.y), uPainted * land));
  }
  float shade = clamp((uShade - 0.45) / 0.55, 0.0, 1.0);
  if (uClouds.x > 0.0 && shade > 0.0)
    color *= 1.0 - cloudCover(normalize(vNormal + uLight * 0.02)) * 0.3 * shade;
  gl_FragColor = vec4(displayColor(globeLight(color, water, normal, normalize(vView))), 1.0);
}`,
    },
    resources: {
      camera,
      light,
      paint,
      uClimate: climate,
    },
  });
  const state = new State();
  state.depthTest = true;
  state.depthMask = true;
  state.blend = false;
  const geometries: Geometry[] = [];
  const add = (
    positions: Float32Array,
    colors: Float32Array,
    water: Float32Array,
    indices: Uint16Array,
  ) => {
    const geometry = new Geometry({
      attributes: {
        aPosition: { buffer: positions, format: "float32x3", stride: 12 },
        aColor: { buffer: colors, format: "float32x3", stride: 12 },
        aWater: { buffer: water, format: "float32", stride: 4 },
      },
      indexBuffer: indices,
    });
    geometries.push(geometry);
    container.addChild(new Mesh({ geometry, shader, state }));
  };
  // Painted biomes carry the colour detail, so the mesh only needs to stay round:
  // 3x3 cells per sector draw a quarter of the full climate grid's triangles.
  const data = buildGlobeSurfaceData(map, tint, 2);
  let chunkStart = 0,
    indexStart = 0,
    indexEnd = 0,
    chunkEnd = 0;
  const flush = () => {
    if (chunkEnd === chunkStart) return;
    add(
      data.positions.slice(chunkStart * 3, chunkEnd * 3),
      data.colors.slice(chunkStart * 3, chunkEnd * 3),
      data.water.slice(chunkStart, chunkEnd),
      Uint16Array.from(
        data.indices.slice(indexStart, indexEnd),
        (index) => index - chunkStart,
      ),
    );
    chunkStart = chunkEnd;
    indexStart = indexEnd;
  };
  for (let sector = 0; sector < map.tiles.length; sector++) {
    const start = data.vertexRanges[sector * 2] ?? -1;
    const count = data.vertexRanges[sector * 2 + 1] ?? 0;
    if (start < 0 || count <= 0) continue;
    if (start + count - chunkStart > 65_000) flush();
    chunkEnd = start + count;
    indexEnd += (Math.sqrt(count) - 1) ** 2 * 6;
  }
  flush();
  const poles = buildPolarCaps(map, 2);
  add(poles.positions, poles.colors, poles.water, poles.indices);
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (!container.destroyed) container.destroy({ children: true });
    for (const geometry of geometries) geometry.destroy(true);
    shader.destroy();
  };
  game.own(dispose);
  return {
    container,
    dispose,
  };
};

/** Scene-owned line pairs as flat xyz triples in scaled globe units, using the shared camera uniforms. */
export const createGlobeLines = (
  game: GameRenderer,
  camera: UniformGroup,
  color: LinearColor,
  alpha = 1,
  depthTest = true,
) => {
  const shader = Shader.from({
    gl: {
      vertex: `precision highp float; attribute vec3 aPosition; ${globeCameraShader} void main() { gl_Position = globeProject(aPosition); }`,
      fragment: `precision mediump float; uniform vec4 uLineColor; ${displayColorShader} void main() { gl_FragColor = vec4(displayColor(uLineColor.rgb) * uLineColor.a, uLineColor.a); }`,
    },
    resources: {
      camera,
      color: {
        uLineColor: {
          value: new Float32Array([color.r, color.g, color.b, alpha]),
          type: "vec4<f32>",
        },
      },
    },
  });
  const geometry = new Geometry({
    attributes: {
      aPosition: { buffer: new Float32Array(6), format: "float32x3", stride: 12 },
    },
    topology: "line-list",
  });
  const state = new State();
  state.depthTest = depthTest;
  state.depthMask = false;
  state.blend = true;
  const mesh = new Mesh({ geometry, shader, state });
  mesh.visible = false;
  game.own(() => {
    geometry.destroy(true);
    shader.destroy();
  });
  return {
    mesh,
    setPoints: (points: number[]) => {
      geometry.getBuffer("aPosition").data = new Float32Array(points);
      geometry.getBuffer("aPosition").update();
      mesh.visible = points.length > 0;
    },
  };
};

/**
 * Sky glow around the silhouette: a camera-facing quad through the globe centre,
 * drawn before the surface. uSilhouette is the globe's outline radius in that plane.
 */
export const createGlobeAtmosphere = (
  game: GameRenderer,
  camera: UniformGroup,
  light: UniformGroup,
) => {
  const halo = new UniformGroup({
    uSilhouette: { value: 1, type: "f32" },
  });
  const shader = Shader.from({
    gl: {
      vertex: `precision highp float;
attribute vec2 aCorner;
uniform float uSilhouette;
varying vec2 vCorner;
${globeCameraShader}
void main() {
  vCorner = aCorner * ${ATMOSPHERE_EXTENT.toFixed(2)};
  gl_Position = globeProject((uRight * aCorner.x + uUp * aCorner.y) * uSilhouette * ${ATMOSPHERE_EXTENT.toFixed(2)});
}`,
      fragment: `precision mediump float;
varying vec2 vCorner;
${displayColorShader}
${globeLightShader}
void main() {
  float d = length(vCorner);
  float alpha = d < 1.0 ? 1.0 : exp(-(d - 1.0) * 14.0) * 0.85;
  alpha *= smoothstep(${ATMOSPHERE_EXTENT.toFixed(2)}, 1.0, d) * mix(0.6, 1.0, uShade);
  gl_FragColor = vec4(displayColor(uSky) * alpha, alpha);
}`,
    },
    resources: { camera, light, halo },
  });
  const geometry = new Geometry({
    attributes: {
      aCorner: {
        buffer: new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]),
        format: "float32x2",
        stride: 8,
      },
    },
    indexBuffer: new Uint16Array([0, 1, 2, 0, 2, 3]),
  });
  const state = new State();
  state.depthTest = false;
  state.depthMask = false;
  state.blend = true;
  const mesh = new Mesh({ geometry, shader, state });
  game.own(() => {
    geometry.destroy(true);
    shader.destroy();
  });
  return {
    mesh,
    /** Outline radius of a sphere seen from distance, measured in its centre plane. */
    setView: (radius: number, distance: number) => {
      halo.uniforms.uSilhouette =
        (radius * distance) / Math.sqrt(Math.max(distance ** 2 - radius ** 2, 1e-6));
      halo.update();
    },
  };
};

/**
 * Cloud shell just above the surface: one latitude/longitude sphere whose fragments
 * shade `globeCloudShader` cover with the scene light. uClouds.y darkens storm clouds;
 * clouds fade out with uShade so ownership colours stay unobstructed.
 */
export const createGlobeClouds = (
  game: GameRenderer,
  camera: UniformGroup,
  light: UniformGroup,
  radius: number,
) => {
  const columns = 64,
    rows = 32,
    shell = radius * 1.012;
  const positions = new Float32Array((columns + 1) * (rows + 1) * 3);
  const indices = new Uint16Array(columns * rows * 6);
  for (let row = 0; row <= rows; row++) {
    const latitude = Math.PI / 2 - (row / rows) * Math.PI;
    for (let column = 0; column <= columns; column++) {
      const longitude = (column / columns) * Math.PI * 2;
      const offset = (row * (columns + 1) + column) * 3;
      positions[offset] = shell * Math.cos(latitude) * Math.cos(longitude);
      positions[offset + 1] = shell * Math.sin(latitude);
      positions[offset + 2] = shell * Math.cos(latitude) * Math.sin(longitude);
    }
  }
  let cursor = 0;
  for (let row = 0; row < rows; row++)
    for (let column = 0; column < columns; column++) {
      const a = row * (columns + 1) + column,
        b = a + columns + 1;
      indices.set([a, a + 1, b + 1, a, b + 1, b], cursor);
      cursor += 6;
    }
  const shader = Shader.from({
    gl: {
      vertex: `precision highp float;
attribute vec3 aPosition;
varying vec3 vNormal;
varying vec3 vView;
${globeCameraShader}
void main() {
  vNormal = aPosition;
  vView = uForward * uDistance - aPosition;
  gl_Position = globeProject(aPosition);
}`,
      fragment: `precision mediump float;
varying vec3 vNormal;
varying vec3 vView;
${displayColorShader}
${globeLightShader}
${globePaintShader}
${globeCloudShader}
void main() {
  vec3 normal = normalize(vNormal);
  float alpha = cloudCover(normal) * 0.72 * clamp((uShade - 0.45) / 0.55, 0.0, 1.0);
  alpha *= smoothstep(0.0, 0.18, dot(normal, normalize(vView)));
  if (alpha < 0.004) discard;
  float wrap = clamp((dot(normal, uLight) + 0.15) / 1.15, 0.0, 1.0);
  vec3 color = mix(vec3(1.0), vec3(0.5, 0.53, 0.6), uClouds.y) * (uAmbient + wrap * uSun);
  gl_FragColor = vec4(displayColor(color) * alpha, alpha);
}`,
    },
    resources: { camera, light },
  });
  const geometry = new Geometry({
    attributes: { aPosition: { buffer: positions, format: "float32x3", stride: 12 } },
    indexBuffer: indices,
  });
  const state = new State();
  state.depthTest = true;
  state.depthMask = false;
  state.blend = true;
  const mesh = new Mesh({ geometry, shader, state });
  game.own(() => {
    geometry.destroy(true);
    shader.destroy();
  });
  return { mesh };
};

/**
 * Travel route as a dashed great-circle arc that rises above the surface mid-way;
 * the dashes march toward the destination on the scene clock (uTime).
 */
export const createGlobeRoute = (
  game: GameRenderer,
  camera: UniformGroup,
  light: UniformGroup,
  radius: number,
) => {
  const segments = 64;
  const shader = Shader.from({
    gl: {
      vertex: `precision highp float;
attribute vec3 aPosition;
attribute float aAlong;
varying float vAlong;
${globeCameraShader}
void main() { vAlong = aAlong; gl_Position = globeProject(aPosition); }`,
      fragment: `precision mediump float;
varying float vAlong;
uniform float uRouteLength;
${displayColorShader}
${globeLightShader}
void main() {
  float dash = step(0.45, fract(vAlong * uRouteLength - uTime * 1.6));
  float alpha = mix(0.35, 1.0, dash) * smoothstep(0.0, 0.04, vAlong);
  gl_FragColor = vec4(displayColor(vec3(1.0, 0.82, 0.29)) * alpha, alpha);
}`,
    },
    resources: {
      camera,
      light,
      route: { uRouteLength: { value: 1, type: "f32" } },
    },
  });
  const geometry = new Geometry({
    attributes: {
      aPosition: {
        buffer: new Float32Array(segments * STRANDS * 6),
        format: "float32x3",
        stride: 12,
      },
      aAlong: {
        buffer: new Float32Array(segments * STRANDS * 2),
        format: "float32",
        stride: 4,
      },
    },
    topology: "line-list",
  });
  const state = new State();
  state.depthTest = true;
  state.depthMask = false;
  state.blend = true;
  const mesh = new Mesh({ geometry, shader, state });
  mesh.visible = false;
  game.own(() => {
    geometry.destroy(true);
    shader.destroy();
  });
  return {
    mesh,
    /** Shows the arc between two surface directions, or hides it for null. */
    set: (from: GlobalPoint | null, to: GlobalPoint | null) => {
      const arc = from && to ? createGlobeArc(from, to, radius) : null;
      const angle = arc?.angle ?? 0;
      if (!arc || angle < 1e-3) {
        mesh.visible = false;
        return;
      }
      const positions = new Float32Array(segments * STRANDS * 6),
        along = new Float32Array(segments * STRANDS * 2);
      const at = (t: number, strand: number) => {
        const point = arc.at(t);
        const across = arc.across;
        // Strands sit side by side across the route, so the 1px lines read as one ribbon.
        const offset = (strand - (STRANDS - 1) / 2) * radius * 0.0035;
        return [
          point.x + across.x * offset,
          point.y + across.y * offset,
          point.z + across.z * offset,
        ];
      };
      for (let strand = 0; strand < STRANDS; strand++)
        for (let index = 0; index < segments; index++) {
          const slot = strand * segments + index;
          positions.set(
            [...at(index / segments, strand), ...at((index + 1) / segments, strand)],
            slot * 6,
          );
          along.set([index / segments, (index + 1) / segments], slot * 2);
        }
      geometry.getBuffer("aPosition").data = positions;
      geometry.getBuffer("aPosition").update();
      geometry.getBuffer("aAlong").data = along;
      geometry.getBuffer("aAlong").update();
      const uniforms = shader.resources.route as UniformGroup;
      uniforms.uniforms.uRouteLength = Math.max(4, Math.round(angle * 40));
      uniforms.update();
      mesh.visible = true;
    },
  };
};

/**
 * Sector grid that stays faint across the globe and brightens around a focus
 * direction (the hovered sector), so borders read where the player is aiming.
 */
export const createGlobeGrid = (
  game: GameRenderer,
  camera: UniformGroup,
  color: LinearColor,
) => {
  const grid = new UniformGroup({
    uGridColor: {
      value: new Float32Array([color.r, color.g, color.b]),
      type: "vec3<f32>",
    },
    uGridFocus: { value: new Float32Array([0, 0, 1]), type: "vec3<f32>" },
    uGridAlpha: { value: new Float32Array([0, 0]), type: "vec2<f32>" },
  });
  const shader = Shader.from({
    gl: {
      vertex: `precision highp float; attribute vec3 aPosition; varying vec3 vPoint; ${globeCameraShader} void main() { vPoint = aPosition; gl_Position = globeProject(aPosition); }`,
      fragment: `precision mediump float;
varying vec3 vPoint;
uniform vec3 uGridColor;
uniform vec3 uGridFocus;
uniform vec2 uGridAlpha;
${displayColorShader}
void main() {
  float focus = smoothstep(0.94, 0.99, dot(normalize(vPoint), uGridFocus));
  float alpha = uGridAlpha.x + uGridAlpha.y * focus;
  gl_FragColor = vec4(displayColor(uGridColor) * alpha, alpha);
}`,
    },
    resources: { camera, grid },
  });
  const geometry = new Geometry({
    attributes: {
      aPosition: { buffer: new Float32Array(6), format: "float32x3", stride: 12 },
    },
    topology: "line-list",
  });
  const state = new State();
  state.depthTest = true;
  state.depthMask = false;
  state.blend = true;
  const mesh = new Mesh({ geometry, shader, state });
  game.own(() => {
    geometry.destroy(true);
    shader.destroy();
  });
  return {
    mesh,
    setPoints: (points: number[]) => {
      geometry.getBuffer("aPosition").data = new Float32Array(points);
      geometry.getBuffer("aPosition").update();
    },
    /** Base alpha everywhere, extra alpha near focus (a unit vector, or null for none). */
    setEmphasis: (base: number, focused: number, focus: GlobalPoint | null) => {
      grid.uniforms.uGridAlpha.set([base, focus ? focused : 0]);
      if (focus) grid.uniforms.uGridFocus.set([focus.x, focus.y, focus.z]);
      grid.update();
    },
  };
};

/**
 * Caps over each pole above the navigable latitude. `step` thins them like the surface
 * mesh: columns stay aligned with every surface edge vertex, so the seam has no cracks.
 */
const buildPolarCaps = (map: GlobalMapData, step: number) => {
  const positions: number[] = [],
    colors: number[] = [],
    water: number[] = [],
    indices: number[] = [];
  const columns = Math.round(map.polarCapColumns / step),
    rows = Math.max(4, Math.round(map.polarCapRows / (step * 2)));
  const limit = map.latitudeLimit;
  const radius = (map.radius / 3) * 0.998;
  for (const hemisphere of [-1, 1]) {
    const base = positions.length / 3;
    for (let row = 0; row <= rows; row++) {
      const latitude =
        (((limit + ((90 - limit) * row) / rows) * Math.PI) / 180) * hemisphere;
      for (let column = 0; column <= columns; column++) {
        const longitude = -Math.PI + (2 * Math.PI * column) / columns;
        const point = {
          x: radius * Math.cos(latitude) * Math.cos(longitude),
          y: radius * Math.sin(latitude),
          z: radius * Math.cos(latitude) * Math.sin(longitude),
        };
        const color = samplePolarCapColor(map, point) ?? { x: 0.78, y: 0.91, z: 0.94 };
        positions.push(point.x, point.y, point.z);
        colors.push(color.x, color.y, color.z);
        water.push(surfaceWater(color.x, color.z));
      }
    }
    for (let row = 0; row < rows; row++)
      for (let column = 0; column < columns; column++) {
        const a = base + row * (columns + 1) + column,
          b = a + columns + 1;
        indices.push(a, a + 1, b + 1, a, b + 1, b);
      }
  }
  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    water: new Float32Array(water),
    indices: new Uint16Array(indices),
  };
};
