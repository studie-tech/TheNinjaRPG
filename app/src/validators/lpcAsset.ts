import { z } from "zod";
import type { LpcAnimation } from "@/validators/lpc";
import { lpcAnimations } from "@/validators/lpc";

/** Shared serialized bound keeps saved designs and exported settings round-trippable. */
export const LPC_CONFIG_MAX_BYTES = 2 * 1024 * 1024;

/** Visual roles determine preview composition and whether items may select a design. */
export const lpcCategories = [
  "body",
  "head",
  "hair",
  "beard",
  "equipment",
  "headgear",
] as const;
/** Base outfit slots an equipped design replaces; none keeps all base clothing. */
export const lpcReplacementSlots = [
  "none",
  "shirt",
  "legs",
  "feet",
  "bandana",
] as const;

// Every clip has rows in authored north, west, south, east order.
const directions = z
  .array(z.array(z.number().int().min(0).max(65535)).min(1).max(256))
  .length(4);
/** Authored frame indices can be sparse; cell and columns locate them in the packed atlas. */
export const lpcLayoutValidator = z
  .object({
    cell: z.union([z.literal(64), z.literal(128), z.literal(192)]),
    columns: z.number().int().min(1).max(2048),
    clips: z.partialRecord(z.enum(lpcAnimations), directions),
    /** Shared logical crop; movement atlases keep one extruded pixel outside each frame. */
    trim: z
      .object({
        x: z.number().int().min(0),
        y: z.number().int().min(0),
        width: z.number().int().min(1),
        height: z.number().int().min(1),
      })
      .optional(),
    /** Custom weapon columns can reference a different authored body/clothing timeline. */
    bodyPoses: z
      .partialRecord(
        z.enum(lpcAnimations),
        z.object({ animation: z.enum(lpcAnimations), frames: directions }),
      )
      .optional(),
  })
  .superRefine((layout, ctx) => {
    const { cell, columns, trim } = layout;
    const width = trim?.width ?? cell,
      height = trim?.height ?? cell;
    const gutter = trim ? 2 : 0;
    const frames = Object.values(layout.clips).flat(2);
    if (
      !frames.length ||
      columns * (width + gutter) > 2048 ||
      frames.some(
        (frame) => (Math.floor(frame / columns) + 1) * (height + gutter) > 2048,
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Frames must fit within a 2048px atlas.",
      });
    if (trim && (trim.x + width > cell || trim.y + height > cell))
      ctx.addIssue({
        code: "custom",
        message: "Trim must fit within the logical cell.",
      });
    for (const [animation, pose] of Object.entries(layout.bodyPoses ?? {})) {
      const clip = layout.clips[animation as LpcAnimation];
      const limit = {
        stand: 1,
        idle: 3,
        combat: 3,
        walk: 8,
        slash: 6,
        thrust: 8,
        spellcast: 7,
        shoot: 13,
        hurt: 6,
      }[pose.animation];
      if (
        !clip ||
        pose.frames.some(
          (row, direction) =>
            row.length !== clip[direction]?.length ||
            row.some((index) => index >= limit),
        )
      )
        ctx.addIssue({
          code: "custom",
          message: `Invalid ${animation} body pose mapping.`,
        });
    }
  });

const atlas = z.object({
  image: z.url().max(191),
  z: z.number().int().min(-1000).max(1000),
  layout: lpcLayoutValidator,
});
/** A full-pose layer may carry a separate movement atlas with its own crop and frame indices. */
export const lpcSheetValidator = atlas.extend({ travel: atlas.optional() });
/** Keep artist credits and licence/source terms with the artwork across edits and exports. */
export const lpcAttributionValidator = z.object({
  profile: z.string().max(191).optional(),
  file: z.string().max(1024).optional(),
  authors: z.array(z.string().min(1).max(191)).min(1).max(100),
  licenses: z.array(z.string().max(191)).max(20),
  chosenLicense: z.string().min(1).max(191),
  urls: z.array(z.url().max(2048)).max(50),
  notes: z.string().max(10000),
});

/** Complete design contract shared by persistence, rendering, imports and staff forms. */
export const lpcConfigValidator = z
  .object({
    version: z.literal(1),
    category: z.enum(lpcCategories),
    replacementSlot: z.enum(lpcReplacementSlots),
    defaultColor: z
      .string()
      .min(1)
      .max(32)
      .regex(/^[a-z0-9-]+$/),
    defaultEyes: z
      .string()
      .min(1)
      .max(32)
      .regex(/^[a-z0-9-]+$/),
    variants: z.record(
      z.string().regex(/^(male|female)\/[a-z0-9-]+\/[a-z0-9-]+$/),
      z.array(lpcSheetValidator).min(1).max(16),
    ),
    attributions: z.array(lpcAttributionValidator).min(1).max(100),
    sourceRevision: z.string().max(191).optional(),
    sourceUrl: z.url().optional(),
  })
  .superRefine((config, ctx) => {
    if (
      new TextEncoder().encode(JSON.stringify(config)).byteLength > LPC_CONFIG_MAX_BYTES
    )
      ctx.addIssue({
        code: "custom",
        message: "LPC design settings must be at most 2 MB.",
      });
    const variants = Object.entries(config.variants);
    if (variants.length > 256)
      ctx.addIssue({
        code: "custom",
        message: "A design supports at most 256 variants.",
      });
    for (const body of ["male", "female"]) {
      if (!config.variants[`${body}/${config.defaultColor}/${config.defaultEyes}`])
        ctx.addIssue({
          code: "custom",
          path: ["variants"],
          message: `Provide the default colour and eyes for the ${body === "male" ? "broad" : "slender"} body style.`,
        });
    }
    for (const [key, sheets] of variants) {
      if (
        !["stand", "walk"].every((animation) =>
          sheets.some((sheet) => sheet.layout.clips[animation as LpcAnimation]),
        )
      )
        ctx.addIssue({
          code: "custom",
          path: ["variants", key],
          message: "Each variant needs standing and walking poses.",
        });
      if (!sheets.some((sheet) => sheet.travel))
        ctx.addIssue({
          code: "custom",
          path: ["variants", key],
          message: "Each variant needs a travel atlas.",
        });
      for (const sheet of sheets)
        if (sheet.travel) {
          if (
            !sheet.travel.layout.clips.stand ||
            !sheet.travel.layout.clips.walk ||
            Object.keys(sheet.travel.layout.clips).some(
              (animation) => !["stand", "idle", "walk"].includes(animation),
            )
          )
            ctx.addIssue({
              code: "custom",
              path: ["variants", key],
              message:
                "Travel atlases must contain standing/walking poses and only movement animations.",
            });
        }
    }
  });

export type LpcLayout = z.infer<typeof lpcLayoutValidator>;
export type LpcAssetSheet = z.infer<typeof lpcSheetValidator>;
export type LpcConfig = z.infer<typeof lpcConfigValidator>;
export type LpcAttribution = z.infer<typeof lpcAttributionValidator>;
