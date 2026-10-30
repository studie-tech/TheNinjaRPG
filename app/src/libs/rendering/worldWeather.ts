import alea from "alea";
import { Container, Geometry, Mesh, Shader, UniformGroup } from "pixi.js";
import type { CombatBiome } from "@/drizzle/constants";
import type { GameFrame, GameRenderer } from "@/libs/rendering/runtime";
import { clamp } from "@/utils/math";

/** One texture-free draw places pixel precipitation above world art and below identity/UI layers. */
export const createWorldWeather = (game: GameRenderer, lightLayout = false) => {
  const container = new Container({ label: "world-weather", eventMode: "none" });
  const capacity = lightLayout ? 96 : 384;
  const atmosphere = lightLayout ? 3 : 9;
  let geometry: Geometry | undefined, shader: Shader | undefined;
  let disposed = false;
  // View packs viewport, pixel size and density; weather packs clock, kind, strength and ambient light.
  const uniforms = new UniformGroup({
    uView: { value: new Float32Array(4), type: "vec4<f32>" },
    uWeather: { value: new Float32Array(4), type: "vec4<f32>" },
    uCamera: { value: new Float32Array(2), type: "vec2<f32>" },
  });
  container.visible = false;
  game.own(() => {
    disposed = true;
    geometry?.destroy(true);
    shader?.destroy();
  });
  return {
    container,
    /** Only uniforms change per frame; clear skies and reduced motion submit no weather draw. */
    update: (
      frame: GameFrame,
      weather: WorldWeather,
      camera: { x: number; y: number },
      brightness = 1,
    ) => {
      if (disposed) return;
      const strength = Number.isFinite(weather.intensity)
        ? clamp(weather.intensity, 0, 1)
        : 0;
      container.visible =
        weather.kind !== "clear" && strength > 0 && !frame.reducedMotion;
      if (!container.visible) return;
      if (!geometry) {
        const random = alea("world-weather");
        const positions = new Float32Array((capacity + atmosphere) * 8);
        const seeds = new Float32Array((capacity + atmosphere) * 16);
        const indices = new Uint16Array((capacity + atmosphere) * 6);
        for (let i = 0; i < capacity + atmosphere; i++) {
          // Negative weights reserve atmosphere quads; nonnegative weights rank precipitation density.
          const seed = [
            random(),
            random(),
            random(),
            i < atmosphere ? (i === 0 ? -1 : -2) : (i - atmosphere) / capacity,
          ];
          positions.set([0, 0, 1, 0, 1, 1, 0, 1], i * 8);
          for (let vertex = 0; vertex < 4; vertex++)
            seeds.set(seed, i * 16 + vertex * 4);
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
          resources: { weather: uniforms },
        });
        container.addChild(
          new Mesh({ geometry, shader, label: "weather-particles", eventMode: "none" }),
        );
      }
      const width = Math.max(1, game.renderer.width),
        height = Math.max(1, game.renderer.height);
      const view = uniforms.uniforms.uView,
        state = uniforms.uniforms.uWeather,
        offset = uniforms.uniforms.uCamera;
      view[0] = width;
      view[1] = height;
      view[2] = Math.max(1, Math.floor(width / 700));
      view[3] = Math.min(capacity, Math.ceil((width * height) / 1800)) / capacity;
      // Power-of-two travel rates and sway periods meet at this clock seam without a particle jump.
      state[0] = (((frame.now % 64_000) + 64_000) % 64_000) / 1000;
      state[1] = weather.kind === "rain" ? 1 : weather.kind === "snow" ? 2 : 3;
      state[2] = strength;
      state[3] = Number.isFinite(brightness) ? clamp(brightness, 0, 1) : 1;
      // Camera coordinates stay bounded by the retained map window; each layer wraps its own field.
      offset[0] = camera.x;
      offset[1] = camera.y;
      uniforms.update();
    },
  };
};

/** Shared server-corrected visual fronts fade smoothly; snow/ice and desert select their own precipitation. */
export const getWorldWeather = (biome: CombatBiome, now: number): WorldWeather => {
  if (!Number.isFinite(now) || biome === "default")
    return { kind: "clear", intensity: 0 };
  const intensity = Math.max(0, Math.sin((now * Math.PI * 2) / 720_000)) ** 2 * 0.7;
  return {
    kind:
      intensity <= 0.001
        ? "clear"
        : biome === "dessert"
          ? "sandstorm"
          : biome === "snow" || biome === "ice"
            ? "snow"
            : "rain",
    intensity,
  };
};

// Explicit canvas coordinates keep the weather field independent of the parent's Y-up camera transform.
// All per-particle arithmetic runs on vertices; fragments only shape flakes and stepped dust haze.
const vertex = `precision highp float;
attribute vec2 aPosition;
attribute vec4 aSeed;
uniform vec4 uView;
uniform vec4 uWeather;
uniform vec2 uCamera;
varying vec2 vUV;
varying vec4 vColor;
varying float vFlake;
void main() {
  float time = uWeather.x, kind = uWeather.y, strength = uWeather.z;
  float light = 0.45 + 0.55 * uWeather.w;
  vec2 size = uView.xy, point;
  vUV = aPosition; vFlake = 0.0;
  if (aSeed.w < -1.5) {
    if (kind < 2.5) { gl_Position = vec4(2.0, 2.0, 0.0, 1.0); vColor = vec4(0.0); return; }
    vec2 extent = size + vec2(size.x * 0.75, 96.0);
    vec2 center = mod(aSeed.xy * extent + time * extent * vec2(0.25, 0.015625) + uCamera * 0.25, extent) - vec2(size.x * 0.375, 48.0);
    point = center + (aPosition - 0.5) * vec2(size.x * 0.75, 48.0 + aSeed.z * 24.0);
    vColor = vec4(0.82, 0.65, 0.36, 0.18 * strength);
    vFlake = -1.0;
  } else if (aSeed.w < 0.0) {
    point = aPosition * size;
    vColor = kind < 1.5 ? vec4(0.24, 0.36, 0.44, 0.045) : kind < 2.5 ? vec4(0.65, 0.76, 0.80, 0.025) : vec4(0.65, 0.45, 0.23, 0.22);
    vColor.a *= strength;
  } else {
    if (aSeed.w >= uView.w * strength) { gl_Position = vec4(2.0, 2.0, 0.0, 1.0); vColor = vec4(0.0); return; }
    float layer = floor(aSeed.z * 3.0), depth = 0.5 + layer * 0.25;
    vec2 extent = size + 48.0;
    vec2 travel, glyph, direction;
    if (kind < 1.5) {
      travel = vec2(0.125, 0.75 + layer * 0.25);
      glyph = vec2(1.0, 6.0 + layer * 3.0) * uView.z;
      direction = normalize(travel * extent);
      vColor = vec4(0.60, 0.78, 0.85, 0.27 + depth * 0.3);
    } else if (kind < 2.5) {
      travel = vec2(0.015625, 0.03125 + layer * 0.015625);
      glyph = vec2(1.0 + layer) * uView.z;
      direction = vec2(0.0, 1.0);
      vFlake = layer;
      vColor = vec4(0.89, 0.95, 0.97, 0.45 + depth * 0.4);
    } else {
      travel = vec2(0.5 + layer * 0.25, 0.0625);
      glyph = vec2(1.0, 3.0 + layer * 2.0) * uView.z;
      direction = normalize(travel * extent);
      vColor = vec4(mix(vec3(0.53, 0.34, 0.15), vec3(0.94, 0.78, 0.43), aSeed.x), 0.3 + depth * 0.4);
    }
    point = mod(aSeed.xy * extent + travel * extent * time + uCamera * depth, extent) - 24.0;
    if (kind > 1.5 && kind < 2.5) point.x += sin(time * 0.7853981634 + aSeed.x * 6.283185307) * (3.0 + layer * 3.0);
    point += vec2(direction.y, -direction.x) * (aPosition.x - 0.5) * glyph.x + direction * (aPosition.y - 0.5) * glyph.y;
  }
  vColor.rgb *= light;
  gl_Position = vec4(point / size * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0);
}`;

const fragment = `precision mediump float;
varying vec2 vUV;
varying vec4 vColor;
varying float vFlake;
void main() {
  if (vFlake < -0.5) {
    vec2 taper = max(vec2(0.0), 1.0 - abs(vUV * 2.0 - 1.0));
    float alpha = vColor.a * floor(taper.x * taper.y * 4.0) / 4.0;
    gl_FragColor = vec4(vColor.rgb * alpha, alpha);
    return;
  }
  if (vFlake > 1.5 && abs(vUV.x - 0.5) > 0.18 && abs(vUV.y - 0.5) > 0.18) discard;
  gl_FragColor = vec4(vColor.rgb * vColor.a, vColor.a);
}`;

export type WorldWeather = {
  kind: "clear" | "rain" | "snow" | "sandstorm";
  intensity: number;
};
