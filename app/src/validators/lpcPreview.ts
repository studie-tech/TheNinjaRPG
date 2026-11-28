import { z } from "zod";
import { lpcAnimations } from "@/validators/lpc";
import {
  lpcConfigValidator,
  lpcLayoutValidator,
  lpcPreviewMediaUrlValidator,
  lpcSheetValidator,
} from "@/validators/lpcAsset";

const index = z.number().int().min(0).max(65535);
const sheet = lpcSheetValidator
  .omit({
    image: true,
    depth: true,
    palette: true,
    layout: true,
    travel: true,
    offhand: true,
  })
  .extend({
    image: index,
    depth: index.optional(),
    palette: index.optional(),
    layout: index,
    travel: index.optional(),
    offhand: index.optional(),
  });
const metadata = lpcConfigValidator.shape;

/** A clip is an immutable CDN media manifest; application design records remain in tRPC. */
export const lpcPreviewManifestValidator = z.object({
  version: z.literal(1),
  profile: z.string().min(1).max(32),
  source: z.string().regex(/^[a-f0-9]{64}$/),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  animation: z.enum(lpcAnimations),
  catalog: z.object({
    version: z.literal(1),
    entries: z
      .record(z.string().max(191), z.array(index).min(1).max(16))
      .refine((entries) => Object.keys(entries).length <= 256),
    layouts: z.array(lpcLayoutValidator).min(1).max(64),
    palettes: z
      .array(
        lpcSheetValidator.shape.palette.unwrap().extend({
          images: z
            .record(z.string().max(32), index)
            .refine((images) => Object.keys(images).length <= 32),
        }),
      )
      .max(32),
    images: z.array(lpcPreviewMediaUrlValidator).min(1).max(256),
    sheets: z.array(sheet).min(1).max(2048),
    designs: z
      .record(
        z.string().max(32),
        z.object({
          category: metadata.category,
          replacementSlots: metadata.replacementSlots,
          replacesBodyParts: metadata.replacesBodyParts,
          defaultColor: metadata.defaultColor,
          defaultEyes: metadata.defaultEyes,
        }),
      )
      .refine((designs) => Object.keys(designs).length === 1),
  }),
});

export type LpcPreviewManifest = z.infer<typeof lpcPreviewManifestValidator>;

/** A small per-design index keeps animation URLs out of gameplay and editor catalog payloads. */
export const lpcPreviewIndexValidator = z.object({
  version: z.literal(1),
  profile: z.string().min(1).max(32),
  source: z.string().regex(/^[a-f0-9]{64}$/),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  clips: z.partialRecord(z.enum(lpcAnimations), lpcPreviewMediaUrlValidator),
});
export type LpcPreviewIndex = z.infer<typeof lpcPreviewIndexValidator>;
