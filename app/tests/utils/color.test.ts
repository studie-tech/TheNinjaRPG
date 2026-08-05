import { expect, test } from "vitest";
import {
  contrastingTextColor,
  getReadableVillageHexColor,
  parseHexColor,
  relativeLuminance,
} from "@/utils/color";

test("parseHexColor accepts 3- and 6-digit hex", () => {
  expect(parseHexColor("#fff")).toEqual({ r: 255, g: 255, b: 255 });
  expect(parseHexColor("003366")).toEqual({ r: 0, g: 51, b: 102 });
  expect(parseHexColor("not-a-color")).toBeNull();
});

test("getReadableVillageHexColor darkens near-white fills", () => {
  const readable = getReadableVillageHexColor("#FFFFFF");
  const rgb = parseHexColor(readable);
  expect(rgb).not.toBeNull();
  expect(relativeLuminance(rgb!)).toBeLessThan(0.85);
  expect(relativeLuminance(rgb!)).toBeGreaterThan(0.15);
});

test("getReadableVillageHexColor lightens near-black fills", () => {
  const readable = getReadableVillageHexColor("#000000");
  const rgb = parseHexColor(readable);
  expect(rgb).not.toBeNull();
  expect(rgb!.r + rgb!.g + rgb!.b).toBeGreaterThan(0);
  expect(relativeLuminance(rgb!)).toBeGreaterThan(relativeLuminance({ r: 0, g: 0, b: 0 }));
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
