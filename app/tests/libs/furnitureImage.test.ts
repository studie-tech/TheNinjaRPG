import { describe, expect, it } from "bun:test";
import { furnitureGeometryFromPixels } from "@/libs/furnitureImage";
import { furnitureGeometrySchema } from "@/validators/itemFurniture";

describe("furniture cutout geometry", () => {
  it("uses visible alpha for tight selection and leaves faint shadows outside it", () => {
    const pixels = new Uint8Array(8 * 6 * 4);
    for (let y = 1; y < 5; y++)
      for (let x = 2; x < 6; x++) pixels[(y * 8 + x) * 4 + 3] = 255;
    pixels[3] = 16;
    const geometry = furnitureGeometryFromPixels(pixels, 8, 6, 4, false);
    expect(geometry.aspectRatio).toBe(8 / 6);
    expect(geometry.visibleBounds.x).toBe(25);
    expect(geometry.visibleBounds.y).toBeCloseTo(100 / 6);
    expect(geometry.visibleBounds.width).toBe(50);
    expect(geometry.visibleBounds.height).toBeCloseTo(400 / 6);
    expect(geometry.footprint.x).toBe(25);
    expect(geometry.footprint.y).toBeCloseTo(100 / 6 + 50);
    expect(geometry.footprint.width).toBe(50);
    expect(geometry.footprint.height).toBeCloseTo(100 / 6);
    expect(furnitureGeometrySchema.safeParse(geometry).success).toBe(true);
  });

  it("lets floor decorations occupy their full painted surface", () => {
    const pixels = new Uint8Array(2 * 3 * 4).fill(255);
    const geometry = furnitureGeometryFromPixels(pixels, 2, 3, 4, true);
    expect(geometry.visibleBounds).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    expect(geometry.footprint).toEqual(geometry.visibleBounds);
    expect(geometry.aspectRatio).toBe(2 / 3);
  });

  it("rejects cutouts with no visible furniture", () => {
    expect(() =>
      furnitureGeometryFromPixels(new Uint8Array(16), 2, 2, 4, false),
    ).toThrow("empty");
  });
});
