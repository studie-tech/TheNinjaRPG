import sharp from "sharp";

/** Cell sizes battles request; the loader rejects a sheet with larger cells. */
export const SPRITE_SHEET_SMALL_CELL = 128;
export const SPRITE_SHEET_LARGE_CELL = 256;
/** A 32x32 grid of 256-pixel cells is the largest sheet the form can describe. */
const MAX_SHEET_PIXELS = 8192 * 8192;

/** Square cell size of a sheet, or null when its pixels do not divide into the grid. */
export const spriteSheetCell = (
  sheet: { width: number; height: number },
  grid: { columns: number; rows: number },
) => {
  const cell = sheet.width / grid.columns;
  return Number.isInteger(cell) && cell === sheet.height / grid.rows ? cell : null;
};

/** Read a sheet's pixel size without decoding it. */
export const readSpriteSheetSize = async (image: Buffer) => {
  const { width, height } = await sharp(image, {
    limitInputPixels: MAX_SHEET_PIXELS,
  }).metadata();
  return { width, height };
};

/**
 * Downscale cell by cell, because resizing the atlas whole would bleed neighbouring frames.
 * Sharp premultiplies alpha, so transparent pixels never tint a sprite's edge.
 */
export const resizeSpriteSheet = async (
  image: Buffer,
  grid: { columns: number; rows: number; frameCount: number },
  cell: number,
) => {
  const { data, info } = await sharp(image, { limitInputPixels: MAX_SHEET_PIXELS })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const raw = { width: info.width, height: info.height, channels: info.channels };
  const source = info.width / grid.columns;
  const cells = await Promise.all(
    Array.from({ length: grid.frameCount }, async (_, frame) => {
      const column = frame % grid.columns;
      const row = Math.floor(frame / grid.columns);
      const input = await sharp(data, { raw })
        .extract({
          left: column * source,
          top: row * source,
          width: source,
          height: source,
        })
        .resize(cell, cell, { kernel: "mitchell" })
        .raw()
        .toBuffer();
      return {
        input,
        raw: { width: cell, height: cell, channels: info.channels },
        left: column * cell,
        top: row * cell,
      };
    }),
  );
  return sharp({
    create: {
      width: grid.columns * cell,
      height: grid.rows * cell,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(cells)
    .webp({ quality: 90, alphaQuality: 100, effort: 4 })
    .toBuffer();
};
