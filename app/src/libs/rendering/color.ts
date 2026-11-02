import { WORLD_DAY_BRIGHTNESS, WORLD_NIGHT_BRIGHTNESS } from "@/drizzle/constants";
import { parseHexColor } from "@/utils/color";

/** Cool moonlight keeps the cycle legible without losing the readable nighttime luminance. */
export const worldLighting = (brightness: number) => {
  const night = Math.max(
    0,
    Math.min(
      1,
      (WORLD_DAY_BRIGHTNESS - brightness) /
        (WORLD_DAY_BRIGHTNESS - WORLD_NIGHT_BRIGHTNESS),
    ),
  );
  const luminance = 1 - night * 0.07;
  const red = Math.round(255 * (1 - night * 0.22) * luminance),
    green = Math.round(255 * (1 - night * 0.15) * luminance),
    blue = Math.round(255 * luminance);
  return {
    night,
    tint: (red << 16) | (green << 8) | blue,
  };
};

/** Normalized linear RGB for the game shaders' explicit display-color conversion. */
export const linearRenderColor = (hex: string): LinearColor => {
  const rgb = parseHexColor(hex);
  if (!rgb) throw new Error(`Invalid rendering color ${hex}`);
  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return { r: channel(rgb.r), g: channel(rgb.g), b: channel(rgb.b) };
};

/** Pixi's straight background RGB must be premultiplied for the WebGL canvas compositor. */
export const premultipliedClearColor = (
  color: number,
  alpha: number,
): [number, number, number] => [
  (((color >>> 16) & 255) / 255) * alpha,
  (((color >>> 8) & 255) / 255) * alpha,
  ((color & 255) / 255) * alpha,
];

export type LinearColor = { r: number; g: number; b: number };
