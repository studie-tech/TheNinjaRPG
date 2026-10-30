import type { GameFrame } from "@/libs/rendering/runtime";

// Bounds share the shader uniforms' Float32 precision and cover subpixel rounding.
export const MAX_WORLD_WIND = 5;
export const MAX_SMALL_WORLD_WIND = Math.fround(2.4);

export type WorldWind = {
  large: Float32Array;
  small: Float32Array;
  key: string;
};

export const STILL_WORLD_WIND: WorldWind = {
  large: new Float32Array(4),
  small: new Float32Array(4),
  key: "0,0,0,0:0,0,0,0",
};

/** Stable phase buckets let neighboring sprites share their sampled gust and shadow uniforms. */
export const worldWindGroup = (phase: number, small = false) =>
  (((Math.round(phase / (Math.PI * 0.5)) % 4) + 4) % 4) + (small ? 4 : 0);

/** Shared subpixel gusts keep vegetation and every shadow pass in the same smooth pose. */
export const sampleWorldWind = (frame: GameFrame, scale: number): WorldWind => {
  if (frame.reducedMotion) return STILL_WORLD_WIND;
  const large = new Float32Array(4),
    small = new Float32Array(4);
  for (let index = 0; index < 4; index++) {
    const phase = frame.now * 0.0008 + index * Math.PI * 0.5;
    const amount = Math.sin(phase) * (0.7 + 0.3 * Math.sin(phase * 0.43));
    // A fine screen-space grid retains imperceptibly small changes without whole-pixel jumps.
    const steps = scale * 64;
    large[index] = Math.round(amount * MAX_WORLD_WIND * 0.5 * steps) / steps;
    small[index] = Math.round(amount * MAX_SMALL_WORLD_WIND * 0.5 * steps) / steps;
  }
  return { large, small, key: `${large}:${small}` };
};

/** Zero is still; codes one through eight select shared large/small vegetation phases. */
export const worldWindShader = `
uniform vec4 uWind;
uniform vec4 uWindSmall;
float worldWind(float code) {
  if (code < 0.5) return 0.0;
  vec4 offsets = code < 4.5 ? uWind : uWindSmall;
  float phase = mod(code - 1.0, 4.0);
  return phase < 0.5 ? offsets.x : phase < 1.5 ? offsets.y : phase < 2.5 ? offsets.z : offsets.w;
}
`;
