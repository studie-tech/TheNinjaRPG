import sharp from "sharp";
import { describe, expect, it } from "bun:test";
import { validateSceneCharacterImage } from "@/libs/contentReview/sceneCharacter";

const cutout = async (corner = false) => {
  const data = Buffer.alloc(128 * 128 * 4);
  for (let y = 20; y < 110; y += 1) {
    for (let x = 35; x < 95; x += 1) {
      data[(y * 128 + x) * 4] = 180;
      data[(y * 128 + x) * 4 + 3] = 255;
    }
  }
  if (corner) for (let y = 0; y < 16; y += 1) for (let x = 0; x < 16; x += 1) data[(y * 128 + x) * 4 + 3] = 255;
  return sharp(data, { raw: { width: 128, height: 128, channels: 4 } }).png().toBuffer();
};

describe("scene character cutouts", () => {
  it("accepts a visible figure with transparent margins", async () => {
    await expect(validateSceneCharacterImage(await cutout())).resolves.toBeUndefined();
  });
  it("rejects opaque, empty and incompletely removed backgrounds", async () => {
    const opaque = await sharp({ create: { width: 128, height: 128, channels: 3, background: "white" } }).png().toBuffer();
    const empty = await sharp({ create: { width: 128, height: 128, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    await expect(validateSceneCharacterImage(opaque)).rejects.toThrow(/transparent/);
    await expect(validateSceneCharacterImage(empty)).rejects.toThrow(/empty/);
    await expect(validateSceneCharacterImage(await cutout(true))).rejects.toThrow(/removed cleanly/);
  });
});
