import {
  GLOBE_CLIMATE_HEIGHT,
  GLOBE_CLIMATE_RANGES,
  GLOBE_CLIMATE_WIDTH,
} from "@/libs/rendering/globeClimate";
import { WORLDGEN_RADIUS, wakeIslandGeometry } from "@/libs/sector-map/worldgen";

/** Slope-to-tilt gain of the relief normal; climate elevation spans [-1, 1]. */
const GLOBE_RELIEF = 5;

const wake = wakeIslandGeometry();
const wakeLength = Math.hypot(
  wake.wakeIslandCenter.x,
  wake.wakeIslandCenter.y,
  wake.wakeIslandCenter.z,
);
/** Angular radius of Wake's override, out to where it has blended back into nature. */
const WAKE_REACH = (wake.wakeMoatRadius + wake.wakeIslandRadius) / WORLDGEN_RADIUS;

/**
 * Keep this center-to-camera basis, positive view depth and vertical-FOV projection
 * aligned with globeProjection.ts: CPU picking and marker anchoring use its inverse.
 */
export const globeCameraShader = `
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec3 uForward;
uniform float uDistance;
uniform vec2 uViewport;
uniform float uTanHalfFov;
vec3 cameraPoint(vec3 point) {
  return vec3(dot(point, uRight), dot(point, uUp), uDistance - dot(point, uForward));
}
vec4 globeProject(vec3 point) {
  vec3 view = cameraPoint(point);
  float near = 0.5;
  float far = 1000.0;
  return vec4(view.x / (uTanHalfFov * uViewport.x / uViewport.y),
              view.y / uTanHalfFov,
              (far + near) / (far - near) * view.z - 2.0 * far * near / (far - near), view.z);
}
`;

/**
 * Wrapped sun and ambient light over richer climate colors, with a rippling sun
 * glint on water and an atmospheric rim.
 * uShade scales every effect so data overlays (ownership) stay close to flat color.
 * Normal and view are unit vectors in globe space; water is 0 on land and 1 offshore.
 */
export const globeLightShader = `
uniform vec3 uLight;
uniform vec3 uSun;
uniform vec3 uAmbient;
uniform vec3 uSky;
uniform float uShade;
uniform float uTime;
uniform vec2 uClouds;
vec3 globeLight(vec3 color, float water, vec3 normal, vec3 view) {
  float open = smoothstep(0.6, 1.0, water);
  vec3 base = mix(color, linearColor(color), 0.55);
  float wrap = clamp((dot(normal, uLight) + 0.15) / 1.15, 0.0, 1.0);
  vec3 lit = base * (uAmbient + wrap * uSun);
  float ripple = sin(dot(normal, vec3(41.0, 29.0, 37.0)) + uTime * 1.3)
    * sin(dot(normal, vec3(-33.0, 43.0, 27.0)) - uTime * 0.9);
  float glint = pow(max(dot(normal, normalize(uLight + view)), 0.0), 30.0);
  lit += uSun * glint * (0.45 + 0.2 * ripple) * open;
  float rim = pow(1.0 - max(dot(normal, view), 0.0), 2.5);
  lit = mix(lit, uSky, rim * 0.55);
  return mix(color, lit, uShade);
}
`;

/**
 * Per-pixel biomes from the climate field (`globeClimate.ts`): the coast is thresholded
 * where the land score crosses zero, so shorelines stay smooth curves at any zoom, and
 * the biome blends straddle the thresholds of `globalBiomeType`. Relief drives rock,
 * snow caps and the relief normal on land, and water depth at sea. Colours share the generator's display-space palette.
 */
export const globePaintShader = `
uniform sampler2D uClimate;
const vec2 CLIMATE_TEXEL = vec2(${(1 / GLOBE_CLIMATE_WIDTH).toFixed(8)}, ${(1 / GLOBE_CLIMATE_HEIGHT).toFixed(8)});
vec2 climateUV(vec3 normal) {
  return vec2(atan(normal.z, normal.x) * 0.15915494 + 0.5,
              0.5 - asin(clamp(normal.y, -1.0, 1.0)) * 0.31830989);
}
vec4 climateAt(vec2 uv) {
  vec4 texel = texture2D(uClimate, uv);
  return vec4(${decode("land", "texel.r")}, ${decode("relief", "texel.g")},
              ${decode("temperature", "texel.b")}, ${decode("moisture", "texel.a")});
}
float grainHash(vec3 point) {
  point = fract(point * 0.3183099 + 0.1) * 17.0;
  return fract(point.x * point.y * point.z * (point.x + point.y + point.z));
}
float grainNoise(vec3 point) {
  vec3 cell = floor(point);
  vec3 f = fract(point);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(grainHash(cell), grainHash(cell + vec3(1, 0, 0)), f.x),
        mix(grainHash(cell + vec3(0, 1, 0)), grainHash(cell + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(grainHash(cell + vec3(0, 0, 1)), grainHash(cell + vec3(1, 0, 1)), f.x),
        mix(grainHash(cell + vec3(0, 1, 1)), grainHash(cell + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
const vec3 WAKE_CENTER = vec3(${[wake.wakeIslandCenter.x, wake.wakeIslandCenter.y, wake.wakeIslandCenter.z].map((value) => (value / wakeLength).toFixed(6)).join(", ")});
/**
 * Climate lookup position, bent by low-frequency noise around Wake Island only: its
 * radial worldgen override would otherwise paint a perfectly round moat.
 */
vec2 paintUV(vec3 normal, vec2 uv) {
  float near = dot(normal, WAKE_CENTER);
  if (near < ${Math.cos(WAKE_REACH * 1.3).toFixed(6)}) return uv;
  float reach = 1.0 - smoothstep(${Math.cos(WAKE_REACH * 0.55).toFixed(6)}, ${Math.cos(WAKE_REACH * 1.3).toFixed(6)}, near);
  vec2 bend = vec2(grainNoise(normal * 11.0), grainNoise(normal * 11.0 + 23.0)) - 0.5;
  bend += (vec2(grainNoise(normal * 27.0 + 5.0), grainNoise(normal * 27.0 + 41.0)) - 0.5) * 0.45;
  return uv + bend * reach * ${(WAKE_REACH * 0.55).toFixed(5)} * vec2(0.15915494 / max(length(normal.xz), 0.2), 0.31830989);
}
/** rgb: surface colour; a: open water (0 on land and frozen sea, 1 offshore). */
vec4 paintClimate(vec4 climate, vec3 normal) {
  float elevation = climate.y, temperature = climate.z, moisture = climate.w;
  float grain = grainNoise(normal * 70.0) * 0.65 + grainNoise(normal * 190.0) * 0.35;
  // The grain roughens shorelines and depth bands, so radial landmarks such as
  // Wake Island's moat read as natural coast rather than drawn circles.
  float land = climate.x + (grain - 0.5) * 0.07;
  float water = 1.0 - smoothstep(-0.006, 0.006, land);
  float depth = max(-elevation, 0.0) + (grain - 0.5) * 0.07;
  vec3 sea = mix(vec3(0.38, 0.80, 0.86), vec3(0.20, 0.55, 0.82), smoothstep(0.0, 0.12, depth));
  sea = mix(sea, vec3(0.12, 0.34, 0.66), smoothstep(0.12, 0.45, depth));
  float frozen = 1.0 - smoothstep(-0.34, -0.2, temperature);
  sea = mix(sea, mix(vec3(0.80, 0.89, 0.94), vec3(0.90, 0.95, 0.98), grain), frozen);

  vec3 ground = mix(vec3(0.42, 0.76, 0.38), vec3(0.70, 0.76, 0.42), smoothstep(-0.05, -0.35, moisture));
  float forest = smoothstep(0.06, 0.32, moisture) * smoothstep(-0.16, 0.0, temperature);
  vec3 canopy = mix(vec3(0.22, 0.55, 0.28), vec3(0.16, 0.45, 0.24), grain);
  ground = mix(ground, canopy, forest * smoothstep(0.25, 0.6, grain + forest * 0.3));
  float desert = smoothstep(0.06, 0.18, temperature) * (1.0 - smoothstep(-0.14, -0.02, moisture));
  ground = mix(ground, mix(vec3(0.97, 0.84, 0.56), vec3(0.93, 0.76, 0.48), grain), desert);
  float cold = 1.0 - smoothstep(-0.2, -0.08, temperature);
  float tundra = (1.0 - smoothstep(-0.14, 0.04, temperature)) * (1.0 - cold);
  ground = mix(ground, vec3(0.63, 0.68, 0.57), tundra * 0.8);
  vec3 snow = mix(vec3(0.86, 0.92, 0.95), vec3(0.97, 0.98, 1.0), grain);
  ground = mix(ground, snow, cold);
  float rock = smoothstep(0.46, 0.6, elevation + grain * 0.05);
  ground = mix(ground, mix(vec3(0.62, 0.57, 0.50), vec3(0.52, 0.47, 0.42), grain), rock * 0.8);
  ground = mix(ground, snow, smoothstep(0.68, 0.76, elevation + grain * 0.04));
  float beach = (1.0 - smoothstep(0.004, 0.03, land)) * (1.0 - cold) * (1.0 - rock);
  ground = mix(ground, vec3(0.94, 0.86, 0.64), beach * 0.8);
  return vec4(mix(ground, sea, water), water * (1.0 - frozen));
}
/** Normal tilted by the elevation slope, measured one texel east and south. */
vec3 reliefNormal(vec3 normal, vec2 uv, float elevation) {
  float east = climateAt(uv + vec2(CLIMATE_TEXEL.x, 0.0)).y - elevation;
  float south = climateAt(uv + vec2(0.0, CLIMATE_TEXEL.y)).y - elevation;
  vec3 eastward = normalize(vec3(-normal.z, 0.0, normal.x) + vec3(1e-4, 0.0, 0.0));
  vec3 northward = cross(eastward, normal);
  east /= max(length(normal.xz), 0.2) * 2.0;
  return normalize(normal - (eastward * east - northward * south) * ${GLOBE_RELIEF.toFixed(1)});
}
`;

/** GLSL expression expanding a packed channel; hoisted because the shaders above use it at load. */
function decode(field: keyof typeof GLOBE_CLIMATE_RANGES, channel: string) {
  const [low, high] = GLOBE_CLIMATE_RANGES[field];
  return `${low.toFixed(3)} + ${channel} * ${(high - low).toFixed(3)}`;
}

/**
 * Drifting cloud cover in [0, 1] for a unit direction: three octaves of value noise
 * rotating around the poles at different rates, thresholded by uClouds.x (coverage).
 * Needs globePaintShader's grainNoise and globeLightShader's uniforms.
 */
export const globeCloudShader = `
vec3 cloudDrift(vec3 normal, float rate) {
  float angle = uTime * rate;
  float c = cos(angle), s = sin(angle);
  return vec3(normal.x * c - normal.z * s, normal.y, normal.x * s + normal.z * c);
}
float cloudCover(vec3 normal) {
  float density = grainNoise(cloudDrift(normal, 0.006) * 4.0) * 0.55
    + grainNoise(cloudDrift(normal, 0.009) * 9.0 + 3.1) * 0.3
    + grainNoise(cloudDrift(normal, 0.013) * 21.0 + 7.3) * 0.15;
  density += (1.0 - abs(normal.y)) * 0.08 - 0.04;
  float threshold = 1.0 - uClouds.x;
  return smoothstep(threshold, threshold + 0.22, density);
}
`;
