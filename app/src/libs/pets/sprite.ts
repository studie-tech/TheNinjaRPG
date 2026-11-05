/** Deterministic pixel post-processing that frames every companion cutout the same way. */
import sharp from "sharp";

/** Stored companion sprites are square canvases of this many pixels. */
export const PET_SPRITE_SIZE = 512;
/** The animal fits inside this fraction of the canvas, leaving 10% margins. */
export const PET_SPRITE_SAFE_AREA = 0.8;
/** Pixels at or below this alpha are cutout residue, not part of the animal. */
const PET_SPRITE_ALPHA_THRESHOLD = 16;
/**
 * Faint residue covering more of the canvas than this is a background haze. Clean GPT
 * cutouts keep up to about 23% faint pixels along anti-aliased edges; hazy ones 27-75%,
 * and residue at or below the alpha threshold is cleared during framing anyway.
 */
const PET_SPRITE_MAX_HAZE = 0.25;
/** Provider canvases are larger than the stored sprite, so input decoding is bounded. */
const MAX_SOURCE_PIXELS = 2048 * 2048;
/** Decode limit for generated pet images and the references sent with them. */
export const MAX_PET_IMAGE_PIXELS = 1024 * 1024;

/**
 * Report whether a cutout keeps a semi-transparent backdrop: GPT Image's native
 * transparency sometimes leaves a faint haze over the whole canvas that passes a
 * corner check but tints the scene behind the sprite.
 */
export const hasBackgroundHaze = async (image: Buffer) => {
  const { data, info } = await sharp(image, { limitInputPixels: MAX_SOURCE_PIXELS })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let haze = 0;
  for (let index = info.channels - 1; index < data.length; index += info.channels) {
    const alpha = data[index] ?? 0;
    if (alpha > 0 && alpha < 64) haze += 1;
  }
  return haze > info.width * info.height * PET_SPRITE_MAX_HAZE;
};

/**
 * Trim a transparent cutout to its visible animal and place it on the stored canvas:
 * residue at or below the alpha threshold is cleared, the animal is downscaled only when
 * it exceeds the central 80% (never enlarged, so smaller early ranks stay smaller and no
 * pixels are invented), centred horizontally and bottom-aligned on the 10% margin so every
 * rank stands on the same ground line. Returns 512x512 WebP bytes with exact alpha.
 */
export const normalizePetSprite = async (image: Buffer) => {
  const source = sharp(image, { limitInputPixels: MAX_SOURCE_PIXELS }).ensureAlpha();
  const { data, info } = await source.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  let [left, top, right, bottom] = [width, height, -1, -1];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alphaIndex = (y * width + x) * channels + channels - 1;
      if ((data[alphaIndex] ?? 0) <= PET_SPRITE_ALPHA_THRESHOLD) {
        data.fill(0, alphaIndex - channels + 1, alphaIndex + 1);
        continue;
      }
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < 0) throw new Error("The generated pet cutout is empty");
  const subjectWidth = right - left + 1;
  const subjectHeight = bottom - top + 1;
  const safe = Math.floor(PET_SPRITE_SIZE * PET_SPRITE_SAFE_AREA);
  const margin = Math.floor((PET_SPRITE_SIZE - safe) / 2);
  // The provider canvas maps onto the stored canvas at this scale; fitting may only shrink.
  const scale = Math.min(
    PET_SPRITE_SIZE / Math.max(width, height),
    safe / subjectWidth,
    safe / subjectHeight,
  );
  const targetWidth = Math.max(1, Math.round(subjectWidth * scale));
  const targetHeight = Math.max(1, Math.round(subjectHeight * scale));
  const subject = await sharp(data, { raw: { width, height, channels } })
    .extract({ left, top, width: subjectWidth, height: subjectHeight })
    .resize(targetWidth, targetHeight, { kernel: "lanczos3" })
    .png()
    .toBuffer();
  return sharp({
    create: {
      width: PET_SPRITE_SIZE,
      height: PET_SPRITE_SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: subject,
        left: Math.floor((PET_SPRITE_SIZE - targetWidth) / 2),
        top: PET_SPRITE_SIZE - margin - targetHeight,
      },
    ])
    .webp({ quality: 80, alphaQuality: 100 })
    .toBuffer();
};
