import { expect, test } from "vitest";
import {
  contrastingTextColor,
  getReadableVillageHexColor,
  parseHexColor,
} from "@/utils/color";

/** Must match MIN_LIGHTNESS / MAX_LIGHTNESS in `@/utils/color`. */
const MIN_LIGHTNESS = 0.28;
const MAX_LIGHTNESS = 0.72;

const hslLightness = (rgb: { r: number; g: number; b: number }) => {
  const rn = rgb.r / 255;
  const gn = rgb.g / 255;
  const bn = rgb.b / 255;
  return (Math.max(rn, gn, bn) + Math.min(rn, gn, bn)) / 2;
};

test("parseHexColor accepts 3- and 6-digit hex", () => {
  expect(parseHexColor("#fff")).toEqual({ r: 255, g: 255, b: 255 });
  expect(parseHexColor("fff")).toEqual({ r: 255, g: 255, b: 255 });
  expect(parseHexColor("003366")).toEqual({ r: 0, g: 51, b: 102 });
  expect(parseHexColor("not-a-color")).toBeNull();
  expect(parseHexColor("")).toBeNull();
  expect(parseHexColor("#ff000080")).toBeNull();
  expect(parseHexColor("rgb(255,0,0)")).toBeNull();
});

test("getReadableVillageHexColor darkens near-white fills", () => {
  const readable = getReadableVillageHexColor("#FFFFFF");
  const rgb = parseHexColor(readable);
  expect(rgb).not.toBeNull();
  expect(hslLightness(rgb!)).toBeCloseTo(MAX_LIGHTNESS, 2);
});

test("getReadableVillageHexColor lightens near-black fills", () => {
  const readable = getReadableVillageHexColor("#000000");
  const rgb = parseHexColor(readable);
  expect(rgb).not.toBeNull();
  expect(hslLightness(rgb!)).toBeCloseTo(MIN_LIGHTNESS, 2);
});

test("getReadableVillageHexColor preserves hue when lifting a dark saturated colour", () => {
  const rgb = parseHexColor(getReadableVillageHexColor("#000080"));
  expect(rgb).not.toBeNull();
  expect(rgb!.b).toBeGreaterThan(rgb!.r);
  expect(rgb!.r).toBe(0);
  expect(rgb!.g).toBe(0);
  expect(hslLightness(rgb!)).toBeCloseTo(MIN_LIGHTNESS, 2);
});

test("getReadableVillageHexColor preserves hue when darkening a light saturated colour", () => {
  const rgb = parseHexColor(getReadableVillageHexColor("#FFE0E0"));
  expect(rgb).not.toBeNull();
  expect(rgb!.r).toBeGreaterThan(rgb!.g);
  expect(rgb!.r).toBeGreaterThan(rgb!.b);
  expect(hslLightness(rgb!)).toBeCloseTo(MAX_LIGHTNESS, 2);
});

test("getReadableVillageHexColor leaves mid-tone colours unchanged in hue band", () => {
  expect(getReadableVillageHexColor("#B22222").toLowerCase()).toBe("#b22222");
  expect(getReadableVillageHexColor("#8FBC8F").toLowerCase()).toBe("#8fbc8f");
});

test("getReadableVillageHexColor falls back for invalid input", () => {
  expect(getReadableVillageHexColor("nope")).toBe("#9ca3af");
});

test("contrastingTextColor picks black on light and white on dark", () => {
  expect(contrastingTextColor("#FFFFFF")).toBe("#000000");
  expect(contrastingTextColor("#000000")).toBe("#FFFFFF");
  expect(contrastingTextColor(getReadableVillageHexColor("#FFFFFF"))).toBe("#000000");
});

test("contrastingTextColor prefers black on #ff0000 (higher contrast than white)", () => {
  // White on #ff0000 is ~4.00:1; black is ~5.25:1 — prefer black.
  expect(contrastingTextColor("#ff0000")).toBe("#000000");
});
