import { z } from "zod";
import { AvatarFacings, SPRITE_ANIMATION_LIMITS } from "@/drizzle/constants";

/** Row-major sheets contain equally sized cells, with no gutters or padding. */
export const spriteAnimationSchema = z
  .object({
    name: z.string().trim().min(1).max(191),
    url: z
      .url()
      .max(2048)
      .refine((url) => /^https?:\/\//.test(url), "Use an HTTP image URL"),
    columns: z.coerce.number().int().min(1).max(32),
    rows: z.coerce.number().int().min(1).max(32),
    frameCount: z.coerce.number().int().min(2).max(SPRITE_ANIMATION_LIMITS.frames),
    fps: z.coerce.number().min(1).max(60),
    facing: z.enum(AvatarFacings),
  })
  .refine((value) => value.frameCount <= value.columns * value.rows, {
    message: "Frame count exceeds the sheet grid",
    path: ["frameCount"],
  })
  .refine((value) => value.columns * value.rows <= SPRITE_ANIMATION_LIMITS.cells, {
    message: `Use a compact sheet with at most ${SPRITE_ANIMATION_LIMITS.cells} cells`,
    path: ["rows"],
  })
  .refine((value) => value.frameCount / value.fps <= SPRITE_ANIMATION_LIMITS.seconds, {
    message: `Keep animation loops within ${SPRITE_ANIMATION_LIMITS.seconds} seconds`,
    path: ["fps"],
  });

/** Select an AI; the router also checks that it exists and that the caller can edit content. */
export const aiSpriteAnimationInput = z.object({ userId: z.string().min(1) });
/** Null removes an override; the router verifies both the action and library entry exist. */
export const assignSpriteAnimationSchema = aiSpriteAnimationInput.extend({
  actionKey: z.string().min(1).max(191),
  animationId: z.string().min(1).nullable(),
});

/** Form values may contain numeric strings; the shared schema coerces them before saving. */
export type SpriteAnimationInput = z.input<typeof spriteAnimationSchema>;
