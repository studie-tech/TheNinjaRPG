import sharp from "sharp";
import {
  readSpriteSheetSize,
  resizeSpriteSheet,
  SPRITE_SHEET_LARGE_CELL,
  SPRITE_SHEET_SMALL_CELL,
  spriteSheetCell,
} from "@/libs/spriteSheetSizes";

/** How far each frame's colour moves toward the art; the rest keeps the model's shading. */
const COLOUR_PULL = 0.85;
/** Rows of sink that stay invisible at gameplay size. */
const SINK_TOLERANCE = 2;
/** Lab chroma below this is too grey to tell keying bleed from shading. */
const BLEED_CHROMA = 9;
/** Lab distance beyond which a colour was not in the art. */
const BLEED_DISTANCE = 9;
const PALETTE_BANDS = 8;
const PALETTE_BAND_SAMPLES = 600;
const PALETTE_SAMPLES = 1500;
const SOLID = 128;
const FAINT = 8;
const CHANNELS = 4;

/**
 * Turn a generated sheet into the two atlases battles load. Generated frames sit in the
 * generator's own framing and run brighter than the art, so a clip would jump and shift
 * tone when it takes over from a sheet drawn from the same character.
 */
export const finishSpriteSheet = async (
  sheet: Buffer,
  art: Buffer,
  grid: { columns: number; rows: number; frameCount: number },
) => {
  const cell = SPRITE_SHEET_LARGE_CELL;
  if (spriteSheetCell(await readSpriteSheetSize(sheet), grid) !== cell)
    throw new Error("The generated sheet does not match its reported grid");
  const frames = await readFrames(sheet, grid, cell);
  const reference = await readArt(art, cell);
  const placed = reference ? alignToArt(frames, reference, cell) : frames;
  const seated = seatFrames(placed, cell);
  const restored = reference ? restorePalette(seated, reference, cell) : seated;
  const matched = reference ? matchColours(restored, reference, cell) : restored;
  const atlas = await writeAtlas(matched, grid, cell);
  const [large, small] = await Promise.all([
    resizeSpriteSheet(atlas, grid, SPRITE_SHEET_LARGE_CELL),
    resizeSpriteSheet(atlas, grid, SPRITE_SHEET_SMALL_CELL),
  ]);
  return { large, small };
};

/** Scale and place every frame by one transform, so the first frame covers the art. */
export const alignToArt = (frames: Uint8Array[], art: Uint8Array, cell: number) => {
  const from = solidBox(frames[0] as Uint8Array, cell);
  const to = solidBox(art, cell);
  if (!from || !to) return frames;
  const scale = (to.bottom - to.top) / (from.bottom - from.top);
  const shiftX = (to.left + to.right) / 2 - ((from.left + from.right) / 2) * scale;
  const shiftY = to.bottom - from.bottom * scale;
  return frames.map((frame) => {
    const out = new Uint8Array(frame.length);
    for (let y = 0; y < cell; y += 1) {
      const sourceY = Math.floor((y + 0.5 - shiftY) / scale);
      if (sourceY < 0 || sourceY >= cell) continue;
      for (let x = 0; x < cell; x += 1) {
        const sourceX = Math.floor((x + 0.5 - shiftX) / scale);
        if (sourceX < 0 || sourceX >= cell) continue;
        const from = (sourceY * cell + sourceX) * CHANNELS;
        out.set(frame.subarray(from, from + CHANNELS), (y * cell + x) * CHANNELS);
      }
    }
    return out;
  });
};

/** Combat seats the shadow on the first frame's contact, so no frame may sink below it. */
export const seatFrames = (frames: Uint8Array[], cell: number) => {
  const first = frames[0] as Uint8Array;
  const rest = contactRow(first, cell, 1);
  const cleaned = frames.map((frame) => dropGroundSpecks(frame, cell, rest));
  const sink = cleaned.map((frame) =>
    Math.max(0, contactRow(frame, cell, 2) - rest - SINK_TOLERANCE),
  );
  // Spreading each lift to its neighbours keeps the loop from jittering.
  const spread = sink.map((_, index) =>
    Math.max(
      sink[index] as number,
      sink[(index + 1) % sink.length] as number,
      sink[(index - 1 + sink.length) % sink.length] as number,
    ),
  );
  spread[0] = 0;
  return cleaned.map((frame, index) => liftFrame(frame, cell, spread[index] as number));
};

/**
 * Generation keys frames off a flat background that tints fast limbs. Colours the art never
 * used take its paint from the same height, at the closest lightness to keep the shading.
 */
export const restorePalette = (frames: Uint8Array[], art: Uint8Array, cell: number) => {
  const palette = artPalette(art, cell);
  if (!palette) return frames;
  return frames.map((frame) => {
    const out = frame.slice();
    for (let y = 0; y < cell; y += 1) {
      for (let x = 0; x < cell; x += 1) {
        const start = (y * cell + x) * CHANNELS;
        if ((out[start + 3] as number) < FAINT) continue;
        const lab = toLab(
          out[start] as number,
          out[start + 1] as number,
          out[start + 2] as number,
        );
        if (Math.hypot(lab[1], lab[2]) <= BLEED_CHROMA) continue;
        if (palette.all.some((paint) => labDistance(lab, paint.lab) <= BLEED_DISTANCE))
          continue;
        const band = Math.floor((y - palette.top) / palette.bandHeight);
        const clamped = Math.min(PALETTE_BANDS - 1, Math.max(0, band));
        const nearest = (palette.bands[clamped] as Paint[]).reduce((best, paint) =>
          Math.abs(paint.lab[0] - lab[0]) < Math.abs(best.lab[0] - lab[0])
            ? paint
            : best,
        );
        out.set(nearest.rgb, start);
      }
    }
    return out;
  });
};

/** Pull each frame's mean and spread back to the art, per colour channel. */
export const matchColours = (frames: Uint8Array[], art: Uint8Array, cell: number) => {
  const target = colourStats(art);
  if (!target) return frames;
  return frames.map((frame) => {
    const stats = colourStats(frame);
    if (!stats) return frame;
    const out = frame.slice();
    const gain = stats.spread.map((spread, channel) => {
      const ratio = (target.spread[channel] as number) / Math.max(spread, 1);
      return 1 + COLOUR_PULL * (Math.min(1.25, Math.max(0.8, ratio)) - 1);
    });
    for (let pixel = 0; pixel < cell * cell; pixel += 1) {
      const start = pixel * CHANNELS;
      for (let channel = 0; channel < 3; channel += 1) {
        const mean = stats.mean[channel] as number;
        const shifted =
          ((out[start + channel] as number) - mean) * (gain[channel] as number) +
          mean +
          COLOUR_PULL * ((target.mean[channel] as number) - mean);
        out[start + channel] = Math.round(Math.min(255, Math.max(0, shifted)));
      }
    }
    return out;
  });
};

/** Sample the art's paint overall and per overlapping height band. */
const artPalette = (art: Uint8Array, cell: number) => {
  const box = solidBox(art, cell);
  if (!box) return null;
  const bandHeight = (box.bottom - box.top) / PALETTE_BANDS;
  const paints: { y: number; paint: Paint }[] = [];
  for (let y = box.top; y < box.bottom; y += 1) {
    for (let x = 0; x < cell; x += 1) {
      const start = (y * cell + x) * CHANNELS;
      if ((art[start + 3] as number) <= 200) continue;
      const rgb: Paint["rgb"] = [
        art[start] as number,
        art[start + 1] as number,
        art[start + 2] as number,
      ];
      paints.push({ y, paint: { rgb, lab: toLab(...rgb) } });
    }
  }
  if (!paints.length) return null;
  const bands = Array.from({ length: PALETTE_BANDS }, (_, band) => {
    const low = box.top + Math.max(0, band - 0.5) * bandHeight;
    const high = box.top + Math.min(PALETTE_BANDS, band + 1.5) * bandHeight;
    const inside = paints.filter(({ y }) => y >= low && y < high);
    return evenSample(inside.length >= 20 ? inside : paints, PALETTE_BAND_SAMPLES).map(
      ({ paint }) => paint,
    );
  });
  const all = evenSample(paints, PALETTE_SAMPLES).map(({ paint }) => paint);
  return { all, bands, top: box.top, bandHeight };
};

const evenSample = <T>(items: T[], size: number) => {
  const stride = Math.max(1, items.length / size);
  return Array.from(
    { length: Math.min(size, items.length) },
    (_, index) => items[Math.floor(index * stride)] as T,
  );
};

const labDistance = (a: Lab, b: Lab) =>
  Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);

/** sRGB to CIE Lab under D65, where distance tracks visible colour difference. */
const toLab = (red: number, green: number, blue: number): Lab => {
  const [r, g, b] = [red, green, blue].map((value) => {
    const channel = value / 255;
    return channel > 0.04045 ? ((channel + 0.055) / 1.055) ** 2.4 : channel / 12.92;
  }) as [number, number, number];
  const fit = (value: number) =>
    value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116;
  const x = fit((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const y = fit(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = fit((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
};

/** Clear pieces under the contact that do not touch the figure, such as a stray shadow. */
const dropGroundSpecks = (frame: Uint8Array, cell: number, rest: number) => {
  const labels = new Int32Array(cell * cell);
  const pieces: { pixels: number[]; bottom: number; top: number }[] = [];
  for (let start = 0; start < labels.length; start += 1) {
    if (labels[start] || (frame[start * CHANNELS + 3] as number) < FAINT) continue;
    const pixels = [start];
    labels[start] = pieces.length + 1;
    let top = cell;
    let bottom = 0;
    for (let index = 0; index < pixels.length; index += 1) {
      const pixel = pixels[index] as number;
      const y = Math.floor(pixel / cell);
      const x = pixel % cell;
      top = Math.min(top, y);
      bottom = Math.max(bottom, y + 1);
      for (let ny = Math.max(0, y - 1); ny <= Math.min(cell - 1, y + 1); ny += 1) {
        for (let nx = Math.max(0, x - 1); nx <= Math.min(cell - 1, x + 1); nx += 1) {
          const next = ny * cell + nx;
          if (labels[next] || (frame[next * CHANNELS + 3] as number) < FAINT) continue;
          labels[next] = pieces.length + 1;
          pixels.push(next);
        }
      }
    }
    pieces.push({ pixels, top, bottom });
  }
  if (pieces.length < 2) return frame;
  const largest = pieces.reduce((best, piece) =>
    piece.pixels.length > best.pixels.length ? piece : best,
  );
  const out = frame.slice();
  for (const piece of pieces) {
    if (piece === largest || piece.bottom <= rest + 2 || piece.top < rest - 24)
      continue;
    for (const pixel of piece.pixels)
      out.fill(0, pixel * CHANNELS, (pixel + 1) * CHANNELS);
  }
  return out;
};

const liftFrame = (frame: Uint8Array, cell: number, rows: number) => {
  if (!rows) return frame;
  const out = new Uint8Array(frame.length);
  out.set(frame.subarray(rows * cell * CHANNELS));
  return out;
};

/** One past the lowest row with enough solid pixels; single wisps do not move a frame. */
const contactRow = (frame: Uint8Array, cell: number, width: number) => {
  for (let y = cell - 1; y >= 0; y -= 1) {
    let solid = 0;
    for (let x = 0; x < cell; x += 1)
      if ((frame[(y * cell + x) * CHANNELS + 3] as number) >= SOLID) solid += 1;
    if (solid >= width) return y + 1;
  }
  return 0;
};

const solidBox = (frame: Uint8Array, cell: number) => {
  let left = cell;
  let right = 0;
  let top = cell;
  let bottom = 0;
  for (let y = 0; y < cell; y += 1) {
    for (let x = 0; x < cell; x += 1) {
      if ((frame[(y * cell + x) * CHANNELS + 3] as number) < SOLID) continue;
      left = Math.min(left, x);
      right = Math.max(right, x + 1);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y + 1);
    }
  }
  return right > left && bottom > top ? { left, right, top, bottom } : null;
};

const colourStats = (frame: Uint8Array) => {
  const totals = [0, 0, 0];
  const squares = [0, 0, 0];
  let count = 0;
  for (let start = 0; start < frame.length; start += CHANNELS) {
    if ((frame[start + 3] as number) < SOLID) continue;
    count += 1;
    for (let channel = 0; channel < 3; channel += 1) {
      const value = frame[start + channel] as number;
      totals[channel] = (totals[channel] as number) + value;
      squares[channel] = (squares[channel] as number) + value * value;
    }
  }
  if (count < 50) return null;
  const mean = totals.map((total) => total / count);
  const spread = squares.map((square, channel) =>
    Math.sqrt(Math.max(0, square / count - (mean[channel] as number) ** 2)),
  );
  return { mean, spread };
};

/** Fit the art into one cell the way the sprite pipeline does; opaque art has no outline. */
const readArt = async (art: Buffer, cell: number) => {
  const { data } = await sharp(art)
    .ensureAlpha()
    .resize(cell, cell, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = new Uint8Array(data);
  const box = solidBox(pixels, cell);
  const filled = box && box.right - box.left === cell && box.bottom - box.top === cell;
  return filled ? null : pixels;
};

const readFrames = async (
  sheet: Buffer,
  grid: { columns: number; frameCount: number },
  cell: number,
) => {
  const { data, info } = await sharp(sheet)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const stride = info.width * CHANNELS;
  return Array.from({ length: grid.frameCount }, (_, frame) => {
    const left = (frame % grid.columns) * cell * CHANNELS;
    const top = Math.floor(frame / grid.columns) * cell;
    const out = new Uint8Array(cell * cell * CHANNELS);
    for (let y = 0; y < cell; y += 1) {
      const start = (top + y) * stride + left;
      out.set(data.subarray(start, start + cell * CHANNELS), y * cell * CHANNELS);
    }
    return out;
  });
};

const writeAtlas = async (
  frames: Uint8Array[],
  grid: { columns: number; rows: number },
  cell: number,
) => {
  const width = grid.columns * cell;
  const atlas = Buffer.alloc(width * grid.rows * cell * CHANNELS);
  frames.forEach((frame, index) => {
    const left = (index % grid.columns) * cell;
    const top = Math.floor(index / grid.columns) * cell;
    for (let y = 0; y < cell; y += 1) {
      const start = y * cell * CHANNELS;
      atlas.set(
        frame.subarray(start, start + cell * CHANNELS),
        ((top + y) * width + left) * CHANNELS,
      );
    }
  });
  return sharp(atlas, {
    raw: { width, height: grid.rows * cell, channels: CHANNELS },
  })
    .png()
    .toBuffer();
};

type Lab = [number, number, number];
type Paint = { rgb: [number, number, number]; lab: Lab };
