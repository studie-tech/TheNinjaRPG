import sharp from "sharp";

/** Scene portraits are composited over backgrounds, rather than framed combat icons. */
export const SCENE_CHARACTER_PREPROMPT =
  "TheNinja-RPG scene character, detailed retro pixel art matching village dialogue portraits. " +
  "One full character, upright relaxed dialogue pose, readable face and clothing, mature proportions, " +
  "clear silhouette with head, hands and feet inside the frame and a small transparent margin. " +
  "Match the requested role and mood; no default masked assassin, combat pose or ominous lighting. " +
  "Isolated figure only: no scenery, floor, shadow rectangle, text, border or watermark. Transparent background.";

/** Reject empty cutouts and opaque backgrounds before a generated portrait enters review. */
export const validateSceneCharacterImage = async (buffer: Buffer) => {
  const image = sharp(buffer, { limitInputPixels: 1024 * 1024 });
  const metadata = await image.metadata();
  if (!metadata.hasAlpha)
    throw new Error("Scene character needs a transparent background");
  const { data, info } = await image
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  if (width < 64 || height < 64) throw new Error("Scene character is too small");
  let visible = 0;
  for (let index = channels - 1; index < data.length; index += channels) {
    if ((data[index] ?? 0) > 16) visible += 1;
  }
  if (visible < width * height * 0.01)
    throw new Error("Scene character cutout is empty");
  // A full background can retain alpha elsewhere; inspect all four corner patches too.
  const edge = Math.min(16, Math.floor(Math.min(width, height) / 8));
  for (const [left, top] of [
    [0, 0],
    [width - edge, 0],
    [0, height - edge],
    [width - edge, height - edge],
  ]) {
    let transparent = 0;
    for (let y = top ?? 0; y < (top ?? 0) + edge; y += 1) {
      for (let x = left ?? 0; x < (left ?? 0) + edge; x += 1) {
        if ((data[(y * width + x) * channels + channels - 1] ?? 255) <= 16)
          transparent += 1;
      }
    }
    if (transparent < edge * edge * 0.9) {
      throw new Error("Scene character background was not removed cleanly");
    }
  }
};
