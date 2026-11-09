import { describe, expect, it } from "bun:test";
import sharp from "sharp";
import { resizeSpriteSheet, spriteSheetCell } from "@/libs/spriteSheetSizes";

/** Two-frame sheet: an opaque red cell beside an empty one. */
const sheet = async (cell: number) =>
  sharp({
    create: {
      width: cell * 2,
      height: cell,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: {
          create: { width: cell, height: cell, channels: 4, background: "#ff0000" },
        },
        left: 0,
        top: 0,
      },
    ])
    .png()
    .toBuffer();

describe("sprite sheet sizes", () => {
  it("reads square cells and refuses sheets that do not fit the grid", () => {
    expect(spriteSheetCell({ width: 1024, height: 512 }, { columns: 4, rows: 2 })).toBe(
      256,
    );
    expect(
      spriteSheetCell({ width: 1000, height: 512 }, { columns: 4, rows: 2 }),
    ).toBeNull();
    expect(
      spriteSheetCell({ width: 1024, height: 256 }, { columns: 4, rows: 2 }),
    ).toBeNull();
  });

  it("never bleeds one frame into its neighbour", async () => {
    const grid = { columns: 2, rows: 1, frameCount: 2 };
    const small = await resizeSpriteSheet(await sheet(512), grid, 128);
    const { data, info } = await sharp(small)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([256, 128]);
    const alpha = (x: number, y: number) =>
      data[(y * info.width + x) * info.channels + 3];
    expect(alpha(127, 64)).toBeGreaterThan(240);
    expect(alpha(128, 64)).toBe(0);
  });

  it("leaves unused grid cells empty", async () => {
    const grid = { columns: 2, rows: 2, frameCount: 1 };
    const image = await sharp({
      create: { width: 400, height: 400, channels: 4, background: "#00ff00" },
    })
      .png()
      .toBuffer();
    const { data, info } = await sharp(await resizeSpriteSheet(image, grid, 128))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(data[(64 * info.width + 64) * info.channels + 3]).toBeGreaterThan(240);
    expect(data[(64 * info.width + 192) * info.channels + 3]).toBe(0);
  });
});
