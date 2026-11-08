import alea from "alea";
import { type Container, Geometry, Mesh, Shader, UniformGroup } from "pixi.js";
import type { GameFrame, GameRenderer } from "@/libs/rendering/runtime";

/** World units: the widest ellipse a cloud's lobes roughen. */
const CLOUD_RADIUS = 190;
const LOBE_DEPTH = 0.3;
/**
 * Lobes push the outline past its ellipse, by at most 1.5 lobe units where both peak together;
 * quads reach that far so no cloud is clipped flat at a quad side.
 */
const CLOUD_EXTENT = Math.sqrt(1 + LOBE_DEPTH * 1.5);
/** A cloud's reach decides how far it must leave the canvas before wrapping. */
const CLOUD_REACH = CLOUD_RADIUS * CLOUD_EXTENT;
const MIN_FIELD = 2048;
const DRIFT = { x: 16, y: 6 };
const PEAK_OPACITY = 0.26;

/** A power of two holds the field steady while zooming, except where the view outgrows it. */
const fieldSize = (visible: number) =>
  2 ** Math.ceil(Math.log2(Math.max(MIN_FIELD, visible + CLOUD_REACH * 2)));

/**
 * A handful of soft quads rides the ground, so fragments are only spent under a cloud.
 * The mesh is built on first use and only uniforms change per frame.
 */
export const createWorldCloudShadows = (
  game: GameRenderer,
  parent: Container,
  lightLayout = false,
) => {
  const columns = lightLayout ? 4 : 6;
  const count = columns * columns;
  let mesh: Mesh<Geometry, Shader> | undefined,
    geometry: Geometry | undefined,
    shader: Shader | undefined;
  // View packs viewport, world scale and opacity; field packs wrapped offset and period in canvas pixels.
  const uniforms = new UniformGroup({
    uView: { value: new Float32Array(4), type: "vec4<f32>" },
    uField: { value: new Float32Array(4), type: "vec4<f32>" },
  });
  game.own(() => {
    geometry?.destroy(true);
    shader?.destroy();
  });
  const build = () => {
    const random = alea("world-cloud-shadows");
    const positions = new Float32Array(count * 8);
    const seeds = new Float32Array(count * 16);
    const indices = new Uint16Array(count * 6);
    for (let i = 0; i < count; i++) {
      // A jittered grid keeps cover even, so no viewport spends minutes without a cloud.
      const seed = [
        ((i % columns) + random() * 0.7) / columns,
        (Math.floor(i / columns) + random() * 0.7) / columns,
        random(),
        random(),
      ];
      positions.set([0, 0, 1, 0, 1, 1, 0, 1], i * 8);
      for (let vertex = 0; vertex < 4; vertex++) seeds.set(seed, i * 16 + vertex * 4);
      const base = i * 4;
      indices.set([base, base + 1, base + 2, base, base + 2, base + 3], i * 6);
    }
    geometry = new Geometry({
      attributes: {
        aPosition: { buffer: positions, format: "float32x2" },
        aSeed: { buffer: seeds, format: "float32x4" },
      },
      indexBuffer: indices,
    });
    shader = Shader.from({
      gl: { vertex, fragment },
      resources: { clouds: uniforms },
    });
    const created = new Mesh({
      geometry,
      shader,
      label: "weather-cloud-shadows",
      eventMode: "none",
    });
    parent.addChild(created);
    return created;
  };
  return {
    hide: () => {
      if (mesh) mesh.visible = false;
    },
    /** Camera is the world's canvas offset, so the field stays attached to the ground. */
    update: (
      frame: GameFrame,
      strength: number,
      camera: { x: number; y: number },
      scale: number,
    ) => {
      mesh ??= build();
      mesh.visible = true;
      const width = Math.max(1, game.renderer.width),
        height = Math.max(1, game.renderer.height);
      const worldScale = Math.max(0.001, scale);
      const fieldWidth = fieldSize(width / worldScale),
        fieldHeight = fieldSize(height / worldScale);
      const seconds = frame.now / 1000;
      const view = uniforms.uniforms.uView,
        field = uniforms.uniforms.uField;
      view[0] = width;
      view[1] = height;
      view[2] = worldScale;
      view[3] = strength * PEAK_OPACITY;
      field[0] =
        (((seconds * DRIFT.x) % fieldWidth) * worldScale + camera.x) %
        (fieldWidth * worldScale);
      field[1] =
        (((seconds * DRIFT.y) % fieldHeight) * worldScale + camera.y) %
        (fieldHeight * worldScale);
      field[2] = fieldWidth * worldScale;
      field[3] = fieldHeight * worldScale;
      uniforms.update();
    },
  };
};

// Clouds wrap while wholly offscreen. Stretch follows the wind so overlapping lobes read as one bank.
const vertex = `precision highp float;
attribute vec2 aPosition;
attribute vec4 aSeed;
uniform vec4 uView;
uniform vec4 uField;
varying vec2 vPoint;
varying vec2 vPhase;
varying float vOpacity;
void main() {
  float reach = ${CLOUD_REACH.toFixed(3)} * uView.z;
  vec2 radius = vec2(0.58 + aSeed.z * 0.42, 0.34 + aSeed.w * 0.26) * ${CLOUD_RADIUS.toFixed(1)} * uView.z;
  vec2 center = mod(aSeed.xy * uField.zw + uField.xy + reach, uField.zw) - reach;
  vPoint = (aPosition * 2.0 - 1.0) * ${CLOUD_EXTENT.toFixed(4)};
  vec2 point = center + vPoint * radius;
  vPhase = (aSeed.zw + aSeed.yx) * 6.283185307;
  vOpacity = uView.w;
  gl_Position = vec4(point / uView.xy * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0);
}`;

// Two sine products roughen each ellipse, keeping the effect free of textures and uploads.
const fragment = `precision mediump float;
varying vec2 vPoint;
varying vec2 vPhase;
varying float vOpacity;
void main() {
  float lobes = sin(vPoint.x * 3.1 + vPhase.x) * sin(vPoint.y * 3.7 + vPhase.y)
    + 0.5 * sin(vPoint.x * 7.3 - vPhase.y) * sin(vPoint.y * 6.1 + vPhase.x);
  float edge = 1.0 - dot(vPoint, vPoint) + lobes * ${LOBE_DEPTH.toFixed(2)};
  float alpha = vOpacity * clamp(edge * 3.0, 0.0, 1.0);
  gl_FragColor = vec4(vec3(0.03, 0.05, 0.11) * alpha, alpha);
}`;
