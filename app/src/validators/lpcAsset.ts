import { z } from "zod";
import { lpcAtlasFrame } from "@/libs/lpc/frames";
import type { LpcAnimation } from "@/validators/lpc";
import { lpcAnimations, lpcMaterials } from "@/validators/lpc";

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
  "shirt",
  "legs",
  "feet",
  "bandana",
  "hair",
  "beard",
  "body",
  "head",
  "glasses",
  "piercing",
  "tattoo",
  "scar",
] as const;

/** Modular garments replace these natural mesh sections rather than covering an entire body. */
export const lpcBodyParts = [
  "torso",
  "upper-arms",
  "lower-arms",
  "hands",
  "hips",
  "legs",
  "feet",
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
    /** Logical character scale is independent of an oversized weapon's cell dimensions. */
    pixelsPerUnit: z.union([z.literal(64), z.literal(100), z.literal(128)]).optional(),
    /** Authored neutral ground contact, measured inside the untrimmed logical cell. */
    ground: z.object({ x: z.number().min(0), y: z.number().min(0) }).optional(),
    clips: z.partialRecord(z.enum(lpcAnimations), directions),
    /** Six hex facings reuse four authored camera views; left views may mirror right views. */
    facings: z
      .array(z.object({ row: z.number().int().min(0).max(3), mirror: z.boolean() }))
      .length(6)
      .optional(),
    /** Each clip retains its source timing independently of the number of sampled poses. */
    frameMs: z
      .partialRecord(z.enum(lpcAnimations), z.number().min(10).max(2000))
      .optional(),
    /** Shared logical crop; movement atlases keep one extruded pixel outside each frame. */
    trim: z
      .object({
        x: z.number().int().min(0),
        y: z.number().int().min(0),
        width: z.number().int().min(1),
        height: z.number().int().min(1),
      })
      .optional(),
    /** Animation-specific crops pack standing, attacks and falling poses without large empty cells. */
    regions: z
      .partialRecord(
        z.enum(lpcAnimations),
        z.object({
          x: z.number().int().min(0).max(2048),
          y: z.number().int().min(0).max(2048),
          columns: z.number().int().min(1).max(2048),
          trim: z.object({
            x: z.number().int().min(0),
            y: z.number().int().min(0),
            width: z.number().int().min(1),
            height: z.number().int().min(1),
          }),
        }),
      )
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
    if (layout.ground && (layout.ground.x > cell || layout.ground.y > cell))
      ctx.addIssue({
        code: "custom",
        message: "Ground contact must fit within the logical cell.",
      });
    const width = trim?.width ?? cell,
      height = trim?.height ?? cell;
    const gutter = trim ? 2 : 0;
    const frames = Object.values(layout.clips).flat(2);
    if (
      !frames.length ||
      (!layout.regions && columns * (width + gutter) > 2048) ||
      Object.entries(layout.clips).some(([animation, rows]) =>
        rows.flat().some((index) => {
          const frame = lpcAtlasFrame(layout, animation as LpcAnimation, index),
            padding = frame.trim ? 1 : 0;
          return (
            frame.x + frame.width + padding > 2048 ||
            frame.y + frame.height + padding > 2048
          );
        }),
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Frames must fit within a 2048px atlas.",
      });
    if (
      [
        ...(trim ? [trim] : []),
        ...Object.values(layout.regions ?? {}).map((region) => region.trim),
      ].some((crop) => crop.x + crop.width > cell || crop.y + crop.height > cell)
    )
      ctx.addIssue({
        code: "custom",
        message: "Trim must fit within the logical cell.",
      });
    if (
      Object.keys(layout.regions ?? {}).some(
        (animation) => !layout.clips[animation as LpcAnimation],
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Animation regions require an authored clip.",
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
        punch: 16,
        throw: 16,
        crossbow: 16,
        block: 16,
        die: 16,
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
  /** Lossless, opaque RGB bytes encode camera depth; zero denotes an empty surface. */
  depth: z.url().max(191).optional(),
  /** The low four depth bits identify a natural mesh section; zero denotes an accessory. */
  bodyRegions: z.boolean().optional(),
  /** Exposed skin and embedded hair retain the character's palette when equipment changes. */
  palette: z
    .object({
      channel: z.enum(["skin", "hair", "eyes"]),
      images: z
        .record(
          z
            .string()
            .min(1)
            .max(32)
            .regex(/^[a-z0-9_-]+$/),
          z.url().max(191),
        )
        .refine(
          (images) =>
            Object.keys(images).length > 0 && Object.keys(images).length <= 32,
          "Provide between one and 32 character palettes.",
        ),
    })
    .optional(),
  z: z.number().int().min(-1000).max(1000),
  layout: lpcLayoutValidator,
});
/** A held object may be rendered at the other hand's socket instead of reflecting its right-hand pose. */
const handedAtlas = atlas.extend({ offhand: atlas.optional() });
/** A full-pose layer may carry a separate movement atlas with its own crop and frame indices. */
export const lpcSheetValidator = handedAtlas.extend({
  travel: handedAtlas.optional(),
  /** Stable part identifiers pair the same material across palette variants. */
  part: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/)
    .optional(),
  material: z.enum(lpcMaterials).optional(),
  /** Combined outfits retain each source design's pose compatibility group. */
  component: z.string().min(1).max(64).optional(),
});
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
    version: z.literal(2),
    category: z.enum(lpcCategories),
    replacementSlots: z
      .array(z.enum(lpcReplacementSlots))
      .max(lpcReplacementSlots.length),
    replacesBodyParts: z
      .array(z.enum(lpcBodyParts))
      .max(lpcBodyParts.length)
      .optional(),
    defaultColor: z
      .string()
      .min(1)
      .max(32)
      .regex(/^[a-z0-9_-]+$/),
    defaultEyes: z
      .string()
      .min(1)
      .max(32)
      .regex(/^[a-z0-9_-]+$/),
    variants: z.record(
      z.string().regex(/^(male|female)\/[a-z0-9_-]+\/[a-z0-9_-]+$/),
      z.array(lpcSheetValidator).min(1).max(16),
    ),
    attributions: z.array(lpcAttributionValidator).min(1).max(100),
    sourceRevision: z.string().max(191).optional(),
    sourceUrl: z.url().optional(),
    /** Exact generator definition IDs allow recipe import without name-based guessing. */
    upstream: z
      .array(
        z.object({
          id: z.string().min(1).max(191),
          name: z.string().min(1).max(191),
          group: z.string().min(1).max(191),
          colors: z
            .array(
              z.object({
                label: z.string().max(191),
                group: z.string().min(1).max(191),
                material: z.enum([...lpcMaterials, "skin", "hair", "eyes"]),
              }),
            )
            .max(8),
        }),
      )
      .max(32)
      .default([]),
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
    if (new Set(config.replacementSlots).size !== config.replacementSlots.length)
      ctx.addIssue({
        code: "custom",
        path: ["replacementSlots"],
        message: "Choose each base layer once.",
      });
    if (
      new Set(config.replacesBodyParts).size !== (config.replacesBodyParts?.length ?? 0)
    )
      ctx.addIssue({
        code: "custom",
        path: ["replacesBodyParts"],
        message: "Choose each body section once.",
      });
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
      const parts = sheets.flatMap((sheet) => (sheet.part ? [sheet.part] : []));
      if (
        new Set(parts).size !== parts.length ||
        sheets.some((sheet) => sheet.material && !sheet.part)
      )
        ctx.addIssue({
          code: "custom",
          path: ["variants", key],
          message: "Material layers need unique layer names within each variant.",
        });
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
      if (
        sheets.some((sheet) => sheet.offhand) &&
        !sheets.every((sheet) => sheet.offhand)
      )
        ctx.addIssue({
          code: "custom",
          path: ["variants", key],
          message: "Provide left-hand artwork for every sheet in the variant.",
        });
      for (const sheet of sheets) {
        if (sheet.offhand && sheet.travel && !sheet.travel.offhand)
          ctx.addIssue({
            code: "custom",
            path: ["variants", key],
            message:
              "Provide left-hand movement artwork for a design with left-hand combat artwork.",
          });
        for (const atlas of [sheet, ...(sheet.travel ? [sheet.travel] : [])]) {
          if (
            [atlas, ...(atlas.offhand ? [atlas.offhand] : [])].some(
              (entry) => entry.bodyRegions && !entry.depth,
            )
          )
            ctx.addIssue({
              code: "custom",
              path: ["variants", key],
              message: "Body sections require a camera-depth atlas.",
            });
          const offhand = atlas.offhand;
          if (!offhand) continue;
          if (
            Object.entries(atlas.layout.clips).some(([name, rows]) => {
              const animation = name as LpcAnimation;
              const other = offhand.layout.clips[animation];
              return (
                !other ||
                rows.some(
                  (row, direction) => row.length !== other[direction]?.length,
                ) ||
                atlas.layout.frameMs?.[animation] !==
                  offhand.layout.frameMs?.[animation]
              );
            })
          )
            ctx.addIssue({
              code: "custom",
              path: ["variants", key],
              message:
                "Left-hand artwork must match the clips and timing of the right hand.",
            });
        }
        if (sheet.travel) {
          for (const atlas of [
            sheet.travel,
            ...(sheet.travel.offhand ? [sheet.travel.offhand] : []),
          ])
            if (
              !atlas.layout.clips.stand ||
              !atlas.layout.clips.walk ||
              Object.keys(atlas.layout.clips).some(
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
    }
  });

export type LpcLayout = z.infer<typeof lpcLayoutValidator>;
export type LpcAssetSheet = z.infer<typeof lpcSheetValidator>;
export type LpcConfig = z.infer<typeof lpcConfigValidator>;
export type LpcAttribution = z.infer<typeof lpcAttributionValidator>;
