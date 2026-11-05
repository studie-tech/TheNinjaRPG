import sharp from "sharp";
import { CUTOUT_ALPHA_THRESHOLD } from "@/drizzle/constants";
import {
  type FurnitureGeometry,
  furnitureGeometrySchema,
} from "@/validators/itemFurniture";

/** Measure the painted silhouette without cropping or changing the stored asset. */
export const measureFurnitureImage = async (
  buffer: Buffer,
  useFullFootprint: boolean,
) => {
  const image = sharp(buffer, { limitInputPixels: 16 * 1024 * 1024 });
  const metadata = await image.metadata();
  if (!metadata.hasAlpha) throw new Error("Furniture needs a transparent background");
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  return furnitureGeometrySchema.parse(
    furnitureGeometryFromPixels(
      data,
      info.width,
      info.height,
      info.channels,
      useFullFootprint,
    ),
  );
};

/** Faint cutout shadows stay below the alpha threshold, so they do not inflate selection. */
export const furnitureGeometryFromPixels = (
  pixels: Uint8Array,
  width: number,
  height: number,
  channels: number,
  useFullFootprint: boolean,
): FurnitureGeometry => {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = pixels[(y * width + x) * channels + channels - 1] ?? 0;
      if (alpha <= CUTOUT_ALPHA_THRESHOLD) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) throw new Error("Furniture image is empty");
  const visibleBounds = {
    x: (left / width) * 100,
    y: (top / height) * 100,
    width: Math.min(100 - (left / width) * 100, ((right + 1 - left) / width) * 100),
    height: Math.min(100 - (top / height) * 100, ((bottom + 1 - top) / height) * 100),
  };
  return {
    aspectRatio: width / height,
    visibleBounds,
    // Staff can refine legs and low furniture; rugs occupy their whole painted surface.
    footprint: useFullFootprint
      ? { ...visibleBounds }
      : {
          ...visibleBounds,
          y: visibleBounds.y + visibleBounds.height * 0.75,
          height: Math.min(
            100 - (visibleBounds.y + visibleBounds.height * 0.75),
            visibleBounds.height * 0.25,
          ),
        },
  };
};
