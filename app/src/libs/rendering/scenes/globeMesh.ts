import {
  BufferImageSource,
  Container,
  Geometry,
  Mesh,
  Shader,
  State,
  UniformGroup,
} from "pixi.js";
import type { LinearColor } from "@/libs/rendering/color";
import type { GameRenderer } from "@/libs/rendering/runtime";
import { globeCameraShader } from "@/libs/rendering/scenes/globeShaders";
import {
  buildGlobeSurfaceData,
  samplePolarCapColor,
} from "@/libs/rendering/scenes/globeSurface";
import { displayColorShader } from "@/libs/rendering/shaders";
import type { GlobalMapData } from "@/libs/sector-map/world-types";

/** Static spherical vertices are projected on the GPU; no CPU vertex rewrite per frame. */
export const createGlobeMesh = (
  game: GameRenderer,
  map: GlobalMapData,
  camera: UniformGroup,
  tint?: (sector: number) => LinearColor | null,
) => {
  const container = new Container();
  const { columns, rows } = map;
  const highlightData = new Uint8Array(columns * rows * 4);
  const highlight = new BufferImageSource({
    resource: highlightData,
    width: columns,
    height: rows,
    format: "rgba8unorm",
    scaleMode: "nearest",
    alphaMode: "no-premultiply-alpha",
  });
  const pulse = new UniformGroup({
    uPhase: { value: 0, type: "f32" },
    uWar: { value: new Float32Array([1, 0, 0]), type: "vec3<f32>" },
  });
  const shader = Shader.from({
    gl: {
      vertex: `precision highp float;
attribute vec3 aPosition;
attribute vec3 aColor;
attribute vec2 aSector;
varying vec3 vColor;
varying vec2 vSector;
${globeCameraShader}
void main() { vColor = aColor; vSector = aSector; gl_Position = globeProject(aPosition); }`,
      fragment: `precision mediump float;
varying vec3 vColor;
varying vec2 vSector;
uniform sampler2D uHighlights;
uniform float uPhase;
uniform vec3 uWar;
${displayColorShader}
void main() {
  float kind = vSector.x < 0.0 ? 0.0 : texture2D(uHighlights, vSector).r;
  vec3 tint = vec3(1.0);
  if (kind > 0.7) tint = mix(vec3(0.66, 0.33, 0.97), vec3(0.33, 0.17, 0.5), uPhase);
  else if (kind > 0.4) tint = mix(uWar, vec3(0.4, 0.0, 0.0), uPhase);
  else if (kind > 0.1) tint = mix(vec3(1.0, 0.55, 0.2), vec3(0.5, 0.28, 0.1), uPhase);
  gl_FragColor = vec4(displayColor(vColor * tint), 1.0);
}`,
    },
    resources: { camera, pulse, uHighlights: highlight },
  });
  const state = new State();
  state.depthTest = true;
  state.depthMask = true;
  state.blend = false;
  const geometries: Geometry[] = [];
  const add = (
    positions: Float32Array,
    colors: Float32Array,
    sectors: Float32Array,
    indices: Uint16Array,
  ) => {
    const geometry = new Geometry({
      attributes: {
        aPosition: { buffer: positions, format: "float32x3", stride: 12 },
        aColor: { buffer: colors, format: "float32x3", stride: 12 },
        aSector: { buffer: sectors, format: "float32x2", stride: 8 },
      },
      indexBuffer: indices,
    });
    geometries.push(geometry);
    container.addChild(new Mesh({ geometry, shader, state }));
  };
  const data = buildGlobeSurfaceData(map, tint);
  const sectors = new Float32Array((data.positions.length / 3) * 2);
  let chunkStart = 0,
    indexStart = 0,
    indexEnd = 0,
    chunkEnd = 0;
  const flush = () => {
    if (chunkEnd === chunkStart) return;
    add(
      data.positions.slice(chunkStart * 3, chunkEnd * 3),
      data.colors.slice(chunkStart * 3, chunkEnd * 3),
      sectors.slice(chunkStart * 2, chunkEnd * 2),
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
    for (let vertex = start; vertex < start + count; vertex++) {
      sectors[vertex * 2] = ((sector % columns) + 0.5) / columns;
      sectors[vertex * 2 + 1] = (Math.floor(sector / columns) + 0.5) / rows;
    }
    chunkEnd = start + count;
    indexEnd += (Math.sqrt(count) - 1) ** 2 * 6;
  }
  flush();
  const poles = buildPolarCaps(map);
  add(
    poles.positions,
    poles.colors,
    new Float32Array((poles.positions.length / 3) * 2).fill(-1),
    poles.indices,
  );
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (!container.destroyed) container.destroy({ children: true });
    for (const geometry of geometries) geometry.destroy(true);
    shader.destroy();
    highlight.destroy();
  };
  game.own(dispose);
  return {
    container,
    dispose,
    setHighlights: (values: { sector: number; type: "quest" | "war" | "focus" }[]) => {
      highlightData.fill(0);
      for (const value of values)
        if (value.sector >= 0 && value.sector < columns * rows) {
          highlightData[value.sector * 4] =
            value.type === "quest" ? 64 : value.type === "war" ? 128 : 192;
        }
      highlight.update();
    },
    setPhase: (phase: number, war: LinearColor) => {
      pulse.uniforms.uPhase = phase;
      pulse.uniforms.uWar.set([war.r, war.g, war.b]);
      pulse.update();
    },
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

const buildPolarCaps = (map: GlobalMapData) => {
  const positions: number[] = [],
    colors: number[] = [],
    indices: number[] = [];
  const columns = map.polarCapColumns,
    rows = map.polarCapRows;
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
    indices: new Uint16Array(indices),
  };
};
